const fs = require('fs').promises;
const path = require('path');
const { log, exists } = require('./utils');

const HISTORY_FILE = '/data/sync-history.json';
const MAX_HISTORY_ENTRIES = 100;

/**
 * Sync history entry structure
 * {
 *   id: string,
 *   timestamp: string (ISO),
 *   type: 'webhook' | 'manual',
 *   status: 'success' | 'failed' | 'in_progress',
 *   branch: string,
 *   commits: number,
 *   message: string,
 *   error: string (optional),
 *   duration: number (ms),
 *   backupCreated: boolean,
 *   filesChanged: number
 * }
 */

/**
 * Load sync history from file
 */
async function loadHistory() {
  try {
    if (!await exists(HISTORY_FILE)) {
      return [];
    }

    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    log.error(`Failed to load sync history: ${error.message}`);
    return [];
  }
}

/**
 * Save sync history to file
 */
async function saveHistory(history) {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(HISTORY_FILE);
    await fs.mkdir(dataDir, { recursive: true });

    // Keep only the most recent entries
    const trimmedHistory = history.slice(0, MAX_HISTORY_ENTRIES);

    await fs.writeFile(HISTORY_FILE, JSON.stringify(trimmedHistory, null, 2));
  } catch (error) {
    log.error(`Failed to save sync history: ${error.message}`);
  }
}

/**
 * Add a new sync entry
 */
async function addSyncEntry(entry) {
  const history = await loadHistory();

  const newEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    status: 'in_progress',
    ...entry
  };

  history.unshift(newEntry);
  await saveHistory(history);

  return newEntry.id;
}

/**
 * Update an existing sync entry
 */
async function updateSyncEntry(id, updates) {
  const history = await loadHistory();
  const index = history.findIndex(e => e.id === id);

  if (index === -1) {
    log.warn(`Sync entry not found: ${id}`);
    return;
  }

  history[index] = {
    ...history[index],
    ...updates
  };

  await saveHistory(history);
}

/**
 * Get sync statistics
 */
async function getStats() {
  const history = await loadHistory();

  const stats = {
    total: history.length,
    successful: history.filter(e => e.status === 'success').length,
    failed: history.filter(e => e.status === 'failed').length,
    inProgress: history.filter(e => e.status === 'in_progress').length,
    lastSync: history.length > 0 ? history[0] : null,
    lastSuccessfulSync: history.find(e => e.status === 'success') || null,
    averageDuration: calculateAverageDuration(history)
  };

  return stats;
}

/**
 * Get recent sync entries
 */
async function getRecentSyncs(limit = 20) {
  const history = await loadHistory();
  return history.slice(0, limit);
}

/**
 * Clear sync history
 */
async function clearHistory() {
  try {
    if (await exists(HISTORY_FILE)) {
      await fs.unlink(HISTORY_FILE);
    }
    log.info('Sync history cleared');
  } catch (error) {
    log.error(`Failed to clear history: ${error.message}`);
    throw error;
  }
}

/**
 * Generate unique ID
 */
function generateId() {
  return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate average duration from history
 */
function calculateAverageDuration(history) {
  const completedSyncs = history.filter(e =>
    e.status !== 'in_progress' && e.duration !== undefined
  );

  if (completedSyncs.length === 0) return 0;

  const total = completedSyncs.reduce((sum, e) => sum + e.duration, 0);
  return Math.round(total / completedSyncs.length);
}

module.exports = {
  addSyncEntry,
  updateSyncEntry,
  getStats,
  getRecentSyncs,
  clearHistory,
  loadHistory
};
