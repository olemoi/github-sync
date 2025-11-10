#!/usr/bin/env bashio
set -e

bashio::log.info "Starting GitHub Config Sync addon..."

# Read configuration
export GIT_REPOSITORY=$(bashio::config 'git_repository')
export GIT_BRANCH=$(bashio::config 'git_branch')
export AUTH_METHOD=$(bashio::config 'auth_method')
export ACCESS_TOKEN=$(bashio::config 'access_token')
export SSH_KEY=$(bashio::config 'ssh_key')
export WEBHOOK_SECRET=$(bashio::config 'webhook_secret')
export AUTO_RESTART=$(bashio::config 'auto_restart')
export BACKUP_ENABLED=$(bashio::config 'backup_enabled')
export BACKUP_RETENTION=$(bashio::config 'backup_retention')
export SYNC_PATH=$(bashio::config 'sync_path')
export NOTIFICATIONS_ENABLED=$(bashio::config 'notifications_enabled')
export NOTIFICATION_SERVICE=$(bashio::config 'notification_service')
export WEBHOOK_PORT=8099
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"
export HOMEASSISTANT_URL="http://supervisor/core"

# Validate required configuration
if [ -z "$GIT_REPOSITORY" ]; then
    bashio::log.fatal "git_repository is required!"
    exit 1
fi

if [ -z "$WEBHOOK_SECRET" ]; then
    bashio::log.fatal "webhook_secret is required for security!"
    exit 1
fi

# Setup SSH if using SSH authentication
if [ "$AUTH_METHOD" == "ssh" ]; then
    bashio::log.info "Setting up SSH authentication..."

    if [ -z "$SSH_KEY" ]; then
        bashio::log.fatal "ssh_key is required when auth_method is 'ssh'!"
        exit 1
    fi

    mkdir -p /root/.ssh
    echo "$SSH_KEY" > /root/.ssh/id_rsa
    chmod 600 /root/.ssh/id_rsa

    # Add GitHub to known hosts
    ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null

    bashio::log.info "SSH authentication configured"
elif [ "$AUTH_METHOD" == "token" ]; then
    if [ -z "$ACCESS_TOKEN" ]; then
        bashio::log.fatal "access_token is required when auth_method is 'token'!"
        exit 1
    fi
    bashio::log.info "Using token authentication"
fi

# Create backup directory if it doesn't exist
if [ "$BACKUP_ENABLED" == "true" ]; then
    mkdir -p /backup/github-sync
    bashio::log.info "Backup enabled (retention: $BACKUP_RETENTION backups)"
fi

bashio::log.info "Configuration loaded successfully"
bashio::log.info "Repository: $GIT_REPOSITORY"
bashio::log.info "Branch: $GIT_BRANCH"
bashio::log.info "Sync Path: $SYNC_PATH"
bashio::log.info "Auto Restart: $AUTO_RESTART"

# Start the Node.js application
bashio::log.info "Starting webhook server on port $WEBHOOK_PORT..."
cd /app
exec npm start
