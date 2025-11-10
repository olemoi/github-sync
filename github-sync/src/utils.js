const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Logging utility
 */
const log = {
  info: (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[INFO] [${timestamp}] ${message}`);
  },

  error: (message) => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR] [${timestamp}] ${message}`);
  },

  warn: (message) => {
    const timestamp = new Date().toISOString();
    console.warn(`[WARN] [${timestamp}] ${message}`);
  },

  debug: (message) => {
    if (process.env.DEBUG === 'true') {
      const timestamp = new Date().toISOString();
      console.log(`[DEBUG] [${timestamp}] ${message}`);
    }
  }
};

/**
 * Check if a file or directory exists
 */
async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy directory recursively
 */
async function copyDirectory(source, destination, options = {}) {
  const { overwrite = false } = options;

  try {
    // Ensure destination exists
    await fs.mkdir(destination, { recursive: true });

    // Use rsync for efficient copying
    const rsyncFlags = overwrite ? '-av' : '-av --ignore-existing';
    const command = `rsync ${rsyncFlags} "${source}/" "${destination}/"`;

    await execAsync(command);

    log.debug(`Copied ${source} to ${destination}`);

  } catch (error) {
    throw new Error(`Failed to copy directory: ${error.message}`);
  }
}

/**
 * Sync directory - mirrors source to destination (deletes files not in source)
 * Excludes Home Assistant internal files
 */
async function syncDirectory(source, destination) {
  try {
    // Ensure destination exists
    await fs.mkdir(destination, { recursive: true });

    // Protected files/directories that should never be deleted
    // Only excludes HA's internal runtime files, NOT user config
    const excludes = [
      '.storage/',           // HA's internal database
      '.cloud/',             // Nabu Casa data
      '.HA_VERSION',         // Version file
      'home-assistant.log*', // Logs
      'home-assistant_v2.db*', // Database
      'OZW_Log.txt',         // OpenZWave logs
      '.uuid',               // Installation ID
      '.google.token',       // Google tokens
      'deps/',               // Python dependencies cache
      'tts/'                 // Text-to-speech cache
    ];

    // Build rsync command with --delete flag and excludes
    const excludeFlags = excludes.map(e => `--exclude="${e}"`).join(' ');
    const command = `rsync -av --delete ${excludeFlags} "${source}/" "${destination}/"`;

    log.info('Syncing directory (this will delete removed files)...');
    log.debug(`Rsync command: ${command}`);

    const { stdout, stderr } = await execAsync(command);

    // Count and log deletions
    const deletions = (stdout.match(/deleting /g) || []).length;
    const changes = stdout.split('\n').filter(line => line && !line.startsWith('sending') && !line.startsWith('total')).length;

    if (deletions > 0) {
      log.info(`Deleted ${deletions} file(s) that were removed from Git`);
    }

    log.info(`Synced ${source} to ${destination} (${changes} changes, ${deletions} deletions)`);

    // Log full output in debug mode
    if (stdout) {
      log.debug(`Rsync output: ${stdout}`);
    }
    if (stderr) {
      log.warn(`Rsync stderr: ${stderr}`);
    }

  } catch (error) {
    throw new Error(`Failed to sync directory: ${error.message}`);
  }
}

/**
 * Remove directory recursively
 */
async function removeDirectory(dirPath) {
  try {
    if (await exists(dirPath)) {
      await fs.rm(dirPath, { recursive: true, force: true });
      log.debug(`Removed directory: ${dirPath}`);
    }
  } catch (error) {
    throw new Error(`Failed to remove directory: ${error.message}`);
  }
}

/**
 * Get directory size in bytes
 */
async function getDirectorySize(dirPath) {
  try {
    const { stdout } = await execAsync(`du -sb "${dirPath}" | cut -f1`);
    return parseInt(stdout.trim(), 10);
  } catch (error) {
    log.error(`Failed to get directory size: ${error.message}`);
    return 0;
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  log,
  exists,
  copyDirectory,
  syncDirectory,
  removeDirectory,
  getDirectorySize,
  formatBytes,
  sleep
};
