const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { log, exists } = require('./utils');

const execAsync = promisify(exec);

const BACKUP_DIR = '/backup/github-sync';
const PROTECTED_BACKUPS_FILE = path.join(BACKUP_DIR, '.protected-backups.json');

/**
 * Load protected backups list
 */
async function loadProtectedBackups() {
  try {
    if (await exists(PROTECTED_BACKUPS_FILE)) {
      const data = await fs.readFile(PROTECTED_BACKUPS_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    log.error(`Failed to load protected backups: ${error.message}`);
    return [];
  }
}

/**
 * Save protected backups list
 */
async function saveProtectedBackups(protectedList) {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    await fs.writeFile(PROTECTED_BACKUPS_FILE, JSON.stringify(protectedList, null, 2));
  } catch (error) {
    log.error(`Failed to save protected backups: ${error.message}`);
  }
}

/**
 * Check if a backup is protected
 */
async function isBackupProtected(backupPath) {
  const protected = await loadProtectedBackups();
  return protected.includes(path.basename(backupPath));
}

/**
 * Protect (pin) a backup from auto-deletion
 */
async function protectBackup(backupPath) {
  try {
    if (!await exists(backupPath)) {
      throw new Error(`Backup not found: ${backupPath}`);
    }

    const protected = await loadProtectedBackups();
    const backupName = path.basename(backupPath);

    if (!protected.includes(backupName)) {
      protected.push(backupName);
      await saveProtectedBackups(protected);
      log.info(`Protected backup: ${backupName}`);
    }

    return true;
  } catch (error) {
    log.error(`Failed to protect backup: ${error.message}`);
    throw error;
  }
}

/**
 * Unprotect (unpin) a backup
 */
async function unprotectBackup(backupPath) {
  try {
    const protected = await loadProtectedBackups();
    const backupName = path.basename(backupPath);

    const filtered = protected.filter(name => name !== backupName);

    if (filtered.length !== protected.length) {
      await saveProtectedBackups(filtered);
      log.info(`Unprotected backup: ${backupName}`);
    }

    return true;
  } catch (error) {
    log.error(`Failed to unprotect backup: ${error.message}`);
    throw error;
  }
}

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

    const protectedList = await loadProtectedBackups();

    // Get file stats and sort by creation time
    const backupStats = await Promise.all(
      backups.map(async (backup) => {
        const stats = await fs.stat(backup);
        const backupName = path.basename(backup);
        return {
          path: backup,
          name: backupName,
          created: stats.mtime,
          size: stats.size,
          protected: protectedList.includes(backupName)
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
 * Protected backups are never deleted
 */
async function cleanOldBackups() {
  const retention = parseInt(process.env.BACKUP_RETENTION || '5', 10);

  try {
    const allBackups = await listBackups();

    // Separate protected and unprotected backups
    const unprotectedBackups = allBackups.filter(b => !b.protected);
    const protectedBackups = allBackups.filter(b => b.protected);

    if (unprotectedBackups.length <= retention) {
      log.info(`Current backups: ${unprotectedBackups.length} unprotected, ${protectedBackups.length} protected (retention: ${retention})`);
      return;
    }

    // Remove oldest unprotected backups beyond retention limit
    const toRemove = unprotectedBackups.slice(retention);

    log.info(`Removing ${toRemove.length} old backup(s) (keeping ${protectedBackups.length} protected)...`);

    for (const backup of toRemove) {
      await fs.unlink(backup.path);
      log.info(`Removed old backup: ${backup.name}`);
    }

    log.info(`Backups cleaned: ${unprotectedBackups.length - toRemove.length} kept, ${protectedBackups.length} protected, ${toRemove.length} deleted`);

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
  protectBackup,
  unprotectBackup,
  isBackupProtected,
  BACKUP_DIR
};
