# GitHub Config Sync - Home Assistant Addon

Automatically sync your Home Assistant configuration from GitHub using webhooks. This addon listens for GitHub webhook events and pulls configuration changes from your repository, ensuring your HA setup stays in sync with your version-controlled configuration.

## Features

- **Webhook-triggered sync**: Automatically pulls configuration when you push to your main branch
- **Atomic operations**: Changes are only applied if the entire sync succeeds
- **Dual authentication**: Support for both GitHub Personal Access Tokens and SSH keys
- **Secure webhooks**: Validates GitHub webhook signatures using HMAC-SHA256
- **Automatic backups**: Creates backups before applying changes with configurable retention
- **Auto-restart**: Optionally restart Home Assistant after successful sync
- **Safety first**: No changes applied if pull fails for any reason

## Installation

1. Add this repository to your Home Assistant add-on store
2. Install the "GitHub Config Sync" addon
3. Configure the addon (see Configuration section)
4. Start the addon
5. Configure GitHub webhook (see GitHub Setup section)

## Configuration

### Required Settings

- **git_repository**: Your GitHub repository
  - Format: `username/repository` or full URL
  - Example: `myuser/ha-config` or `https://github.com/myuser/ha-config.git`

- **webhook_secret**: Secret for validating GitHub webhooks
  - Generate a strong random string (use `openssl rand -hex 32`)
  - Must match the secret configured in GitHub

### Authentication Settings

- **auth_method**: Choose `token` or `ssh`
  - `token`: Use GitHub Personal Access Token (easier setup)
  - `ssh`: Use SSH key (more secure)

- **access_token**: GitHub Personal Access Token (required if `auth_method` is `token`)
  - Create at: https://github.com/settings/tokens
  - Required scopes: `repo` (for private repos) or `public_repo` (for public repos)

- **ssh_key**: Private SSH key (required if `auth_method` is `ssh`)
  - Paste your entire private key including `-----BEGIN` and `-----END` lines
  - Public key must be added to GitHub: https://github.com/settings/keys

### Optional Settings

- **git_branch**: Branch to sync from (default: `main`)
- **sync_path**: Path to sync files to (default: `/config`)
- **auto_restart**: Restart Home Assistant after sync (default: `false`)
- **backup_enabled**: Create backups before sync (default: `true`)
- **backup_retention**: Number of backups to keep (default: `5`)

### Example Configuration

#### Using Personal Access Token

```yaml
git_repository: "myuser/homeassistant-config"
git_branch: "main"
auth_method: "token"
access_token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
webhook_secret: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
auto_restart: true
backup_enabled: true
backup_retention: 5
sync_path: "/config"
```

#### Using SSH Key

```yaml
git_repository: "git@github.com:myuser/homeassistant-config.git"
git_branch: "main"
auth_method: "ssh"
ssh_key: |
  -----BEGIN OPENSSH PRIVATE KEY-----
  b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
  ... (your full private key) ...
  -----END OPENSSH PRIVATE KEY-----
webhook_secret: "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
auto_restart: false
backup_enabled: true
backup_retention: 10
sync_path: "/config"
```

## GitHub Setup

### 1. Create Webhook Secret

Generate a secure random string for your webhook secret:

```bash
openssl rand -hex 32
```

Save this secret - you'll need it for both the addon configuration and GitHub webhook setup.

### 2. Configure GitHub Webhook

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Webhooks** → **Add webhook**
3. Configure the webhook:
   - **Payload URL**: `http://your-ha-ip:8099/webhook`
     - Replace `your-ha-ip` with your Home Assistant IP address
     - If using HTTPS/reverse proxy: `https://your-domain/webhook`
   - **Content type**: `application/json`
   - **Secret**: Paste the webhook secret you generated
   - **Events**: Select "Just the push event"
   - **Active**: Check this box
4. Click **Add webhook**

### 3. Test the Webhook

After setting up:

1. Make a change to your config repository
2. Commit and push to the configured branch
3. Check the addon logs to see the sync process
4. GitHub will show webhook delivery status in Settings → Webhooks

## Usage

### Automatic Sync

Once configured, the addon automatically syncs when you push to the configured branch:

1. Make changes to your configuration files
2. Commit and push to GitHub
3. GitHub CI runs your checks/tests
4. On successful merge to main, GitHub triggers the webhook
5. Addon receives webhook, verifies signature
6. Pulls latest changes to a temporary directory
7. Creates backup of current configuration
8. Applies changes atomically
9. Optionally restarts Home Assistant

### Manual Sync

You can also trigger a manual sync using the API:

```bash
curl -X POST http://your-ha-ip:8099/sync
```

### Health Check

Check if the addon is running:

```bash
curl http://your-ha-ip:8099/health
```

## Safety Features

### Atomic Operations

All file operations are performed atomically:

1. Repository is cloned to a temporary directory
2. Changes are validated
3. Backup is created (if enabled)
4. Only if all steps succeed, changes are applied to `/config`
5. If ANY step fails, no changes are made

### Backup System

When `backup_enabled` is `true`:

- Backup is created BEFORE applying any changes
- Backups are timestamped and compressed
- Old backups are automatically cleaned based on `backup_retention`
- Backups stored in `/backup/github-sync/`

### Validation

The addon validates:

- GitHub webhook signatures (prevents unauthorized triggers)
- Repository authentication (fails fast if credentials invalid)
- Git operations (clone/pull must succeed completely)

## Troubleshooting

### Webhook Not Triggering

1. Check GitHub webhook delivery status (Settings → Webhooks)
2. Verify webhook secret matches in both places
3. Ensure port 8099 is accessible from internet
4. Check addon logs for signature validation errors

### Authentication Failures

**Token Auth:**
- Verify token has correct permissions
- Check token hasn't expired
- Ensure repository URL format is correct

**SSH Auth:**
- Verify public key is added to GitHub
- Check private key format (include BEGIN/END lines)
- Ensure key has no passphrase

### Sync Failures

Check addon logs for specific errors:

```bash
docker logs addon_github_config_sync
```

Common issues:
- Network connectivity to GitHub
- Invalid repository URL
- Branch doesn't exist
- Merge conflicts (ensure clean working directory)

### Restart Issues

If auto-restart is enabled but HA doesn't restart:
- Check if addon has necessary permissions
- Verify Home Assistant CLI is accessible
- Check Home Assistant logs for restart errors

## GitHub CI Integration

Example GitHub Actions workflow that triggers the webhook:

```yaml
name: Deploy to Home Assistant

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Validate HA Config
        uses: frenck/action-home-assistant@v1
        with:
          path: "."

      # Webhook is automatically triggered by push event
      # No additional steps needed!
```

## Security Considerations

1. **Webhook Secret**: Use a strong, random secret (minimum 32 characters)
2. **Access Tokens**: Use fine-grained tokens with minimal permissions
3. **SSH Keys**: Use dedicated deploy keys (not your personal SSH key)
4. **Network**: Consider using HTTPS with reverse proxy (Nginx/Caddy)
5. **Firewall**: Limit webhook endpoint access to GitHub IPs if possible
6. **Backups**: Keep backup_enabled on to recover from issues

## Advanced Configuration

### Custom Sync Path

To sync to a subdirectory instead of `/config`:

```yaml
sync_path: "/config/custom_path"
```

### Multiple Branches

To test changes before applying to production:

1. Use `git_branch: "staging"` in a test HA instance
2. Merge to staging first, verify it works
3. Then merge to main for production deployment

## Support

For issues, feature requests, or questions:

- Check the addon logs first
- Review GitHub webhook delivery logs
- Open an issue on the GitHub repository

## License

MIT License - See LICENSE file for details
