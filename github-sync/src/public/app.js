// Global state
let selectedBackupForRollback = null;
let autoRefreshInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    loadConfiguration();
    refreshData();

    // Auto-refresh every 30 seconds
    autoRefreshInterval = setInterval(refreshData, 30000);
});

// Tab switching
function initializeTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tabName}-tab`).classList.add('active');

    // Load data for the tab
    if (tabName === 'backups') {
        loadBackups();
    }
}

// Load configuration
async function loadConfiguration() {
    try {
        const response = await fetch('./api/config');
        const config = await response.json();

        document.getElementById('repo-name').textContent = config.repository || 'Not configured';
        document.getElementById('branch-name').textContent = config.branch || 'main';
        document.getElementById('backup-subtitle').textContent = `Retention: ${config.backupRetention} backups`;
    } catch (error) {
        console.error('Failed to load configuration:', error);
    }
}

// Refresh all data
async function refreshData() {
    await loadStats();
    await loadHistory();
}

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('./api/stats');
        const stats = await response.json();

        document.getElementById('stat-total').textContent = stats.total || 0;
        document.getElementById('stat-success').textContent = stats.successful || 0;
        document.getElementById('stat-failed').textContent = stats.failed || 0;

        const avgDuration = stats.averageDuration || 0;
        const avgSeconds = Math.round(avgDuration / 1000);
        document.getElementById('stat-duration').textContent = avgSeconds ? `${avgSeconds}s` : '-';

    } catch (error) {
        console.error('Failed to load stats:', error);
        showToast('Failed to load statistics', 'error');
    }
}

// Load sync history
async function loadHistory() {
    const historyList = document.getElementById('history-list');

    try {
        const response = await fetch('./api/history?limit=20');
        const history = await response.json();

        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty">No sync history yet</div>';
            return;
        }

        historyList.innerHTML = history.map(item => renderHistoryItem(item)).join('');

    } catch (error) {
        console.error('Failed to load history:', error);
        historyList.innerHTML = '<div class="empty">Failed to load history</div>';
    }
}

// Render a history item
function renderHistoryItem(item) {
    const date = new Date(item.timestamp);
    const timeAgo = getTimeAgo(date);
    const duration = item.duration ? Math.round(item.duration / 1000) + 's' : 'N/A';

    return `
        <div class="history-item ${item.status}">
            <div class="history-header">
                <div class="history-status">
                    <span class="status-badge ${item.status}">${item.status.replace('_', ' ')}</span>
                    <span>${item.type || 'manual'}</span>
                </div>
                <div class="history-time">${timeAgo}</div>
            </div>
            <div class="history-details">
                ${item.branch ? `Branch: ${item.branch}` : ''}
                ${item.commits ? ` • ${item.commits} commit(s)` : ''}
                ${item.duration ? ` • Duration: ${duration}` : ''}
                ${item.backupCreated ? ' • Backup created' : ''}
            </div>
            ${item.error ? `<div class="history-error">${escapeHtml(item.error)}</div>` : ''}
        </div>
    `;
}

// Load backups
async function loadBackups() {
    const backupsList = document.getElementById('backups-list');

    try {
        const response = await fetch('./api/backups');
        const backups = await response.json();

        if (backups.length === 0) {
            backupsList.innerHTML = '<div class="empty">No backups available</div>';
            return;
        }

        backupsList.innerHTML = backups.map(backup => renderBackupItem(backup)).join('');

    } catch (error) {
        console.error('Failed to load backups:', error);
        backupsList.innerHTML = '<div class="empty">Failed to load backups</div>';
    }
}

// Render a backup item
function renderBackupItem(backup) {
    const date = new Date(backup.created);
    const dateStr = date.toLocaleString();
    const protectedBadge = backup.protected ? '<span class="protected-badge">📌 Protected</span>' : '';
    const pinButtonText = backup.protected ? 'Unpin' : 'Pin';
    const pinButtonClass = backup.protected ? 'btn-secondary' : 'btn-primary';
    const pinAction = backup.protected ? 'unpinBackup' : 'pinBackup';

    return `
        <div class="backup-item ${backup.protected ? 'protected' : ''}">
            <div class="backup-info">
                <h4>${backup.name} ${protectedBadge}</h4>
                <div class="backup-meta">
                    ${dateStr} • ${backup.sizeFormatted}
                </div>
            </div>
            <div class="backup-actions">
                <button class="btn ${pinButtonClass} btn-small" onclick="${pinAction}('${backup.name}')" title="${backup.protected ? 'Remove protection' : 'Protect from auto-deletion'}">
                    ${pinButtonText}
                </button>
                <button class="btn btn-warning btn-small" onclick="rollbackToBackup('${backup.path}')">
                    Restore
                </button>
                <button class="btn btn-secondary btn-small" onclick="deleteBackup('${backup.name}')" ${backup.protected ? 'disabled title="Unpin before deleting"' : ''}>
                    Delete
                </button>
            </div>
        </div>
    `;
}

// Show rollback modal
async function showRollbackModal() {
    const modal = document.getElementById('rollback-modal');
    const backupList = document.getElementById('rollback-backup-list');

    modal.classList.add('active');
    selectedBackupForRollback = null;

    // Load backups
    try {
        const response = await fetch('./api/backups');
        const backups = await response.json();

        if (backups.length === 0) {
            backupList.innerHTML = '<div class="empty">No backups available</div>';
            return;
        }

        backupList.innerHTML = backups.map(backup => {
            const date = new Date(backup.created);
            const dateStr = date.toLocaleString();

            return `
                <div class="backup-select-item" onclick="selectBackupForRollback('${backup.path}', this)">
                    <div><strong>${backup.name}</strong></div>
                    <div class="backup-meta">${dateStr} • ${backup.sizeFormatted}</div>
                </div>
            `;
        }).join('');

    } catch (error) {
        backupList.innerHTML = '<div class="empty">Failed to load backups</div>';
    }
}

// Close rollback modal
function closeRollbackModal() {
    document.getElementById('rollback-modal').classList.remove('active');
    selectedBackupForRollback = null;
}

// Select backup for rollback
function selectBackupForRollback(backupPath, element) {
    selectedBackupForRollback = backupPath;

    // Update UI
    document.querySelectorAll('.backup-select-item').forEach(item => {
        item.classList.remove('selected');
    });
    element.classList.add('selected');
}

// Perform rollback
async function performRollback() {
    if (!confirm('Are you sure you want to rollback? This will replace your current configuration.')) {
        return;
    }

    closeRollbackModal();

    try {
        const response = await fetch('./api/rollback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                backupPath: selectedBackupForRollback
            })
        });

        const result = await response.json();

        if (response.ok) {
            showToast(`Rollback successful: ${result.backupUsed}`, 'success');
            refreshData();
        } else {
            showToast(`Rollback failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast('Rollback request failed', 'error');
    }
}

