ARG BUILD_FROM=alpine:3.19
FROM $BUILD_FROM

# Install requirements
RUN apk add --no-cache \
    nodejs \
    npm \
    git \
    openssh-client \
    bash \
    curl \
    jq \
    rsync

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production || npm install --only=production

# Copy application files
COPY src/ ./src/
COPY run.sh /
COPY run-standalone.sh /

# Make run scripts executable
RUN chmod a+x /run.sh /run-standalone.sh

# Set entrypoint
CMD [ "/run.sh" ]
