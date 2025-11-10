const http = require('http');
const { log } = require('./utils');
const { notifyRestart, notifyRestartCancelled } = require('./notifications');

// Store the current restart timer
let restartTimer = null;
let restartScheduledTime = null;

/**
 * Schedule a restart with delay
 */
async function scheduleRestart(delaySeconds = 10) {
  if (process.env.AUTO_RESTART !== 'true') {
    log.info('Auto-restart disabled, skipping HA restart');
    return { scheduled: false, reason: 'Auto-restart disabled' };
  }

  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    log.warn('SUPERVISOR_TOKEN not available, skipping restart');
    return { scheduled: false, reason: 'No supervisor token' };
  }

  // Cancel any existing restart timer
  if (restartTimer) {
    log.info('Cancelling previous restart timer');
    clearTimeout(restartTimer);
  }

  restartScheduledTime = Date.now() + (delaySeconds * 1000);

  // Send notification about pending restart
  await notifyRestart(delaySeconds);

  log.info(`Home Assistant restart scheduled in ${delaySeconds} seconds`);

  return new Promise((resolve, reject) => {
    restartTimer = setTimeout(async () => {
      try {
        await executeRestart(token);
        restartTimer = null;
        restartScheduledTime = null;
        resolve({ scheduled: true, executed: true });
      } catch (error) {
        restartTimer = null;
        restartScheduledTime = null;
        reject(error);
      }
    }, delaySeconds * 1000);

    // Return immediately with schedule confirmation
    resolve({ scheduled: true, executed: false, delaySeconds });
  });
}

/**
 * Cancel a scheduled restart
 */
function cancelRestart() {
  if (!restartTimer) {
    return { cancelled: false, reason: 'No restart scheduled' };
  }

  clearTimeout(restartTimer);
  restartTimer = null;
  restartScheduledTime = null;

  log.info('Home Assistant restart cancelled');
  notifyRestartCancelled();

  return { cancelled: true };
}

/**
 * Get restart status
 */
function getRestartStatus() {
  if (!restartTimer) {
    return { scheduled: false };
  }

  const remainingSeconds = Math.ceil((restartScheduledTime - Date.now()) / 1000);

  return {
    scheduled: true,
    remainingSeconds: Math.max(0, remainingSeconds)
  };
}

/**
 * Execute the actual restart
 */
function executeRestart(token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'supervisor',
      port: 80,
      path: '/core/restart',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        log.info('Home Assistant restart command sent');
        resolve();
      } else {
        reject(new Error(`Supervisor API returned ${res.statusCode}`));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

module.exports = {
  scheduleRestart,
  cancelRestart,
  getRestartStatus
};
