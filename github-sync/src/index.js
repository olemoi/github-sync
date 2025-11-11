const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { syncFromGitHub } = require('./gitSync');
const { listBackups, rollbackToBackup, deleteBackup, protectBackup, unprotectBackup } = require('./backup');
const { getStats, getRecentSyncs, clearHistory } = require('./syncHistory');
const { notifyRollbackSuccess, notifyRollbackFailed } = require('./notifications');
const { scheduleRestart, cancelRestart, getRestartStatus } = require('./restartManager');
const { log, formatBytes } = require('./utils');

const app = express();
const port = process.env.WEBHOOK_PORT || 8099;

// Middleware to parse JSON with raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Serve static files for web UI
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  const secret = process.env.WEBHOOK_SECRET;

  if (!signature || !secret) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(req.rawBody);
  const calculatedSignature = 'sha256=' + hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(calculatedSignature)
  );
}

// ============================================================================
// Web UI Routes
// ============================================================================

/**
 * Main dashboard
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Get sync statistics
 */
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    log.error(`Failed to get stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get sync history
 */
app.get('/api/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const history = await getRecentSyncs(limit);
    res.json(history);
  } catch (error) {
    log.error(`Failed to get history: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Clear sync history
 */
app.delete('/api/history', async (req, res) => {
  try {
    await clearHistory();
    res.json({ success: true, message: 'History cleared' });
  } catch (error) {
    log.error(`Failed to clear history: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get backups list
 */
app.get('/api/backups', async (req, res) => {
  try {
    const backups = await listBackups();
    const formatted = backups.map(b => ({
      ...b,
      sizeFormatted: formatBytes(b.size),
      created: b.created.toISOString()
    }));
    res.json(formatted);
  } catch (error) {
    log.error(`Failed to list backups: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Rollback to a backup
 */
app.post('/api/rollback', async (req, res) => {
  try {
    const { backupPath } = req.body;

    log.info(`Rollback requested${backupPath ? `: ${backupPath}` : ' (latest)'}`);

    const result = await rollbackToBackup(backupPath || null);

    await notifyRollbackSuccess(result.backupUsed);

    res.json({
      success: true,
      message: 'Rollback completed successfully',
      ...result
    });

  } catch (error) {
    log.error(`Rollback failed: ${error.message}`);
    await notifyRollbackFailed(error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a backup
 */
app.delete('/api/backups/:filename(*)', async (req, res) => {
  try {
    const { filename } = req.params;
    const backupPath = path.join('/backup/github-sync', filename);

    await deleteBackup(backupPath);

    res.json({
      success: true,
      message: 'Backup deleted'
    });

  } catch (error) {
    log.error(`Failed to delete backup: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Protect (pin) a backup
 */
app.post('/api/backups/:filename(*)/protect', async (req, res) => {
  try {
    const { filename } = req.params;
    const backupPath = path.join('/backup/github-sync', filename);

    await protectBackup(backupPath);

    res.json({
      success: true,
      message: 'Backup protected from auto-deletion'
    });

  } catch (error) {
    log.error(`Failed to protect backup: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Unprotect (unpin) a backup
 */
app.post('/api/backups/:filename(*)/unprotect', async (req, res) => {
  try {
    const { filename } = req.params;
    const backupPath = path.join('/backup/github-sync', filename);

    await unprotectBackup(backupPath);

    res.json({
      success: true,
      message: 'Backup unprotected'
    });

  } catch (error) {
    log.error(`Failed to unprotect backup: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Schedule Home Assistant restart
 */
app.post('/api/restart', async (req, res) => {
  try {
    const delaySeconds = parseInt(req.body.delaySeconds || '10', 10);
    log.info(`Restart requested via API with ${delaySeconds}s delay`);

    const result = await scheduleRestart(delaySeconds);

    res.json({
      success: result.scheduled,
      ...result
    });

  } catch (error) {
    log.error(`Restart scheduling failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cancel scheduled restart
 */
app.post('/api/restart/cancel', async (req, res) => {
  try {
    log.info('Restart cancel requested via API');
    const result = cancelRestart();
    res.json(result);
  } catch (error) {
    log.error(`Restart cancel failed: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get restart status
 */
app.get('/api/restart/status', async (req, res) => {
  try {
    const status = getRestartStatus();
    res.json(status);
  } catch (error) {
    log.error(`Failed to get restart status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get configuration info
 */
app.get('/api/config', (req, res) => {
  res.json({
    repository: process.env.GIT_REPOSITORY,
    branch: process.env.GIT_BRANCH || 'main',
    authMethod: process.env.AUTH_METHOD || 'token',
    autoRestart: process.env.AUTO_RESTART === 'true',
    backupEnabled: process.env.BACKUP_ENABLED === 'true',
    backupRetention: parseInt(process.env.BACKUP_RETENTION || '5', 10),
    syncPath: process.env.SYNC_PATH || '/config',
    notificationsEnabled: process.env.NOTIFICATIONS_ENABLED === 'true'
  });
});

// ============================================================================
// GitHub Webhook Routes
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * Webhook endpoint
 */
app.post('/webhook', async (req, res) => {
  try {
    log.info('Received webhook request');

    // Verify signature
    if (!verifyGitHubSignature(req)) {
      log.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.headers['x-github-event'];
    const payload = req.body;

    log.info(`GitHub event: ${event}`);

    // Only process push events to the configured branch
    if (event !== 'push') {
      log.info(`Ignoring event type: ${event}`);
      return res.json({ message: 'Event ignored' });
    }

    const branch = payload.ref?.replace('refs/heads/', '');
    const expectedBranch = process.env.GIT_BRANCH || 'main';

    if (branch !== expectedBranch) {
      log.info(`Ignoring push to branch: ${branch} (expected: ${expectedBranch})`);
      return res.json({ message: 'Branch ignored' });
    }

    const commits = payload.commits?.length || 0;
    log.info(`Processing push to ${branch} (${commits} commits)`);

    // Acknowledge webhook immediately
    res.status(202).json({
      message: 'Sync started',
      branch: branch,
      commits: commits
    });

    // Process sync asynchronously
    try {
      await syncFromGitHub('webhook', { commits, branch });
      log.info('Sync completed successfully');
    } catch (error) {
      log.error(`Sync failed: ${error.message}`);
    }

  } catch (error) {
    log.error(`Webhook handler error: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Manual sync endpoint
 */
app.post('/sync', async (req, res) => {
  try {
    log.info('Manual sync triggered');

    // Check for optional API key in production
    const apiKey = req.headers['x-api-key'];
    if (process.env.API_KEY && apiKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.status(202).json({ message: 'Sync started' });

    await syncFromGitHub('manual', {});
    log.info('Manual sync completed successfully');
  } catch (error) {
    log.error(`Manual sync failed: ${error.message}`);
  }
});

/**
 * Manual sync endpoint (from UI)
 */
app.post('/api/sync', async (req, res) => {
  try {
    log.info('Manual sync triggered from UI');

    res.status(202).json({ message: 'Sync started' });

    await syncFromGitHub('manual', {});
    log.info('Manual sync completed successfully');
  } catch (error) {
    log.error(`Manual sync failed: ${error.message}`);
  }
});

// ============================================================================
// Server Startup
// ============================================================================

// Start server
app.listen(port, '0.0.0.0', () => {
  log.info(`GitHub Sync addon started`);
  log.info(`Webhook server listening on port ${port}`);
  log.info(`Web UI available at http://localhost:${port}`);
  log.info(`Repository: ${process.env.GIT_REPOSITORY}`);
  log.info(`Branch: ${process.env.GIT_BRANCH || 'main'}`);
  log.info(`Auth method: ${process.env.AUTH_METHOD || 'token'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});
