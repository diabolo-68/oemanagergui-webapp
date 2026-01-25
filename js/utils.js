/**
 * OE Manager GUI - Utility Functions
 * Shared helper functions used across all views
 */

/**
 * Utility class with static helper methods
 */
class Utils {
    /**
     * Format timestamp to locale time string
     */
    static formatTimestamp(timestamp) {
        if (!timestamp) return '-';
        try {
            const date = new Date(timestamp);
            return date.toLocaleTimeString();
        } catch (e) {
            return timestamp;
        }
    }

    /**
     * Calculate elapsed time from start to now
     */
    static calculateElapsed(startTime) {
        if (!startTime) return '-';
        try {
            const start = new Date(startTime);
            const now = new Date();
            const seconds = Math.floor((now - start) / 1000);
            
            if (seconds < 60) return `${seconds}s`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
            return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
        } catch (e) {
            return '-';
        }
    }

    /**
     * Format bytes to human readable
     */
    static formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Format duration in milliseconds to human readable
     */
    static formatDuration(ms) {
        if (!ms || ms === 0) return '0ms';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }

    /**
     * Truncate string to max length with ellipsis
     */
    static truncate(str, maxLength) {
        if (!str) return '';
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }

    /**
     * Escape HTML special characters
     */
    static escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Update status bar message
     */
    static updateStatus(message) {
        const status = document.getElementById('connectionStatus');
        if (status) status.textContent = message;
    }

    /**
     * Update last refresh time display
     */
    static updateLastRefresh() {
        const elem = document.getElementById('lastUpdate');
        if (elem) elem.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
    }

    /**
     * Show toast notification
     */
    static showToast(message, type = 'info') {
        // Remove existing toasts
        const existingToasts = document.querySelectorAll('.toast');
        existingToasts.forEach(t => t.remove());
        
        // Create container if needed
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        
        // Create toast
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        // Auto-remove
        setTimeout(() => toast.remove(), 5000);
    }
}
