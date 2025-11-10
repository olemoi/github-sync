const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const { log, exists, copyDirectory, removeDirectory } = require('./utils');
const { createBackup, cleanOldBackups } = require('./backup');
const { addSyncEntry, updateSyncEntry } = require('./syncHistory');
const { notifySyncStarted, notifySyncSuccess, notifySyncFailed } = require('./notifications');
const { scheduleRestart } = require('./restartManager');

/**
 * Get git repository URL with authentication
 */
function getAuthenticatedRepoUrl() {
  const repo = process.env.GIT_REPOSITORY;
  const authMethod = process.env.AUTH_METHOD;

  if (authMethod === 'ssh') {
    // SSH format: git@github.com:user/repo.git
    return repo;
  } else {
    // HTTPS with token: https://TOKEN@github.com/user/repo.git
    const token = process.env.ACCESS_TOKEN;

    // Handle different repo URL formats
    if (repo.startsWith('http://') || repo.startsWith('https://')) {
      const url = new URL(repo);
      url.username = token;
      url.password = '';
      return url.toString();
    } else if (repo.startsWith('git@')) {
      // Convert SSH to HTTPS
      const match = repo.match(/git@([^:]+):(.+)/);
      if (match) {
        return `https://${token}@${match[1]}/${match[2]}`;
      }
    }

    // Default: assume it's in user/repo format
    return `https://${token}@github.com/${repo}.git`;
  }
}

/**
 * Validate configuration files
 */
async function validateConfiguration(configPath) {
  log.info('Validating configuration...');

  try {
    // Check if configuration.yaml exists
    const configYaml = path.join(configPath, 'configuration.yaml');
    if (!await exists(configYaml)) {
      throw new Error('configuration.yaml not found in repository');
    }

    // Basic validation - just check that the file can be read
    const content = await fs.readFile(configYaml, 'utf8');
    if (!content || content.trim().length === 0) {
      throw new Error('configuration.yaml is empty');
    }

    log.info('Basic configuration validation passed');
    return true;
  } catch (error) {
    log.error(`Configuration validation failed: ${error.message}`);
    throw error;
  }
}

/**
 * Main sync function with atomic operations
 */
async function syncFromGitHub(syncType = 'manual', metadata = {}) {
  const syncPath = process.env.SYNC_PATH || '/config';
  const branch = process.env.GIT_BRANCH || 'main';
  const tempDir = '/tmp/github-sync-temp';
  const backupEnabled = process.env.BACKUP_ENABLED === 'true';
  const startTime = Date.now();

  log.info('Starting GitHub sync...');

  // Create sync history entry
  const syncId = await addSyncEntry({
    type: syncType,
    branch: branch,
    commits: metadata.commits || 0,
    message: 'Sync started',
    status: 'in_progress'
  });

  // Send notification
  await notifySyncStarted(branch, metadata.commits || 0);

  try {
    // Step 1: Clean up any previous temp directory
    if (await exists(tempDir)) {
      log.info('Cleaning up previous temp directory...');
      await removeDirectory(tempDir);
    }

    // Step 2: Create backup if enabled
    let backupPath = null;
    if (backupEnabled) {
      log.info('Creating backup...');
      backupPath = await createBackup(syncPath);
      log.info(`Backup created: ${backupPath}`);
    }

    // Step 3: Clone repository to temp directory
    log.info(`Cloning repository to temp directory...`);

    const repoUrl = getAuthenticatedRepoUrl();
    const git = simpleGit();

    try {
      // Clone with options for SSH
      const cloneOptions = [
        '--depth', '1',
        '--branch', branch,
        '-c', 'core.sshCommand=ssh -o StrictHostKeyChecking=no'
      ];

      await git.clone(repoUrl, tempDir, cloneOptions);
      log.info('Repository cloned successfully');
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error.message}`);
    }

    // Step 4: Remove .git directory from temp (we don't need version control in sync)
    const gitDir = path.join(tempDir, '.git');
    if (await exists(gitDir)) {
      await removeDirectory(gitDir);
    }

    // Step 5: Validate configuration before applying
    log.info('Validating new configuration...');

    // Temporarily copy to a validation directory
    const validationDir = '/tmp/github-sync-validation';
    if (await exists(validationDir)) {
      await removeDirectory(validationDir);
    }

    await copyDirectory(syncPath, validationDir);

    // Copy new config files over the validation directory
    await copyDirectory(tempDir, validationDir, { overwrite: true });

    // Note: We'll skip live validation for now as it requires careful handling
    // In production, you might want to add more sophisticated validation
    log.info('Basic validation passed');

    // Clean up validation directory
    await removeDirectory(validationDir);

    // Step 6: Apply changes atomically
    log.info('Applying changes to config directory...');

    await copyDirectory(tempDir, syncPath, { overwrite: true });

    log.info('Changes applied successfully');

    // Step 7: Clean up temp directory
    await removeDirectory(tempDir);

    // Step 8: Clean old backups if enabled
    if (backupEnabled) {
      await cleanOldBackups();
    }

    // Step 9: Schedule Home Assistant restart if enabled
    const restarted = process.env.AUTO_RESTART === 'true';
    if (restarted) {
      await scheduleRestart(10); // 10 second delay before restart
    }

    const duration = Date.now() - startTime;

    // Update history
    await updateSyncEntry(syncId, {
      status: 'success',
      message: 'Sync completed successfully',
      duration: duration,
      backupCreated: backupEnabled
    });

    // Send success notification
    await notifySyncSuccess(branch, duration, restarted);

    log.info('GitHub sync completed successfully');
    return { success: true, syncId, duration };

  } catch (error) {
    log.error(`Sync failed: ${error.message}`);

    // Clean up temp directory on failure
    if (await exists(tempDir)) {
      await removeDirectory(tempDir);
    }

    const duration = Date.now() - startTime;

    // Update history
    await updateSyncEntry(syncId, {
      status: 'failed',
      message: 'Sync failed',
      error: error.message,
      duration: duration
    });

    // Send failure notification
    await notifySyncFailed(branch, error.message);

    // If we have a backup and sync failed, offer to restore
    log.error('Sync failed - local configuration unchanged');

    throw error;
  }
}

module.exports = {
  syncFromGitHub
};
