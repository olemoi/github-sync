const http = require('http');
const { log } = require('./utils');

/**
 * Send a notification via Home Assistant
 */
async function sendNotification(title, message, data = {}) {
  if (process.env.NOTIFICATIONS_ENABLED !== 'true') {
    log.debug('Notifications disabled, skipping');
    return;
  }

  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    log.debug('No supervisor token, skipping notification');
    return;
  }

  const service = process.env.NOTIFICATION_SERVICE || 'notify.notify';

  try {
    const payload = {
      title: title,
      message: message,
      data: {
        ...data,
        tag: 'github-sync'
      }
    };

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ service, service_data: payload });

      const options = {
        hostname: 'supervisor',
        port: 80,
        path: '/core/api/services/notify/notify',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          log.info(`Notification sent: ${title}`);
          resolve();
        } else {
          log.warn(`Notification failed with status ${res.statusCode}`);
          resolve(); // Don't reject - notifications are not critical
        }
      });

      req.on('error', (error) => {
        log.error(`Failed to send notification: ${error.message}`);
        resolve(); // Don't reject - notifications are not critical
      });

      req.write(postData);
      req.end();
    });
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

/**
 * Notify restart scheduled
 */
async function notifyRestart(delaySeconds) {
  await sendNotification(
    'Home Assistant Restart Scheduled',
    `Home Assistant will restart in ${delaySeconds} seconds. Go to GitHub Sync addon to cancel.`,
    {
      delaySeconds,
      priority: 'high',
      actions: [{
        action: 'cancel_restart',
        title: 'Cancel Restart'
      }]
    }
  );
}

/**
 * Notify restart cancelled
 */
async function notifyRestartCancelled() {
  await sendNotification(
    'Restart Cancelled',
    'Home Assistant restart has been cancelled',
    {}
  );
}

module.exports = {
  sendNotification,
  notifySyncStarted,
  notifySyncSuccess,
  notifySyncFailed,
  notifyRollbackSuccess,
  notifyRollbackFailed,
  notifyRestart,
  notifyRestartCancelled
};
