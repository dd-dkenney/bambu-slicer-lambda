#!/bin/bash

# Variables - replace these with your specific values
REPO_URI="828034922116.dkr.ecr.us-east-1.amazonaws.com/bambu-slicer-lambda"
LAMBDA_FUNCTION_NAME="bambu-slicer"
REGION="us-east-1"
IMAGE_TAG="latest" # Tag for the Docker image
DOCKERFILE_PATH="./Dockerfile" # Path to Dockerfile relative to the script's location
BUILD_CONTEXT="." # Build context is the root of the Git repo now

# Navigate to the directory containing the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# 1. Ensure the repository is up to date
echo "Updating project repository..."
git pull
if [ $? -ne 0 ]; then
  echo "Failed to update repository. Exiting."
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

# 5. Build and Push Docker Image to ECR
echo "Building and pushing the Docker image..."
docker buildx build --platform linux/amd64 -f $DOCKERFILE_PATH --push -t $REPO_URI:$IMAGE_TAG $BUILD_CONTEXT
if [ $? -ne 0 ]; then
  echo "Failed to build and push Docker image. Exiting."
  exit 1
fi

# 6. Update Lambda Function to Use New Image
echo "Updating Lambda function with new image..."
aws lambda update-function-code --function-name $LAMBDA_FUNCTION_NAME \
  --image-uri $REPO_URI:$IMAGE_TAG --region $REGION
if [ $? -ne 0 ]; then
  echo "Failed to update Lambda function. Exiting."
  exit 1
fi

echo "Deployment complete."
