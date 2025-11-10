const { exec } = require('child_process');
const { promisify } = require('util');
const { log } = require('./utils');

const execAsync = promisify(exec);

/**
 * Send a notification via Home Assistant
 */
async function sendNotification(title, message, data = {}) {
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') {
    log.debug('Notifications disabled, skipping');
    return;
  }

  const service = process.env.NOTIFICATION_SERVICE || 'notify.notify';

  try {
    // Use Home Assistant CLI to send notification
    const payload = JSON.stringify({
      title: title,
      message: message,
      data: {
        ...data,
        tag: 'github-sync'
      }
    });

    // Call service using ha CLI
    const command = `ha services call ${service} --arguments '${payload}'`;
    await execAsync(command);

    log.info(`Notification sent: ${title}`);
  } catch (error) {
    log.error(`Failed to send notification: ${error.message}`);
    // Don't throw - notifications are not critical
  }
}

/**
 * Notify sync started
 */
async function notifySyncStarted(branch, commits = 0) {
  await sendNotification(
    'GitHub Sync Started',
    `Syncing ${commits} commit(s) from branch '${branch}'`,
    {
      branch,
      commits
    }
  );
}

/**
 * Notify sync success
 */
async function notifySyncSuccess(branch, duration, restarted = false) {
  const durationSec = Math.round(duration / 1000);
  let message = `Successfully synced from '${branch}' in ${durationSec}s`;

  if (restarted) {
    message += '. Home Assistant is restarting...';
  }

  await sendNotification(
    'GitHub Sync Successful',
    message,
    {
      branch,
      duration,
      restarted
    }
  );
}

/**
 * Notify sync failure
 */
async function notifySyncFailed(branch, error) {
  await sendNotification(
    'GitHub Sync Failed',
    `Failed to sync from '${branch}': ${error}`,
    {
      branch,
      error,
      priority: 'high'
    }
  );
}

/**
 * Notify rollback success
 */
async function notifyRollbackSuccess(backupName) {
  await sendNotification(
    'Configuration Rolled Back',
    `Successfully restored configuration from backup: ${backupName}`,
    {
      backup: backupName
    }
  );
}

/**
 * Notify rollback failure
 */
async function notifyRollbackFailed(error) {
  await sendNotification(
    'Rollback Failed',
    `Failed to restore configuration: ${error}`,
    {
      error,
      priority: 'high'
    }
  );
}

module.exports = {
  sendNotification,
  notifySyncStarted,
  notifySyncSuccess,
  notifySyncFailed,
  notifyRollbackSuccess,
  notifyRollbackFailed
};
