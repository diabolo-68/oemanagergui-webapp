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

    // ==================== Time-axis helpers (Lifecycles charts) ====================

    /**
     * Format seconds since midnight as HH:MM:SS.
     */
    static formatClockTime(seconds) {
        if (seconds === null || seconds === undefined) return '??:??:??';
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(Math.floor(seconds % 60))}`;
    }

    /**
     * Format a span in seconds as "1h 2m 3s".
     */
    static formatSpan(seconds) {
        const total = Math.max(0, Math.round(seconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        if (h > 0) return `${h}h ${m}m ${s}s`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    /**
     * Pick a "nice" tick interval (seconds) for a time axis.
     */
    static computeTickInterval(rangeSeconds, widthPx) {
        const targetTicks = Math.max(3, Math.floor(widthPx / 100));
        const rawInterval = rangeSeconds / targetTicks;
        const nice = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];
        return nice.find(n => n >= rawInterval) ?? 86400;
    }

    /**
     * Format an axis tick label; seconds are shown only for sub-minute intervals.
     */
    static formatTimeAxis(seconds, tickInterval) {
        const full = Utils.formatClockTime(seconds);
        return tickInterval < 60 ? full : full.substring(0, 5);
    }

    /**
     * Zoom a time window around a ratio (0..1) of its width, clamped to one day.
     * @returns {{xMin: number, xMax: number}}
     */
    static zoomRange(xMin, xMax, ratio, zoomOut) {
        const day = 86400;
        const range = xMax - xMin;
        const anchor = xMin + ratio * range;
        const newRange = Math.max(5, Math.min(day, range * (zoomOut ? 1.3 : 1 / 1.3)));
        let newMin = anchor - newRange * ratio;
        let newMax = newMin + newRange;
        if (newMin < 0) { newMin = 0; newMax = newRange; }
        if (newMax > day) { newMax = day; newMin = day - newRange; }
        return { xMin: newMin, xMax: newMax };
    }

    /**
     * Greedy lane packing: each item goes to the lowest lane whose last item ended before it starts.
     * Items must expose startSec/endSec; the input is not mutated.
     * @returns {{placed: Array<{item: Object, lane: number}>, laneCount: number}}
     */
    static packLanes(items) {
        const sorted = [...items].sort((a, b) => a.startSec - b.startSec);
        const laneEnds = [];
        const placed = sorted.map(item => {
            let lane = laneEnds.findIndex(end => item.startSec > end);
            if (lane < 0) {
                lane = laneEnds.length;
                laneEnds.push(item.endSec);
            } else {
                laneEnds[lane] = item.endSec;
            }
            return { item, lane };
        });
        return { placed, laneCount: Math.max(laneEnds.length, 1) };
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

// CommonJS export for unit tests (no-op in the browser script-tag context).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Utils };
}
