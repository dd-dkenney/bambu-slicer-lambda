#!/bin/bash

# Variables - replace these with your specific values
REPO_URI="828034922116.dkr.ecr.us-east-1.amazonaws.com/bambu-slicer-lambda"
LAMBDA_FUNCTION_NAME="bambu-slicer"
REGION="us-east-1"
DOCKERFILE_PATH="./Dockerfile" # Path to Dockerfile relative to the script's location
BUILD_CONTEXT="." # Build context is the root of the Git repo now

# Navigate to the directory containing the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Function to get the latest Lambda version and increment it
get_and_increment_version() {
  echo "Getting latest Lambda version..."
  # Get the latest version number of the Lambda function
  VERSIONS=$(aws lambda list-versions-by-function --function-name $LAMBDA_FUNCTION_NAME --region $REGION --query "Versions[*].Version" --output text)
  
  # Find the highest numeric version
  LATEST_VERSION=0
  for VERSION in $VERSIONS; do
    # Skip $LATEST which is a special version
    if [ "$VERSION" != "\$LATEST" ] && [ "$VERSION" -gt "$LATEST_VERSION" ]; then
      LATEST_VERSION=$VERSION
    fi
  done
  
  # Increment version
  NEW_VERSION=$((LATEST_VERSION + 1))
  echo "Current Lambda version: $LATEST_VERSION, incrementing to version: $NEW_VERSION"
  
  # Return the new version
  echo $NEW_VERSION
}

# 1. Ensure the repository is up to date
echo "Updating project repository..."
git pull
if [ $? -ne 0 ]; then
  echo "Failed to update repository. Exiting."
  exit 1
fi

# 2. Ensure Git LFS files are pulled
echo "Ensuring Git LFS files are up to date..."
git lfs pull
if [ $? -ne 0 ]; then
  echo "Failed to pull Git LFS files. Exiting."
  exit 1
fi

# 2. Retrieve temporary credentials using IMDSv2
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
IAM_ROLE=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/)
CREDENTIALS=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/$IAM_ROLE)

# 3. Export credentials for AWS CLI commands
export AWS_ACCESS_KEY_ID=$(echo $CREDENTIALS | jq -r '.AccessKeyId')
export AWS_SECRET_ACCESS_KEY=$(echo $CREDENTIALS | jq -r '.SecretAccessKey')
export AWS_SESSION_TOKEN=$(echo $CREDENTIALS | jq -r '.Token')

# 4. Log in to ECR
echo "Logging into Amazon ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REPO_URI
if [ $? -ne 0 ]; then
  echo "Warning: ECR login failed. Check if instance profile has ECR permissions."
  exit 1
fi

# Get the new version number
VERSION=$(get_and_increment_version)

# 5. Build and Push Docker Image to ECR with version tag
echo "Building and pushing the Docker image with version $VERSION..."
# Build and push with both version tag and latest tag
docker buildx build --platform linux/amd64 -f $DOCKERFILE_PATH --push -t $REPO_URI:$VERSION -t $REPO_URI:latest $BUILD_CONTEXT
if [ $? -ne 0 ]; then
  echo "Failed to build and push Docker image. Exiting."
  exit 1
fi

# 6. Update Lambda Function to Use New Image
echo "Updating Lambda function with new image version $VERSION..."
aws lambda update-function-code --function-name $LAMBDA_FUNCTION_NAME \
  --image-uri $REPO_URI:$VERSION --region $REGION --publish
if [ $? -ne 0 ]; then
  echo "Failed to update Lambda function. Exiting."
  exit 1
fi

echo "Deployment complete. Lambda function and Docker image updated to version $VERSION."
