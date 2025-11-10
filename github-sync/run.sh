#!/usr/bin/with-contenv bashio
set -e

echo "[INFO] Starting GitHub Config Sync addon..."

# Read configuration from /data/options.json
CONFIG_PATH=/data/options.json

export GIT_REPOSITORY=$(jq -r '.git_repository // empty' $CONFIG_PATH)
export GIT_BRANCH=$(jq -r '.git_branch // "main"' $CONFIG_PATH)
export AUTH_METHOD=$(jq -r '.auth_method // "token"' $CONFIG_PATH)
export ACCESS_TOKEN=$(jq -r '.access_token // empty' $CONFIG_PATH)
export SSH_KEY=$(jq -r '.ssh_key // empty' $CONFIG_PATH)
export WEBHOOK_SECRET=$(jq -r '.webhook_secret // empty' $CONFIG_PATH)
export AUTO_RESTART=$(jq -r '.auto_restart // false' $CONFIG_PATH)
export BACKUP_ENABLED=$(jq -r '.backup_enabled // true' $CONFIG_PATH)
export BACKUP_RETENTION=$(jq -r '.backup_retention // 5' $CONFIG_PATH)
export SYNC_PATH=$(jq -r '.sync_path // "/config"' $CONFIG_PATH)
export NOTIFICATIONS_ENABLED=$(jq -r '.notifications_enabled // true' $CONFIG_PATH)
export NOTIFICATION_SERVICE=$(jq -r '.notification_service // "notify.notify"' $CONFIG_PATH)
export WEBHOOK_PORT=8099
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN:-}"
export HOMEASSISTANT_URL="http://supervisor/core"

# Validate required configuration
if [ -z "$GIT_REPOSITORY" ]; then
    echo "[FATAL] git_repository is required!"
    exit 1
fi

if [ -z "$WEBHOOK_SECRET" ]; then
    echo "[FATAL] webhook_secret is required for security!"
    exit 1
fi

# Setup SSH if using SSH authentication
if [ "$AUTH_METHOD" == "ssh" ]; then
    echo "[INFO] Setting up SSH authentication..."

    if [ -z "$SSH_KEY" ]; then
        echo "[FATAL] ssh_key is required when auth_method is 'ssh'!"
        exit 1
    fi

    mkdir -p /root/.ssh
    echo "$SSH_KEY" > /root/.ssh/id_rsa
    chmod 600 /root/.ssh/id_rsa

    # Add GitHub to known hosts
    ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null

    echo "[INFO] SSH authentication configured"
elif [ "$AUTH_METHOD" == "token" ]; then
    if [ -z "$ACCESS_TOKEN" ]; then
        echo "[FATAL] access_token is required when auth_method is 'token'!"
        exit 1
    fi
    echo "[INFO] Using token authentication"
fi

# Create backup directory if it doesn't exist
if [ "$BACKUP_ENABLED" == "true" ]; then
    mkdir -p /backup/github-sync
    echo "[INFO] Backup enabled (retention: $BACKUP_RETENTION backups)"
fi

echo "[INFO] Configuration loaded successfully"
echo "[INFO] Repository: $GIT_REPOSITORY"
echo "[INFO] Branch: $GIT_BRANCH"
echo "[INFO] Sync Path: $SYNC_PATH"
echo "[INFO] Auto Restart: $AUTO_RESTART"

# Start the Node.js application
echo "[INFO] Starting webhook server on port $WEBHOOK_PORT..."
cd /app
exec npm start
