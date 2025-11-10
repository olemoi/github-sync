# GitHub Config Sync - Detailed Documentation

## Table of Contents

1. [Quick Start Guide](#quick-start-guide)
2. [Architecture](#architecture)
3. [Step-by-Step Setup](#step-by-step-setup)
4. [Configuration Reference](#configuration-reference)
5. [API Reference](#api-reference)
6. [Security Best Practices](#security-best-practices)
7. [Troubleshooting](#troubleshooting)

## Quick Start Guide

### Prerequisites

- Home Assistant instance (any installation method)
- GitHub repository with your HA configuration
- Network access from GitHub to your HA instance (or reverse proxy)

### 5-Minute Setup

1. **Install the addon** from the Home Assistant add-on store

2. **Generate a webhook secret**:
   ```bash
   openssl rand -hex 32
   ```

3. **Create a GitHub Personal Access Token**:
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Select scope: `repo` (for private repos)
   - Copy the token

4. **Configure the addon**:
   ```yaml
   git_repository: "yourusername/your-repo"
   git_branch: "main"
   auth_method: "token"
   access_token: "ghp_your_token_here"
   webhook_secret: "your_generated_secret"
   auto_restart: false
   backup_enabled: true
   ```

5. **Start the addon**

6. **Configure GitHub webhook**:
   - Repository → Settings → Webhooks → Add webhook
   - URL: `http://your-ha-ip:8099/webhook`
   - Content type: `application/json`
   - Secret: your webhook secret
   - Events: "Just the push event"

7. **Test it**: Make a change, commit, push - watch the addon logs!

## Architecture

### Components

```
┌─────────────────┐
│     GitHub      │
│   (Push Event)  │
└────────┬────────┘
         │ Webhook
         ▼
┌─────────────────┐
│  Webhook Server │ ← Express.js (port 8099)
│   (index.js)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Git Sync      │ ← Atomic operations
│  (gitSync.js)   │
└────────┬────────┘
         │
    ┌────┴────┬─────────┬────────┐
    ▼         ▼         ▼        ▼
┌────────┐┌────────┐┌────────┐┌────────┐
│ Backup ││ Clone  ││ Validate││ Apply │
│ Create ││ to Temp││ Config ││ Changes│
└────────┘└────────┘└────────┘└────────┘
                                  │
                                  ▼
                            ┌────────────┐
                            │  Restart   │
                            │ (optional) │
                            └────────────┘
```

### Sync Flow

1. **Webhook Received**
   - Verify signature using HMAC-SHA256
   - Check event type (must be "push")
   - Check branch (must match configured branch)

2. **Backup Phase** (if enabled)
   - Create timestamped tar.gz backup
   - Store in `/backup/github-sync/`

3. **Clone Phase**
   - Clone repository to `/tmp/github-sync-temp`
   - Use shallow clone (depth=1) for efficiency
   - Authenticate using configured method

4. **Validation Phase**
   - Check for configuration.yaml
   - Optional: Run HA config check

5. **Apply Phase**
   - Copy files from temp to `/config`
   - Only if all previous steps succeeded
   - Atomic operation (all or nothing)

6. **Cleanup Phase**
   - Remove temp directory
   - Clean old backups (based on retention)

7. **Restart Phase** (if enabled)
   - Send restart command to HA
   - Uses `ha core restart`

## Step-by-Step Setup

### Option A: Personal Access Token (Easier)

#### 1. Prepare Your Repository

Ensure your repository structure matches your HA config:

```
your-repo/
├── configuration.yaml
├── automations.yaml
├── scripts.yaml
├── secrets.yaml  # ⚠️ Use git-crypt or never commit!
└── custom_components/
```

#### 2. Create GitHub Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: "Home Assistant Sync"
4. Expiration: Choose based on your security policy
5. Scopes:
   - For private repos: `repo`
   - For public repos: `public_repo`
6. Click "Generate token"
7. **Copy the token immediately** (you won't see it again)

#### 3. Generate Webhook Secret

```bash
openssl rand -hex 32
```

Or use any secure random string generator.

#### 4. Configure Addon

```yaml
git_repository: "username/repo-name"
git_branch: "main"
auth_method: "token"
access_token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
webhook_secret: "a1b2c3d4e5f6789..."
auto_restart: false  # Set true if you want automatic restarts
backup_enabled: true
backup_retention: 5
sync_path: "/config"
```

### Option B: SSH Key (More Secure)

#### 1. Generate SSH Key

On your local machine:

```bash
ssh-keygen -t ed25519 -C "homeassistant-sync" -f ~/.ssh/ha-deploy
# Don't set a passphrase (press Enter when asked)
```

This creates:
- `~/.ssh/ha-deploy` (private key)
- `~/.ssh/ha-deploy.pub` (public key)

#### 2. Add Public Key to GitHub

1. Copy public key:
   ```bash
   cat ~/.ssh/ha-deploy.pub
   ```

2. Go to https://github.com/settings/keys
3. Click "New SSH key"
4. Title: "Home Assistant Deployment"
5. Paste the public key
6. Click "Add SSH key"

#### 3. Configure Addon

```yaml
git_repository: "git@github.com:username/repo-name.git"
git_branch: "main"
auth_method: "ssh"
ssh_key: |
  -----BEGIN OPENSSH PRIVATE KEY-----
  b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
  ... (entire private key content) ...
  -----END OPENSSH PRIVATE KEY-----
webhook_secret: "a1b2c3d4e5f6789..."
auto_restart: false
backup_enabled: true
backup_retention: 5
sync_path: "/config"
```

#### 4. Setup GitHub Webhook

1. Go to your repository on GitHub
2. Settings → Webhooks → Add webhook
3. Configure:
   - **Payload URL**: `http://your-ha-ip:8099/webhook`
   - **Content type**: `application/json`
   - **Secret**: Your webhook secret
   - **SSL verification**: Enable if using HTTPS
   - **Events**: "Just the push event"
   - **Active**: ✓
4. Click "Add webhook"

## Configuration Reference

### git_repository (required)

The GitHub repository containing your configuration.

**Formats:**
- `username/repo` - Shortest form
- `https://github.com/username/repo.git` - Full HTTPS URL
- `git@github.com:username/repo.git` - SSH URL (for SSH auth)

**Examples:**
```yaml
git_repository: "homeassistant/config"
git_repository: "https://github.com/homeassistant/config.git"
git_repository: "git@github.com:homeassistant/config.git"
```

### git_branch

Branch to sync from.

**Default:** `main`

**Examples:**
```yaml
git_branch: "main"
git_branch: "production"
git_branch: "stable"
```

### auth_method

Authentication method for GitHub.

**Options:** `token` or `ssh`

**Default:** `token`

**Examples:**
```yaml
auth_method: "token"  # Use Personal Access Token
auth_method: "ssh"    # Use SSH key
```

### access_token

GitHub Personal Access Token (required if `auth_method: token`).

**Format:** `ghp_...` (classic token) or `github_pat_...` (fine-grained)

**Security:** Marked as password in config (hidden in UI)

### ssh_key

Private SSH key (required if `auth_method: ssh`).

**Format:** Full private key including BEGIN/END lines

**Security:** Marked as password in config (hidden in UI)

### webhook_secret (required)

Secret for validating GitHub webhooks.

**Requirements:**
- Must be strong and random
- Minimum 16 characters (recommend 32+)
- Must match GitHub webhook configuration

**Generate:**
```bash
openssl rand -hex 32
```

### auto_restart

Restart Home Assistant after successful sync.

**Options:** `true` or `false`

**Default:** `false`

**Use case:** Enable if configuration changes require restart

**Warning:** HA will be unavailable briefly during restart

### backup_enabled

Create backup before applying changes.

**Options:** `true` or `false`

**Default:** `true`

**Recommendation:** Keep enabled for safety

### backup_retention

Number of backups to keep.

**Range:** 1-30

**Default:** `5`

**Storage:** Each backup is compressed (tar.gz)

### sync_path

Path where configuration files are synced to.

**Default:** `/config`

**Advanced:** Can sync to subdirectory

**Examples:**
```yaml
sync_path: "/config"           # Standard
sync_path: "/config/packages"  # Subdirectory only
```

## API Reference

### POST /webhook

Receives GitHub webhook events.

**Headers:**
- `X-Hub-Signature-256`: GitHub webhook signature
- `X-GitHub-Event`: Event type (e.g., "push")
- `Content-Type`: application/json

**Response:**
- `202 Accepted`: Sync started
- `401 Unauthorized`: Invalid signature
- `200 OK`: Event ignored (wrong type/branch)

**Example:**
```bash
# GitHub sends this automatically
curl -X POST http://ha-ip:8099/webhook \
  -H "X-Hub-Signature-256: sha256=..." \
  -H "X-GitHub-Event: push" \
  -H "Content-Type: application/json" \
  -d '{"ref":"refs/heads/main",...}'
```

### POST /sync

Manually trigger sync (for testing).

**Response:**
- `202 Accepted`: Sync started

**Example:**
```bash
curl -X POST http://ha-ip:8099/sync
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-09T12:00:00.000Z"
}
```

**Example:**
```bash
curl http://ha-ip:8099/health
```

## Security Best Practices

### 1. Webhook Secret

✅ **DO:**
- Generate with `openssl rand -hex 32`
- Store securely (addon config is encrypted)
- Rotate periodically

❌ **DON'T:**
- Use simple/predictable secrets
- Share across multiple services
- Commit to git

### 2. Access Tokens

✅ **DO:**
- Use fine-grained tokens when possible
- Set minimum required scopes
- Set expiration dates
- Use separate tokens per service

❌ **DON'T:**
- Use personal access token with full permissions
- Share tokens
- Commit to git

### 3. SSH Keys

✅ **DO:**
- Generate dedicated deploy keys
- Use ed25519 algorithm
- Keep private key secure
- Add to GitHub Deploy Keys (repo-level)

❌ **DON'T:**
- Use your personal SSH key
- Set a passphrase (addon can't provide it)
- Share private keys

### 4. Network Security

✅ **DO:**
- Use HTTPS with reverse proxy
- Restrict webhook endpoint access
- Use firewall rules
- Monitor webhook deliveries

❌ **DON'T:**
- Expose directly to internet without HTTPS
- Allow unrestricted access to port 8099

### 5. Repository Security

✅ **DO:**
- Use private repositories for config
- Encrypt secrets with git-crypt or SOPS
- Use .gitignore for sensitive files
- Review commits before merging

❌ **DON'T:**
- Commit actual secrets to git
- Use public repos for sensitive configs
- Push directly to main (use PRs)

## Troubleshooting

### Webhook Not Triggering

**Symptoms:** Push to GitHub but nothing happens

**Check:**
1. GitHub webhook delivery status:
   - Repo → Settings → Webhooks → Recent Deliveries
   - Should show 2xx response

2. Addon logs:
   ```bash
   ha addons logs github_config_sync
   ```

3. Port accessibility:
   ```bash
   curl http://your-ha-ip:8099/health
   ```

**Solutions:**
- Verify webhook URL is correct
- Check firewall/router port forwarding
- Verify webhook secret matches
- Check GitHub webhook has push event enabled

### Authentication Failures

**Symptoms:** Sync fails with authentication error

**Token Auth:**
```
Error: Failed to clone repository: authentication failed
```

**Check:**
- Token hasn't expired
- Token has correct scopes (`repo` or `public_repo`)
- Repository URL format is correct
- Token is pasted completely (no spaces)

**SSH Auth:**
```
Error: Permission denied (publickey)
```

**Check:**
- Public key is added to GitHub
- Private key includes BEGIN/END lines
- Key format is correct (OpenSSH)
- Key has no passphrase

### Sync Failures

**Symptoms:** Webhook received but sync fails

**Check logs:**
```bash
ha addons logs github_config_sync
```

**Common issues:**

1. **Branch doesn't exist**
   ```
   Error: Remote branch not found
   ```
   Solution: Verify `git_branch` setting

2. **Repository not found**
   ```
   Error: Repository not found
   ```
   Solution: Check repository name, ensure token/key has access

3. **Disk space**
   ```
   Error: No space left on device
   ```
   Solution: Free up space, reduce backup retention

### Configuration Validation

**Test your config before pushing:**

```bash
# In your repository
docker run --rm -v $(pwd):/config homeassistant/home-assistant:latest \
  python -m homeassistant --script check_config -c /config
```

### Backup Issues

**List backups:**
```bash
ls -lh /backup/github-sync/
```

**Restore from backup:**
```bash
# Stop addon first
cd /config
tar -xzf /backup/github-sync/config-backup-TIMESTAMP.tar.gz
```

### Debug Mode

Add to config for verbose logging:

```yaml
# In addon configuration
git_repository: "..."
# ... other config ...
```

Set environment variable in code:
```javascript
process.env.DEBUG = 'true';
```

## Workflow Examples

### Basic Workflow

```yaml
# .github/workflows/deploy.yml
name: Deploy to Home Assistant

on:
  push:
    branches: [ main ]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Validate HA Config
        uses: frenck/action-home-assistant@v1
        with:
          path: "."
          secrets: "secrets.yaml"
          version: stable

  # Webhook triggers automatically on push!
```

### Advanced Workflow with Testing

```yaml
name: Test and Deploy

on:
  pull_request:
    branches: [ main ]
  push:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Validate Configuration
        uses: frenck/action-home-assistant@v1
        with:
          path: "."
          secrets: "secrets.yaml"

      - name: YAML Lint
        run: yamllint .

      - name: Test Automations
        run: # your automation tests

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Deployment
        run: echo "Webhook will trigger deployment"

  # Addon receives webhook after this workflow passes
```

## Migration Guide

### From Manual Sync

If you currently manually copy files to HA:

1. Create a new GitHub repository
2. Copy your current `/config` to the repository
3. Add `.gitignore`:
   ```
   secrets.yaml
   *.db
   *.log
   ```
4. Commit and push
5. Install and configure this addon
6. Test with a small change

### From Other Sync Tools

If using git pull scripts or other tools:

1. Disable existing sync mechanism
2. Install this addon
3. Configure with same repository
4. Test thoroughly
5. Remove old sync tool

## FAQ

**Q: Will this work with private repositories?**
A: Yes, use `repo` scope for token auth or deploy key for SSH.

**Q: Can I sync only specific files?**
A: Currently no, it syncs the entire repository to sync_path.

**Q: What happens if GitHub is down?**
A: Sync will fail, but your current config is unchanged.

**Q: Can I trigger sync manually?**
A: Yes, use `POST /sync` endpoint.

**Q: How much disk space do backups use?**
A: Depends on config size. Backups are compressed. Monitor with `du -sh /backup/github-sync/`.

**Q: Can I use this with GitLab/Bitbucket?**
A: Not currently, but webhook validation could be adapted.

**Q: Does this work with HAOS/Container/Core?**
A: Yes, all installation methods are supported.
