/**
 * OE Manager GUI - Utility Functions
 * Shared helper functions used across all views
 */

/**
 * Utility class with static helper methods
 */
class Utils {
    /**
     * Parse ISO date string from PASOE API, normalizing non-standard timezone offsets.
     * PASOE returns timezone offsets like "-00:00" which some browsers don't handle correctly.
     * This function normalizes "-00:00" to "Z" (UTC) for proper parsing.
     * @param {string} dateString - ISO date string from PASOE API
     * @returns {Date|null} - Parsed Date object or null if invalid
     */
    static parseIsoDate(dateString) {
        if (!dateString) return null;
        try {
            // Normalize "-00:00" to "Z" (both mean UTC, but "-00:00" is non-standard)
            let normalized = dateString;
            if (typeof dateString === 'string' && dateString.endsWith('-00:00')) {
                normalized = dateString.slice(0, -6) + 'Z';
            }
            const date = new Date(normalized);
            return isNaN(date.getTime()) ? null : date;
        } catch (e) {
            return null;
        }
    }

    /**
     * Format ISO date string from PASOE API to locale string.
     * Displays the date/time as it appears in the API response (server time),
     * WITHOUT converting to browser's local timezone.
     * @param {string} dateString - ISO date string from PASOE API (e.g., "2026-01-28T22:43:23.910-01:00")
     * @returns {string} - Formatted date string showing server time, or '-' if invalid
     */
    static formatIsoDate(dateString) {
        if (!dateString) return '-';
        try {
            // Parse the ISO string directly to extract date/time components as they appear
            // Format: "2026-01-28T22:43:23.910-01:00" or "2026-01-28T22:43:23.910+01:00"
            const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
            if (!match) return '-';
            
            const [, year, month, day, hours, minutes, seconds] = match;
            
            // Format as locale-friendly string (M/D/YYYY, HH:MM:SS)
            const monthNum = parseInt(month, 10);
            const dayNum = parseInt(day, 10);
            return `${monthNum}/${dayNum}/${year}, ${hours}:${minutes}:${seconds}`;
        } catch (e) {
            return '-';
        }
    }

    /**
     * Format timestamp to locale time string
     */
    static formatTimestamp(timestamp) {
        if (!timestamp) return '-';
        try {
            const date = Utils.parseIsoDate(timestamp) || new Date(timestamp);
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
