/**
 * OE Manager GUI - Log File Service
 * Client-side log file parsing for agent logs and access logs.
 * Ported from oemanagergui VS Code extension (logFileService.ts).
 *
 * Since this is a static webapp, files are uploaded via <input type="file">
 * and parsed entirely in the browser (no Node.js filesystem access).
 */

// Agent log line: timestamp PID sessionId agentNum agentSessionId appRequestId logType message
// Example: 2026-04-16T12:53:29.667+0200 012360 054540 1 AS-7 ?:?:? APPL  ### message
const AGENT_LOG_REGEX = /^(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4})\s+(?<processId>\d+)\s+(?<sessionId>\d+)\s+(?<agentNumber>\d+)\s+(?<agentSessionId>\S+)\s+(?<appRequestId>\S+)\s+(?<logEntryType>\S+)\s+(?<message>.*)$/;

// Access log line:
// 192.168.18.38 - hulk1@de.ivnet.ch [2026-04-16T17:21:59.753+02:00] "GET /web/... HTTP/1.1" 200 - ROOT:w:0000e9c2 85
const ACCESS_LOG_REGEX = /^(?<clientIp>\S+)\s+\S+\s+(?<user>\S+)\s+\[(?<timestamp>[^\]]+)\]\s+"(?<method>\S+)\s+(?<url>\S+)\s+(?<protocol>[^"]+)"\s+(?<statusCode>\d+)\s+(?<responseSize>\S+)\s+(?<appRequestId>\S+)\s+(?<responseTime>\d+)\s*$/;

class LogFileService {

    /**
     * Parse agent log file content into structured entries.
     * Handles continuation lines (lines that don't match the regex are appended
     * to the previous entry's message).
     * @param {string} content - Raw agent log file text
     * @returns {Array<Object>} Array of AgentLogEntry objects
     */
    parseAgentLog(content) {
        const entries = [];
        const lines = content.split(/\r?\n/);
        let currentEntry = null;
        let lineNumber = 0;

        for (const line of lines) {
            lineNumber++;
            const match = line.match(AGENT_LOG_REGEX);

            if (match?.groups) {
                // Flush previous entry
                if (currentEntry) {
                    entries.push(currentEntry);
                }

                currentEntry = {
                    source: 'agent',
                    timestamp: match.groups.timestamp,
                    processId: match.groups.processId,
                    sessionId: match.groups.sessionId,
                    agentNumber: match.groups.agentNumber,
                    agentSessionId: match.groups.agentSessionId,
                    appRequestId: match.groups.appRequestId,
                    logEntryType: match.groups.logEntryType,
                    message: match.groups.message,
                    lineNumber,
                };
            } else if (currentEntry && line.trim()) {
                // Continuation line: append to current entry's message
                currentEntry = {
                    ...currentEntry,
                    message: currentEntry.message + '\n' + line,
                };
            }
        }

        // Flush last entry
        if (currentEntry) {
            entries.push(currentEntry);
        }

        return entries;
    }

    /**
     * Parse access log file content into structured entries.
     * @param {string} content - Raw access log file text
     * @returns {Array<Object>} Array of AccessLogEntry objects
     */
    parseAccessLog(content) {
        const entries = [];
        const lines = content.split(/\r?\n/);
        let lineNumber = 0;

        for (const line of lines) {
            lineNumber++;
            const match = line.match(ACCESS_LOG_REGEX);

            if (match?.groups) {
                entries.push({
                    source: 'access',
                    timestamp: match.groups.timestamp,
                    clientIp: match.groups.clientIp,
                    user: match.groups.user,
                    method: match.groups.method,
                    url: match.groups.url,
                    protocol: match.groups.protocol,
                    statusCode: parseInt(match.groups.statusCode, 10),
                    responseSize: match.groups.responseSize,
                    appRequestId: match.groups.appRequestId,
                    responseTime: parseInt(match.groups.responseTime, 10),
                    lineNumber,
                });
            }
        }

        return entries;
    }

    /**
     * Merge agent and access log entries, sorted by timestamp.
     * @param {Array<Object>} agentEntries
     * @param {Array<Object>} accessEntries
     * @returns {Array<Object>} Merged and sorted entries
     */
    mergeEntries(agentEntries, accessEntries) {
        const merged = [...agentEntries, ...accessEntries];
        merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return merged;
    }

    /**
     * Extract the short request ID (last segment after ':').
     * Agent log: "AppName:w:0000e9c2" → "0000e9c2"
     * Access log: "ROOT:w:0000e9c2" → "0000e9c2"
     * @param {string} fullRequestId
     * @returns {string}
     */
    extractShortRequestId(fullRequestId) {
        const parts = fullRequestId.split(':');
        return parts.length >= 3 ? parts[parts.length - 1] : fullRequestId;
    }

