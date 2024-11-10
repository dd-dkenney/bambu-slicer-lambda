#!/bin/bash

# Check if running in AWS Lambda environment
if [ -z "${AWS_LAMBDA_RUNTIME_API}" ]; then
    # Running locally, use the Runtime Interface Emulator
    exec /usr/local/bin/aws-lambda-rie /usr/bin/npx aws-lambda-ric "$@"
else
    # Running in Lambda, use the Runtime Interface Client directly
    exec /usr/bin/npx aws-lambda-ric "$@"
fi