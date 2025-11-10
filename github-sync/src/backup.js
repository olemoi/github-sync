const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { log, exists } = require('./utils');

const execAsync = promisify(exec);

const BACKUP_DIR = '/backup/github-sync';

/**
 * Create a timestamped backup of the config directory
 */
async function createBackup(sourcePath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `config-backup-${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  try {
    // Ensure backup directory exists
    await fs.mkdir(BACKUP_DIR, { recursive: true });

    log.info(`Creating backup: ${backupName}`);

    // Use tar for efficient backup
    await execAsync(`tar -czf "${backupPath}.tar.gz" -C "${sourcePath}" .`);

    log.info(`Backup created: ${backupPath}.tar.gz`);
    return `${backupPath}.tar.gz`;

  } catch (error) {
    log.error(`Failed to create backup: ${error.message}`);
    throw error;
  }
}

/**
 * Restore from a backup
 */
async function restoreBackup(backupPath, targetPath) {
  try {
    if (!await exists(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    log.info(`Restoring backup: ${backupPath}`);

    // Extract backup
    await execAsync(`tar -xzf "${backupPath}" -C "${targetPath}"`);

    log.info('Backup restored successfully');
    return true;

  } catch (error) {
    log.error(`Failed to restore backup: ${error.message}`);
    throw error;
  }
}

/**
 * List all available backups
 */
async function listBackups() {
  try {
    if (!await exists(BACKUP_DIR)) {
      return [];
    }

    const files = await fs.readdir(BACKUP_DIR);
    const backups = files
      .filter(f => f.endsWith('.tar.gz'))
      .map(f => path.join(BACKUP_DIR, f));

    // Get file stats and sort by creation time
    const backupStats = await Promise.all(
      backups.map(async (backup) => {
        const stats = await fs.stat(backup);
        return {
          path: backup,
          name: path.basename(backup),
          created: stats.mtime,
          size: stats.size
        };
      })
    );

    return backupStats.sort((a, b) => b.created - a.created);

  } catch (error) {
    log.error(`Failed to list backups: ${error.message}`);
    return [];
  }
}

/**
 * Clean old backups based on retention policy
 */
async function cleanOldBackups() {
  const retention = parseInt(process.env.BACKUP_RETENTION || '5', 10);

  try {
    const backups = await listBackups();

    if (backups.length <= retention) {
      log.info(`Current backups (${backups.length}) within retention limit (${retention})`);
      return;
    }

    // Remove oldest backups beyond retention limit
    const toRemove = backups.slice(retention);

    log.info(`Removing ${toRemove.length} old backup(s)...`);

    for (const backup of toRemove) {
      await fs.unlink(backup.path);
      log.info(`Removed old backup: ${backup.name}`);
    }

    log.info('Old backups cleaned successfully');

  } catch (error) {
    log.error(`Failed to clean old backups: ${error.message}`);
  }
}

/**
 * Get latest backup
 */
async function getLatestBackup() {
  const backups = await listBackups();
  return backups.length > 0 ? backups[0] : null;
}

/**
 * Rollback to a specific backup or latest
 */
async function rollbackToBackup(backupPath = null) {
  const targetPath = process.env.SYNC_PATH || '/config';

  try {
    // If no backup specified, use latest
    if (!backupPath) {
      const latest = await getLatestBackup();
      if (!latest) {
        throw new Error('No backups available');
      }
      backupPath = latest.path;
      log.info(`Using latest backup: ${latest.name}`);
    }

    // Verify backup exists
    if (!await exists(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    // Create a safety backup before rollback
    log.info('Creating safety backup before rollback...');
    const safetyBackup = await createBackup(targetPath);

    // Restore the backup
    log.info(`Rolling back to: ${path.basename(backupPath)}`);
    await restoreBackup(backupPath, targetPath);

    log.info('Rollback completed successfully');

    return {
      success: true,
      backupUsed: path.basename(backupPath),
      safetyBackup: path.basename(safetyBackup)
    };

  } catch (error) {
    log.error(`Rollback failed: ${error.message}`);
    throw error;
  }
}

/**
 * Delete a specific backup
 */
async function deleteBackup(backupPath) {
  try {
    if (!await exists(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    await fs.unlink(backupPath);
    log.info(`Deleted backup: ${path.basename(backupPath)}`);
    return true;

  } catch (error) {
    log.error(`Failed to delete backup: ${error.message}`);
    throw error;
  }
}

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  cleanOldBackups,
  getLatestBackup,
  rollbackToBackup,
  deleteBackup,
  BACKUP_DIR
};
