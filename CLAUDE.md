# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands
- Build Docker image: `docker buildx build --platform linux/amd64 -t bambu-slicer .`
- Run locally: `docker run -p 9000:8080 bambu-slicer`
- Test with event: `curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" -d @event.json`
- Deploy to AWS: `./deploy.sh`

## Supported File Formats
- STL (.stl): Standard Triangle Language, common 3D printing format
- 3MF (.3mf): 3D Manufacturing Format, modern replacement for STL
- OBJ (.obj): Wavefront 3D Object File, widely used in 3D graphics and printing

## Code Style Guidelines
- Use CommonJS module syntax (require/exports)
- Functions should be async/await where possible for asynchronous operations
- Use camelCase for variables and functions
- Error handling should use try/catch blocks with descriptive error messages
- Logging should use console.log/error with descriptive prefixes
- File paths should use path.join() for cross-platform compatibility
- Format numbers using Math.ceil() with precision adjustment (e.g., Math.ceil(value * 100) / 100)
- AWS resources should be region-aware and use environment variables where possible