    /**
     * Build correlation index keyed by the short request ID.
     * This allows matching agent log entries with access log entries that may
     * have different application prefixes.
     * @param {Array<Object>} entries
     * @returns {Map<string, Array<Object>>}
     */
    buildShortIdCorrelationIndex(entries) {
        const index = new Map();

        for (const entry of entries) {
            const requestId = entry.appRequestId;
            if (!requestId || requestId === '?:?:?' || requestId === '-') {
                continue;
            }

            const shortId = this.extractShortRequestId(requestId);
            const existing = index.get(shortId);
            if (existing) {
                existing.push(entry);
            } else {
                index.set(shortId, [entry]);
            }
        }

        return index;
    }

    /**
     * Filter merged entries based on filter criteria.
     * @param {Array<Object>} entries
     * @param {Object} filters - LogFilters object
     * @returns {Array<Object>} Filtered entries
     */
    filterEntries(entries, filters) {
        if (!filters || Object.keys(filters).length === 0) {
            return [...entries];
        }

        return entries.filter(entry => {
            // Source filter
            if (filters.source && filters.source !== 'all' && entry.source !== filters.source) {
                return false;
            }

            // Agent number filter (agent entries only)
            if (filters.agentNumber && entry.source === 'agent' && entry.agentNumber !== filters.agentNumber) {
                return false;
            }

            // Process ID filter (agent entries only)
            if (filters.processId && entry.source === 'agent' && entry.processId !== filters.processId) {
                return false;
            }

            // Log entry type filter (agent entries only)
            if (filters.logEntryType && entry.source === 'agent' && entry.logEntryType !== filters.logEntryType) {
                return false;
            }

            // Status code filter (access entries only)
            if (filters.statusCode !== undefined && entry.source === 'access' && entry.statusCode !== filters.statusCode) {
                return false;
            }

            // Client IP filter (access entries only)
            if (filters.clientIp && entry.source === 'access' && entry.clientIp !== filters.clientIp) {
                return false;
            }

            // Minimum response time filter (access entries only)
            if (filters.minResponseTime !== undefined && entry.source === 'access' && entry.responseTime < filters.minResponseTime) {
                return false;
            }

            // Request ID filter
            if (filters.requestId) {
                const shortFilter = filters.requestId.toLowerCase();
                const entryShortId = this.extractShortRequestId(entry.appRequestId).toLowerCase();
                if (!entryShortId.includes(shortFilter) && !entry.appRequestId.toLowerCase().includes(shortFilter)) {
                    return false;
                }
            }

            // Free text search
            if (filters.searchText) {
                const searchLower = filters.searchText.toLowerCase();
                const searchableText = this.getSearchableText(entry).toLowerCase();
                if (!searchableText.includes(searchLower)) {
                    return false;
                }
            }

            return true;
        });
    }

    /**
     * Convert a timestamp string to seconds since midnight.
     * Supports ISO format (2026-04-17T07:49:17.300+0200) and
     * CLF format (16/Apr/2026:17:21:59 +0200).
     * @param {string} ts - Timestamp string
     * @returns {number|null} Seconds since midnight, or null
     */
    timestampToSeconds(ts) {
        // ISO format
        const isoMatch = ts.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
        if (isoMatch) {
            const ms = isoMatch[4] ? parseInt(isoMatch[4].padEnd(3, '0').substring(0, 3), 10) / 1000 : 0;
            return parseInt(isoMatch[1], 10) * 3600 + parseInt(isoMatch[2], 10) * 60 + parseInt(isoMatch[3], 10) + ms;
        }
        // CLF format
        const clfMatch = ts.match(/\d{2}\/\w{3}\/\d{4}:(\d{2}):(\d{2}):(\d{2})/);
        if (clfMatch) {
            return parseInt(clfMatch[1], 10) * 3600 + parseInt(clfMatch[2], 10) * 60 + parseInt(clfMatch[3], 10);
        }
        // Fallback: find HH:MM:SS
        const match = ts.match(/(?:^|[^\d])(\d{2}):(\d{2}):(\d{2})/);
        if (!match) {
            return null;
        }
        return parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
    }

    /**
     * Get searchable text representation of an entry for free text filtering.
     * @param {Object} entry
     * @returns {string}
     */
    getSearchableText(entry) {
        if (entry.source === 'agent') {
            return `${entry.timestamp} ${entry.processId} ${entry.sessionId} ${entry.agentNumber} ${entry.agentSessionId} ${entry.appRequestId} ${entry.logEntryType} ${entry.message}`;
        }
        return `${entry.timestamp} ${entry.clientIp} ${entry.user} ${entry.method} ${entry.url} ${entry.statusCode} ${entry.appRequestId} ${entry.responseTime}`;
    }

    // ==================== Properties Parsing (ported from logFileService.ts) ====================