// Rollback to specific backup (from backups tab)
async function rollbackToBackup(backupPath) {
    if (!confirm('Are you sure you want to restore this backup? This will replace your current configuration.')) {
        return;
    }

    try {
        const response = await fetch('./api/rollback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backupPath })
        });

        const result = await response.json();

        if (response.ok) {
            showToast(`Rollback successful: ${result.backupUsed}`, 'success');
            refreshData();
        } else {
            showToast(`Rollback failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast('Rollback request failed', 'error');
    }
}

// Delete backup
async function deleteBackup(filename) {
    if (!confirm(`Are you sure you want to delete this backup?\n\n${filename}`)) {
        return;
    }

    try {
        const response = await fetch(`/api/backups/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Backup deleted', 'success');
            loadBackups();
        } else {
            showToast(`Failed to delete backup: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast('Delete request failed', 'error');
    }
}

// Trigger manual sync
async function triggerSync() {
    if (!confirm('Trigger a manual sync from GitHub?')) {
        return;
    }

    showToast('Sync started...', 'info');

    try {
        const response = await fetch('./api/sync', {
            method: 'POST'
        });

        if (response.ok) {
            showToast('Sync started successfully', 'success');

            // Refresh data after a delay to see the results
            setTimeout(refreshData, 3000);
        } else {
            showToast('Failed to start sync', 'error');
        }
    } catch (error) {
        showToast('Sync request failed', 'error');
    }
}

// Clear history
async function clearHistory() {
    if (!confirm('Are you sure you want to clear the sync history?')) {
        return;
    }

    try {
        const response = await fetch('./api/history', {
            method: 'DELETE'
        });

        if (response.ok) {
            showToast('History cleared', 'success');
            await loadHistory();
            await loadStats();
        } else {
            showToast('Failed to clear history', 'error');
        }
    } catch (error) {
        showToast('Request failed', 'error');
    }
}

// Show toast notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Utility: Get time ago string
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' minutes ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';

    return date.toLocaleDateString();
}

// Utility: Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modal on outside click
window.addEventListener('click', (e) => {
    const modal = document.getElementById('rollback-modal');
    if (e.target === modal) {
        closeRollbackModal();
    }
});

// ============================================================================
// Restart Management
// ============================================================================

let restartCheckInterval = null;

/**
 * Check restart status
 */
async function checkRestartStatus() {
    try {
        const response = await fetch('./api/restart/status');
        const status = await response.json();

        if (status.scheduled && status.remainingSeconds > 0) {
            showRestartBanner(status.remainingSeconds);
        } else {
            hideRestartBanner();
        }
    } catch (error) {
        console.error('Failed to check restart status:', error);
    }
}

/**
 * Show restart countdown banner
 */
function showRestartBanner(seconds) {
    const banner = document.getElementById('restart-banner');
    const countdown = document.getElementById('restart-countdown');
    
    countdown.textContent = seconds;
    banner.classList.remove('hidden');

    // Start polling if not already running
    if (!restartCheckInterval) {
        restartCheckInterval = setInterval(checkRestartStatus, 1000);
    }
}

/**
 * Hide restart banner
 */
function hideRestartBanner() {
    const banner = document.getElementById('restart-banner');
    banner.classList.add('hidden');

    // Stop polling
    if (restartCheckInterval) {
        clearInterval(restartCheckInterval);
        restartCheckInterval = null;
    }
}

/**
 * Cancel restart countdown
 */
async function cancelRestartCountdown() {
    try {
        const response = await fetch('./api/restart/cancel', {
            method: 'POST'
        });

        const result = await response.json();

        if (result.cancelled) {
            showToast('Restart cancelled', 'success');
            hideRestartBanner();
        } else {
            showToast(result.reason || 'No restart to cancel', 'info');
        }
    } catch (error) {
        console.error('Failed to cancel restart:', error);
        showToast('Failed to cancel restart', 'error');
    }
}

// Start checking restart status on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check immediately
    checkRestartStatus();
    
    // Then check every 2 seconds
    setInterval(checkRestartStatus, 2000);
});

// ============================================================================
// Backup Protection (Pin/Unpin)
// ============================================================================

/**
 * Pin (protect) a backup from auto-deletion
 */
async function pinBackup(filename) {
    try {
        const response = await fetch('./api/backups/' + encodeURIComponent(filename) + '/protect', {
            method: 'POST'
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Backup protected from auto-deletion', 'success');
            await loadBackups();
        } else {
            showToast(result.error || 'Failed to protect backup', 'error');
        }
    } catch (error) {
        console.error('Failed to protect backup:', error);
        showToast('Failed to protect backup', 'error');
    }
}

/**
 * Unpin (unprotect) a backup
 */
async function unpinBackup(filename) {
    try {
        const response = await fetch('./api/backups/' + encodeURIComponent(filename) + '/unprotect', {
            method: 'POST'
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Backup unprotected', 'success');
            await loadBackups();
        } else {
            showToast(result.error || 'Failed to unprotect backup', 'error');
        }
    } catch (error) {
        console.error('Failed to unprotect backup:', error);
        showToast('Failed to unprotect backup', 'error');
    }
}
