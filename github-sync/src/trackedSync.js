const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { log, exists } = require('./utils');

const execAsync = promisify(exec);

const STATE_FILE = '/backup/github-sync/.synced-files.json';

/**
 * Load the list of files we've previously synced from Git
 */
async function loadSyncedFiles() {
  try {
    if (await exists(STATE_FILE)) {
      const data = await fs.readFile(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    log.error(`Failed to load synced files state: ${error.message}`);
    return [];
  }
}

/**
 * Save the list of files we've synced from Git
 */
async function saveSyncedFiles(files) {
  try {
    const dir = path.dirname(STATE_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(files, null, 2));
    log.info(`Saved state for ${files.length} tracked files`);
  } catch (error) {
    log.error(`Failed to save synced files state: ${error.message}`);
  }
}

/**
 * Get list of all files tracked in the Git repository
 */
async function getGitTrackedFiles(gitRepoPath) {
  try {
    const { stdout } = await execAsync('git ls-files', { cwd: gitRepoPath });
    const files = stdout.trim().split('\n').filter(f => f.length > 0);
    log.info(`Found ${files.length} files tracked in Git repository`);
    return files;
  } catch (error) {
    log.error(`Failed to get Git tracked files: ${error.message}`);
    throw error;
  }
}

/**
 * Recursively copy a file, creating directories as needed
 */
async function copyFile(sourcePath, destPath) {
  try {
    // Create destination directory if it doesn't exist
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });

    // Copy file
    await fs.copyFile(sourcePath, destPath);
  } catch (error) {
    throw new Error(`Failed to copy ${sourcePath} to ${destPath}: ${error.message}`);
  }
}

/**
 * Safely sync files from Git repository to target directory
 * Only touches files that are tracked in Git
 * Only deletes files that were previously synced from Git
 */
async function trackedSync(gitRepoPath, targetPath) {
  log.info('Starting tracked sync (safe mode)...');

  try {
    // Get current files tracked in Git
    const currentGitFiles = await getGitTrackedFiles(gitRepoPath);

    // Get previously synced files
    const previouslySyncedFiles = await loadSyncedFiles();

    let copiedCount = 0;
    let deletedCount = 0;
    let skippedCount = 0;

    // Copy all Git-tracked files to target
    log.info(`Copying ${currentGitFiles.length} files from Git to ${targetPath}...`);
    for (const relativeFile of currentGitFiles) {
      const sourcePath = path.join(gitRepoPath, relativeFile);
      const destPath = path.join(targetPath, relativeFile);

      try {
        await copyFile(sourcePath, destPath);
        copiedCount++;
      } catch (error) {
        log.error(`Failed to copy ${relativeFile}: ${error.message}`);
        skippedCount++;
      }
    }

    // Delete files that were previously synced but are no longer in Git
    const filesToDelete = previouslySyncedFiles.filter(f => !currentGitFiles.includes(f));

    if (filesToDelete.length > 0) {
      log.info(`Removing ${filesToDelete.length} file(s) that were deleted from Git...`);

      for (const relativeFile of filesToDelete) {
        const filePath = path.join(targetPath, relativeFile);

        try {
          if (await exists(filePath)) {
            await fs.unlink(filePath);
            deletedCount++;
            log.info(`Deleted: ${relativeFile}`);
          }
        } catch (error) {
          log.error(`Failed to delete ${relativeFile}: ${error.message}`);
        }
      }
    }

    // Save new state
    await saveSyncedFiles(currentGitFiles);

    log.info(`Tracked sync complete: ${copiedCount} copied, ${deletedCount} deleted, ${skippedCount} skipped`);
    log.info(`Files NOT in Git repository are preserved and untouched`);

    return {
      copied: copiedCount,
      deleted: deletedCount,
      skipped: skippedCount,
      tracked: currentGitFiles.length
    };

  } catch (error) {
    log.error(`Tracked sync failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  trackedSync,
  loadSyncedFiles,
  saveSyncedFiles,
  getGitTrackedFiles
};