    /**
     * Parse INI-style content into a map of section name → key/value pairs.
     * Handles comment lines (#, !) and continuation lines (\).
     * @param {string} content - Raw INI/properties file text
     * @returns {Map<string, Object>} Section name → { key: value } pairs
     */
    parseIniSections(content) {
        const sections = new Map();
        let currentSection = '';
        let currentProps = {};
        sections.set(currentSection, currentProps);

        const lines = content.split(/\r?\n/);
        let continuationKey = '';
        let continuationValue = '';

        for (const rawLine of lines) {
            const line = rawLine.trim();

            // Handle continuation from previous line
            if (continuationKey) {
                if (line.endsWith('\\')) {
                    continuationValue += line.slice(0, -1).trim() + ' ';
                    continue;
                }
                continuationValue += line;
                currentProps[continuationKey] = continuationValue.trim();
                continuationKey = '';
                continuationValue = '';
                continue;
            }

            // Skip empty lines and comments
            if (!line || line.startsWith('#') || line.startsWith('!')) {
                continue;
            }

            // Section header: [SectionName]
            const sectionMatch = line.match(/^\[([^\]]+)\]$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1];
                if (!sections.has(currentSection)) {
                    currentProps = {};
                    sections.set(currentSection, currentProps);
                } else {
                    currentProps = sections.get(currentSection);
                }
                continue;
            }

            // Key=value pair
            const eqIndex = line.indexOf('=');
            if (eqIndex > 0) {
                const key = line.substring(0, eqIndex).trim();
                let value = line.substring(eqIndex + 1).trim();

                if (value.endsWith('\\')) {
                    continuationKey = key;
                    continuationValue = value.slice(0, -1).trim() + ' ';
                    continue;
                }

                currentProps[key] = value;
            }
        }

        return sections;
    }

    /**
     * Parse properties content and extract agentLogFile paths per application.
     * [AppServer.SessMgr.<app>] overrides [AppServer.SessMgr] for a given app.
     * @param {string} content - Raw openedge.properties text
     * @param {string} pasoePath - PASOE base path (for resolving relative paths)
     * @returns {Map<string, string>} applicationName → resolved agent log path template
     */
    parsePropertiesContent(content, pasoePath) {
        const sections = this.parseIniSections(content);
        const result = new Map();

        // Get default agentLogFile from [AppServer.SessMgr]
        const defaultSection = sections.get('AppServer.SessMgr');
        const defaultLogFile = defaultSection?.['agentLogFile'] ?? '';

        // Discover per-application sections: [AppServer.SessMgr.<appName>]
        const appPrefix = 'AppServer.SessMgr.';
        for (const [sectionName, props] of sections) {
            if (sectionName.startsWith(appPrefix) && sectionName !== 'AppServer.SessMgr') {
                const appName = sectionName.substring(appPrefix.length);
                const logFile = props['agentLogFile'] ?? defaultLogFile;
                if (logFile) {
                    result.set(appName, this.resolveLogPath(logFile, pasoePath));
                }
            }
        }

        return result;
    }

    /**
     * Resolve a log file path template.
     * Replaces ${catalina.base} with pasoePath.
     * Normalizes forward slashes for URL-based file reading.
     * Preserves date tokens like {yyyy-MM-dd} for later resolution.
     * @param {string} logFilePath
     * @param {string} pasoePath
     * @returns {string} Resolved path (still may contain date tokens)
     */
    resolveLogPath(logFilePath, pasoePath) {
        let resolved = logFilePath.replace(/\$\{catalina\.base\}/g, pasoePath);
        // Normalize backslashes to forward slashes
        resolved = resolved.replace(/\\/g, '/');
        // If relative, prepend pasoePath
        if (!resolved.startsWith('/') && !/^[A-Za-z]:/.test(resolved)) {
            const base = pasoePath.replace(/\\/g, '/').replace(/\/$/, '');
            resolved = base + '/' + resolved;
        }
        return resolved;
    }

    /**
     * Resolve date tokens in a log file path template.
     * Supports {yyyy-MM-dd}, {yyyy}, {MM}, {dd} patterns.
     * @param {string} templatePath
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {string} Path with date tokens replaced
     */
    resolveAgentLogPath(templatePath, date) {
        const [year, month, day] = date.split('-');
        return templatePath
            .replace(/\{yyyy-MM-dd\}/g, date)
            .replace(/\{yyyy\}/g, year)
            .replace(/\{MM\}/g, month)
            .replace(/\{dd\}/g, day);
    }

    /**
     * Check whether a log path template contains date tokens.
     * @param {string} templatePath
     * @returns {boolean}
     */
    hasDateToken(templatePath) {
        return /\{yyyy|\{MM|\{dd/.test(templatePath);
    }

    /**
     * Get the directory portion of a log file path.
     * @param {string} logPath
     * @returns {string} Directory path
     */
    getLogDirectory(logPath) {
        const normalized = logPath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash >= 0 ? normalized.substring(0, lastSlash) : '.';
    }

    /**
     * Convert an absolute path to a path relative to pasoePath.
     * @param {string} absolutePath
     * @param {string} pasoePath
     * @returns {string} Relative path for use with readServerFile()
     */
    toRelativePath(absolutePath, pasoePath) {
        const normAbs = absolutePath.replace(/\\/g, '/');
        const normBase = pasoePath.replace(/\\/g, '/').replace(/\/$/, '');
        if (normAbs.startsWith(normBase + '/')) {
            return normAbs.substring(normBase.length + 1);
        }
        if (normAbs.startsWith(normBase)) {
            return normAbs.substring(normBase.length);
        }
        return normAbs;
    }
}
