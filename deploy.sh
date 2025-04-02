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

# Check if AWS CLI is already configured
echo "Checking AWS CLI configuration..."
if ! aws sts get-caller-identity &>/dev/null; then
  echo "AWS CLI is not configured with valid credentials."
  
  # Check if running on EC2 with an IAM role
  if curl -s -m 1 http://169.254.169.254/latest/meta-data/ &>/dev/null; then
    echo "Running on EC2, using instance IAM role..."
    # No need to fetch credentials explicitly, AWS CLI will use the instance profile
  else
    echo "Not running on EC2. Ensure AWS credentials are configured via:"
    echo "  - AWS CLI configuration (~/.aws/credentials)"
    echo "  - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)"
    echo "  - AWS SSO or other auth method"
    exit 1
  fi
fi

# Verify permissions
echo "Verifying AWS permissions..."
aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $REGION &>/dev/null
if [ $? -ne 0 ]; then
  echo "Warning: Unable to access Lambda function. Check if your role has lambda:GetFunction permission."
  echo "You may need to attach policies like AWSLambdaFullAccess and AmazonECR-FullAccess to your IAM role."
fi

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
docker buildx build --platform linux/amd64 -f $DOCKERFILE_PATH -t $REPO_URI:$VERSION -t $REPO_URI:latest $BUILD_CONTEXT --push
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
