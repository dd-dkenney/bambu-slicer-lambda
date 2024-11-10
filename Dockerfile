# Start with Ubuntu 20.04 as the base image
FROM ubuntu:20.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install essential dependencies, including cmake and other libraries required by BambuStudio
# Install essential dependencies, including libraries required by BambuStudio
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    cmake \
    curl \
    build-essential \
    fuse \
    libgtk-3-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxcursor1 \
    libxinerama1 \
    libxi6 \
    libgconf-2-4 \
    libnspr4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    libudev1 \
    libsecret-1-0 \
    xvfb \
    libglu1-mesa \
    libdouble-conversion3 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libfuse2 \
    wget \
    libegl1-mesa \
    libgles2-mesa \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /var/task

RUN mkdir -p /home/slicer/print_settings /tmp/output

# Download Bambu Studio AppImage for Ubuntu 20.04 and make it executable
RUN wget https://github.com/bambulab/BambuStudio/releases/download/v01.09.07.52/Bambu_Studio_ubuntu-v01.09.07.52-20.04.AppImage \
    -O /home/slicer/BambuStudio.AppImage

RUN chmod +x /home/slicer/BambuStudio.AppImage

#RUN /home/slicer/BambuStudio.AppImage --appimage-extract
#RUN mv squashfs-root/* /home/slicer/ \
#    && rm /home/slicer/BambuStudio.AppImage

# Copy print settings (assumed to be in the same directory as Dockerfile)
COPY print_settings/* /home/slicer/print_settings/

# Install Node.js 18.x and npm
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && \
    apt-get install -y \
    autoconf \
    automake \
    libtool \
    build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Confirm `npx` availability by updating npm
RUN npm install -g npm

# Install application dependencies
COPY package*.json ./
RUN npm install --omit=dev

RUN mkdir -p /home/slicer/BambuStudio
ADD squashfs-root/ /home/slicer/BambuStudio/

RUN chmod +x /home/slicer/BambuStudio/bin/bambu-studio

RUN apt-get update && apt-get install -y \
    libgstreamer1.0-0 \
    libgstreamer-plugins-base1.0-0 \
    libwebkit2gtk-4.0-37 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy application source code
COPY src/* ./

# Set up xvfb-run-safe script to run BambuStudio with a virtual framebuffer
#RUN echo '#!/bin/bash\nxvfb-run -a --server-args="-screen 0 1280x1024x24" "$@"' > /usr/local/bin/xvfb-run-safe \
#    && chmod +x /usr/local/bin/xvfb-run-safe

# Set up Lambda Runtime Interface Emulator for testing locally (Optional, if needed)
RUN curl -Lo /usr/local/bin/aws-lambda-rie https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/download/v1.22/aws-lambda-rie \
    && chmod +x /usr/local/bin/aws-lambda-rie

# Copy entry script and make it executable
COPY entry.sh /
RUN chmod +x /entry.sh

ENTRYPOINT ["/entry.sh"]
CMD ["index.handler"]