/**
 * OE Manager GUI - Lifecycles View Mixin
 * Ported from oemanagergui VS Code extension (lifecyclesPanel.ts, lifecyclesWebview.ts, flameChartWebview.ts).
 *
 * Shows agent (PID) and ABL session lifecycles derived from the agent log, in a Tree or
 * Packed-lanes mode, with optional request and session flame charts sharing one zoom window.
 *
 * The full day's logs are streamed from the server in bounded chunks. Only compact aggregates
 * are retained (per-PID/session ranges, plus compact access entries while the request flame
 * chart is shown), so memory stays bounded regardless of log size.
 */
const LC_CHUNK_BYTES = 2 * 1024 * 1024;
const LC_DAY_SECONDS = 86400;
// Matches the 200px label column of the lifecycle chart so all charts share one time scale
const LC_GUTTER_PX = 200;
const LC_PACKED_LANE_HEIGHT = 14;
const LC_DEFAULT_MIN_SESSIONS = 4;
const LC_COLORS = [
    '#3794ff', '#89d185', '#b180d7', '#d18616', '#cca700',
    '#2aa198', '#6c71c4', '#cb4b16', '#268bd2'
];

const LifecyclesViewMixin = {

    // ==================== STATE ====================

    initLifecyclesState() {
        if (this._lcInitialized) { return; }
        this._lcInitialized = true;
        this.lcLogService = new LogFileService();
        this.lc = this.createLifecyclesState();
    },

    createLifecyclesState() {
        return {
            date: '',
            allAgents: [],
            agents: [],
            minSessions: LC_DEFAULT_MIN_SESSIONS,
            mode: 'tree',
            expanded: new Set(),
            view: { xMin: 0, xMax: LC_DAY_SECONDS },
            fit: { xMin: 0, xMax: LC_DAY_SECONDS },
            zoomed: false,
            flameRange: null,
            flameVisible: false,
            sessionFlameVisible: false,
            accumulator: null,
            sources: null,
            agentOffset: 0,
            accessOffset: 0,
            accessEntries: [],
            accessMissing: false,
            loadToken: 0,
            loading: false,
            pendingFlameLoad: false,
            loadedKey: '',
            refreshTimer: null,
            drag: null,
            flameChart: null,
            sessionFlameChart: null
        };
    },

    // ==================== PURE HELPERS ====================

    /** Agents that pass the min-sessions threshold. */
    filterLifecycleAgents(agents, minSessions) {
        return agents.filter(agent => agent.sessions.length >= minSessions);
    },

    /**
     * Time window that fits the agents (and the request range when the flame chart is shown).
     * @returns {{xMin: number, xMax: number}}
     */
    computeLifecycleFit(agents, flameRange) {
        let min = Infinity;
        let max = -Infinity;
        for (const agent of agents) {
            min = Math.min(min, agent.startSec);
            max = Math.max(max, agent.endSec);
        }
        if (flameRange) {
            min = Math.min(min, flameRange.min);
            max = Math.max(max, flameRange.max);
        }
        if (!isFinite(min)) {
            return { xMin: 0, xMax: LC_DAY_SECONDS };
        }
        const range = Math.max(max - min, 60);
        const padding = range * 0.03;
        return { xMin: Math.max(0, min - padding), xMax: Math.min(LC_DAY_SECONDS, max + padding) };
    },

    /**
     * Convert access log entries to flame chart items.
     * responseTime is in microseconds (Tomcat %D), so the start is derived from the end timestamp.
     */
    toFlameEntries(accessEntries) {
        const result = [];
        for (const entry of accessEntries) {
            const endSec = this.lcLogService.timestampToSeconds(entry.timestamp);
            if (endSec === null) { continue; }
            result.push({
                startSec: Math.max(0, endSec - entry.responseTime / 1_000_000),
                endSec,
                method: entry.method,
                url: entry.url,
                statusCode: entry.statusCode,
                responseTime: entry.responseTime,
                clientIp: entry.clientIp,
                requestId: entry.appRequestId
            });
        }
        return result.sort((a, b) => a.startSec - b.startSec);
    },

    /** One bar per session; colorIdx keeps an agent's color identical to the lifecycle chart. */
    buildSessionFlameEntries(agents) {
        const entries = [];
        agents.forEach((agent, colorIdx) => {
            for (const session of agent.sessions) {
                entries.push({
                    pid: agent.pid,
                    sessionId: session.sessionId,
                    startSec: session.startSec,
                    endSec: session.endSec,
                    requests: session.requestCount,
                    errors: session.errorCount,
                    colorIdx
                });
            }
        });
        return entries;
    },

    lifecycleStatusColor(code) {
        if (code >= 200 && code < 300) { return 'rgba(137, 209, 133, 0.85)'; }
        if (code >= 300 && code < 400) { return 'rgba(55, 148, 255, 0.85)'; }
        if (code >= 400 && code < 500) { return 'rgba(204, 167, 0, 0.85)'; }
        if (code >= 500) { return 'rgba(241, 76, 76, 0.85)'; }
        return 'rgba(177, 128, 215, 0.85)';
    },

    // ==================== VIEW LIFECYCLE ====================

    /** Called when the Lifecycles view becomes active. */
    loadLifecyclesView() {
        this.initLifecyclesState();
        this.setupLifecyclesEventHandlers();

        if (!this.isConnected || !this.selectedApplication) {
            this.setLifecyclesEmpty('Login and select an application to view lifecycles');
            return;
        }

        const date = document.getElementById('lcDate')?.value;
        if (this.lc.loadedKey === `${this.selectedApplication}|${date}`) {
            this.refreshLifecycles();
            this.startLifecyclesRefresh();
        } else {
            this.loadLifecycles();
        }
    },

    /** Cancel in-flight loads and the refresh timer (called from stopAllTimers). */
    stopLifecyclesActivity() {
        if (!this._lcInitialized) { return; }
        const lc = this.lc;
        this.stopLifecyclesRefresh();
        lc.loadToken++;
        lc.loading = false;
        lc.pendingFlameLoad = false;
        this.setLifecyclesBusy(false);
        this.setFlameBusy(false);
    },

    /** Forget loaded data, e.g. after an application change or logout. */
    resetLifecyclesState() {
        if (!this._lcInitialized) { return; }
        this.stopLifecyclesActivity();
        const lc = this.lc;
        this.resetLifecyclesData();
        lc.loadedKey = '';
        lc.zoomed = false;
        this.setLifecyclesEmpty('No agent log data loaded');
    },

    resetLifecyclesData() {
        const lc = this.lc;
        lc.allAgents = [];
        lc.agents = [];
        lc.accumulator = this.lcLogService.createLifecycleAccumulator();
        lc.sources = null;
        lc.agentOffset = 0;
        lc.accessOffset = 0;
        lc.accessEntries = [];
        lc.accessMissing = false;
        lc.flameRange = null;
        lc.expanded.clear();
    },

    startLifecyclesRefresh() {
        this.stopLifecyclesRefresh();
        const seconds = this.refreshIntervals?.logs ?? 5;
        if (seconds > 0) {
            this.lc.refreshTimer = setInterval(() => this.refreshLifecycles(), seconds * 1000);
        }
    },

    stopLifecyclesRefresh() {
        if (this.lc?.refreshTimer) {
            clearInterval(this.lc.refreshTimer);
            this.lc.refreshTimer = null;
        }
    },

    // ==================== LOADING ====================

    /** Full load of the selected application and date. */
    async loadLifecycles() {
        const lc = this.lc;
        const date = document.getElementById('lcDate')?.value;
        if (!date) {
            Utils.showToast('Please select a date', 'error');
            return;
        }

        this.stopLifecyclesActivity();
        const token = lc.loadToken;
        lc.loading = true;
        lc.date = date;
        this.resetLifecyclesData();
        this.showLifecyclesError('');
        this.setLifecyclesBusy(true);
        this.setFlameBusy(lc.flameVisible);
        this.setLifecyclesEmpty('Loading…');
        this.setLifecyclesStatus('Reading properties…');

        try {
            lc.sources = await this.resolveLogSources(date);
            if (token !== lc.loadToken) { return; }
            lc.loadedKey = `${this.selectedApplication}|${date}`;

            try {
                await this.streamLifecycleSource('agent', token);
            } catch (error) {
                throw error.message.includes('404')
                    ? new Error(`Agent log not found: ${lc.sources.agentLogFileName}`)
                    : error;
            }
            if (token !== lc.loadToken) { return; }
            this.applyLifecycleAgents();

            if (lc.flameVisible) {
                await this.loadAccessForFlame(token);
                if (token !== lc.loadToken) { return; }
            }
            this.setLifecyclesStatus(`Loaded ${lc.sources.agentLogFileName}`);
            this.startLifecyclesRefresh();
        } catch (error) {
            if (token !== lc.loadToken) { return; }
            console.error('[Lifecycles] Load failed:', error);
            lc.loadedKey = '';
            this.setLifecyclesEmpty('No agent log data loaded');
            this.setLifecyclesStatus('');
            this.showLifecyclesError(`Failed to load lifecycles: ${error.message}`);
        } finally {
            if (token === lc.loadToken) {
                lc.loading = false;
                this.setLifecyclesBusy(false);
                this.setFlameBusy(false);
                if (lc.pendingFlameLoad && lc.flameVisible) {
                    lc.pendingFlameLoad = false;
                    this.loadLifecycleRequests();
                }
            }
        }
    },

    /** Incremental refresh: reads only bytes appended since the last read. */
    async refreshLifecycles() {
        const lc = this.lc;
        if (!lc || lc.loading || !lc.sources || this.currentView !== 'lifecycles') { return; }

        const token = lc.loadToken;
        lc.loading = true;
        try {
            const agentResult = await this.streamLifecycleSource('agent', token);
            const accessResult = lc.flameVisible
                ? await this.streamLifecycleSource('access', token)
                : { changed: false, truncated: false };
            if (token !== lc.loadToken) { return; }

            if (agentResult.truncated || accessResult.truncated) {
                lc.loading = false;
                this.loadLifecycles();
                return;
            }
            if (agentResult.changed) { this.applyLifecycleAgents(); }
            if (accessResult.changed) { this.renderRequestFlame(); }
        } catch (error) {
            console.warn('[Lifecycles] Refresh failed:', error);
        } finally {
            if (token === lc.loadToken) { lc.loading = false; }
        }
    },

    /**
     * Stream one log forward from its stored offset in bounded chunks.
     * @param {'agent'|'access'} kind
     * @param {number} token - Load token; a mismatch aborts quietly
     * @returns {Promise<{changed: boolean, truncated: boolean}>}
     */
    async streamLifecycleSource(kind, token) {
        const lc = this.lc;
        const { sources } = lc;
        const relativePath = kind === 'agent' ? sources.agentLogRelPath : sources.accessLogRelPath;
        const offsetKey = kind === 'agent' ? 'agentOffset' : 'accessOffset';
        let changed = false;

        for (;;) {
            if (token !== lc.loadToken) { return { changed, truncated: false }; }
            const result = await this.agentService.readServerFile(relativePath, {
                direction: 'forward',
                offset: lc[offsetKey],
                maxBytes: LC_CHUNK_BYTES,
                pasoePathOverride: sources.pasoePath
            });
            if (token !== lc.loadToken) { return { changed, truncated: false }; }

            if (result.fileTruncated) {
                return { changed, truncated: true };
            }
            if (result.content) {
                if (kind === 'agent') {
                    this.ingestAgentLogChunk(result.content);
                } else {
                    this.ingestAccessLogChunk(result.content);
                }
                changed = true;
            }
            this.setLifecyclesStatus(
                `Loading ${kind} log… ${(result.newOffset / 1048576).toFixed(1)} / ${(result.totalSize / 1048576).toFixed(1)} MiB`
            );

            // No complete line in the chunk means no progress; stop instead of looping forever
            if (result.newOffset <= lc[offsetKey]) { break; }
            lc[offsetKey] = result.newOffset;
            if (!result.hasNewer) { break; }
        }
        return { changed, truncated: false };
    },

    ingestAgentLogChunk(content) {
        const lc = this.lc;
        const entries = this.lcLogService.parseAgentLog(content);
        // A log without a date token spans days, so keep only the selected day
        const day = lc.sources.hasDateToken ? entries : entries.filter(e => e.timestamp.startsWith(lc.date));
        this.lcLogService.addLifecycleEntries(lc.accumulator, day);
    },

    ingestAccessLogChunk(content) {
        const entries = this.lcLogService.parseAccessLog(content);
        for (const entry of entries) {
            this.lc.accessEntries.push(entry);
        }
    },

    /** Read the access log and draw; a missing file shows an empty chart instead of an error. */
    async loadAccessForFlame(token) {
        const lc = this.lc;
        try {
            await this.streamLifecycleSource('access', token);
        } catch (error) {
            if (!error.message.includes('404')) { throw error; }
            lc.accessMissing = true;
        }
        if (token === lc.loadToken) { this.renderRequestFlame(); }
    },

    /** Load requests on demand when the Flame Chart is switched on. */
    async loadLifecycleRequests() {
        const lc = this.lc;
        if (!lc.sources) { return; }
        if (lc.loading) {
            lc.pendingFlameLoad = true;
            return;
        }
        const token = lc.loadToken;
        lc.loading = true;
        lc.accessEntries = [];
        lc.accessOffset = 0;
        lc.accessMissing = false;
        this.setFlameBusy(true);
        try {
            await this.loadAccessForFlame(token);
        } catch (error) {
            if (token === lc.loadToken) {
                this.showLifecyclesError(`Failed to load requests: ${error.message}`);
            }
        } finally {
            if (token === lc.loadToken) {
                lc.loading = false;
                this.setFlameBusy(false);
            }
        }
    },

    // ==================== APPLY DATA ====================

    applyLifecycleAgents() {
        this.lc.allAgents = this.lcLogService.snapshotLifecycles(this.lc.accumulator);
        this.refreshAgentFilter();
    },

    /** lc.agents holds only the agents that pass the min-sessions threshold. */
    refreshAgentFilter() {
        const lc = this.lc;
        lc.agents = this.filterLifecycleAgents(lc.allAgents, lc.minSessions);
        const pids = new Set(lc.allAgents.map(a => a.pid));
        for (const pid of Array.from(lc.expanded)) {
            if (!pids.has(pid)) { lc.expanded.delete(pid); }
        }
        this.setLifecyclesEmpty(
            lc.allAgents.length && !lc.agents.length
                ? `No agents with at least ${lc.minSessions} sessions`
                : 'No agent log data loaded'
        );

        this.recomputeLifecycleFit();
        const sessionCount = lc.agents.reduce((n, a) => n + a.sessions.length, 0);
        const hidden = lc.allAgents.length - lc.agents.length;
        this.setText('lcSummary', `${lc.agents.length} agents · ${sessionCount} sessions` +
            (hidden > 0 ? ` · ${hidden} hidden` : ''));

        this.renderLifecycles();
        lc.flameChart?.draw();
        this.rebuildSessionFlame();
        this.syncLifecycleResetButton();
    },

    recomputeLifecycleFit() {
        const lc = this.lc;
        lc.fit = this.computeLifecycleFit(lc.agents, lc.flameRange);
        if (!lc.zoomed) { lc.view = { ...lc.fit }; }
    },

    setLifecycleView(view) {
        const lc = this.lc;
        lc.view = view;
        lc.zoomed = Math.abs(view.xMin - lc.fit.xMin) > 0.5 || Math.abs(view.xMax - lc.fit.xMax) > 0.5;
        this.renderLifecycles();
        lc.flameChart?.draw();
        lc.sessionFlameChart?.draw();
        this.syncLifecycleResetButton();
    },

    resetLifecycleView() {
        this.setLifecycleView({ ...this.lc.fit });
    },

    syncLifecycleResetButton() {
        document.getElementById('lcBtnResetZoom')?.classList.toggle('hidden', !this.lc.zoomed);
    },

    // ==================== REQUEST FLAME CHART ====================

    renderRequestFlame() {
        const lc = this.lc;
        const entries = lc.flameVisible ? this.toFlameEntries(lc.accessEntries) : [];

        lc.flameRange = null;
        if (entries.length > 0) {
            lc.flameRange = {
                min: entries[0].startSec,
                max: entries.reduce((max, e) => Math.max(max, e.endSec), 0)
            };
        }

        const threshold = this.config?.flameChartWarnThreshold ?? 20000;
        const tooMany = threshold > 0 && entries.length > threshold;
        const warning = document.getElementById('lcFlameWarning');
        if (warning) {
            warning.classList.toggle('hidden', !tooMany);
            warning.textContent = tooMany ? '⚠ Large day: drawing may be slow. Zoom in or pick a quieter day.' : '';
        }
        this.setText('lcFlameInfo', entries.length ? `${entries.length} requests` : '');

        const empty = document.getElementById('lcFlameEmpty');
        if (empty) {
            empty.textContent = lc.accessMissing ? 'Access log not found for this day' : 'No access log entries loaded';
            empty.classList.toggle('hidden', entries.length > 0);
        }
        document.getElementById('lcFlameContainer')?.classList.toggle('hidden', entries.length === 0);

        lc.flameChart?.setEntries(entries);
        this.recomputeLifecycleFit();
        this.renderLifecycles();
        lc.sessionFlameChart?.draw();
        this.syncLifecycleResetButton();
    },

    applyFlameVisibility() {
        const lc = this.lc;
        document.getElementById('lcResizer')?.classList.toggle('hidden', !lc.flameVisible);
        document.getElementById('lcFlamePanel')?.classList.toggle('hidden', !lc.flameVisible);
        const button = document.getElementById('lcBtnFlameToggle');
        if (button) {
            button.textContent = lc.flameVisible ? 'Hide Flame Chart' : 'Show Flame Chart';
            button.title = lc.flameVisible ? 'Hide the request flame chart' : 'Show the request flame chart below';
            button.setAttribute('aria-pressed', String(lc.flameVisible));
        }
    },

    async toggleFlameChart() {
        const lc = this.lc;
        lc.flameVisible = !lc.flameVisible;
        this.applyFlameVisibility();
        if (lc.flameVisible) {
            await this.loadLifecycleRequests();
            return;
        }
        // Drop request data so the shared zoom fit covers the agents only
        lc.accessEntries = [];
        lc.accessOffset = 0;
        this.renderRequestFlame();
    },

    // ==================== SESSION FLAME CHART ====================

    applySessionFlameVisibility() {
        const lc = this.lc;
        document.getElementById('lcSfPanel')?.classList.toggle('hidden', !lc.sessionFlameVisible);
        const button = document.getElementById('lcBtnSessionFlameToggle');
        if (button) {
            button.textContent = lc.sessionFlameVisible ? 'Hide Session Flame' : 'Show Session Flame';
            button.title = lc.sessionFlameVisible ? 'Hide the session flame chart' : 'Show the flame chart of running sessions below';
            button.setAttribute('aria-pressed', String(lc.sessionFlameVisible));
        }
    },

    toggleSessionFlame() {
        const lc = this.lc;
        lc.sessionFlameVisible = !lc.sessionFlameVisible;
        this.applySessionFlameVisibility();
        if (lc.sessionFlameVisible) {
            this.rebuildSessionFlame();
        } else {
            lc.sessionFlameChart?.clear();
        }
    },

    /** Built from the visible (min-sessions filtered) agents. */
    rebuildSessionFlame() {
        const lc = this.lc;
        if (!lc.sessionFlameVisible || !lc.sessionFlameChart) { return; }
        const entries = this.buildSessionFlameEntries(lc.agents);
        this.setText('lcSfInfo', `${entries.length} sessions`);
        document.getElementById('lcSfEmpty')?.classList.toggle('hidden', entries.length > 0);
        document.getElementById('lcSfContainer')?.classList.toggle('hidden', entries.length === 0);
        lc.sessionFlameChart.setEntries(entries);
    },

    // ==================== LIFECYCLE CHART RENDERING ====================

    lcToPct(sec) {
        const { xMin, xMax } = this.lc.view;
        return (sec - xMin) / (xMax - xMin) * 100;
    },

    lcIsVisible(startSec, endSec) {
        const { xMin, xMax } = this.lc.view;
        return endSec >= xMin && startSec <= xMax;
    },

    lcBarStyle(startSec, endSec, color) {
        const left = this.lcToPct(startSec);
        const width = Math.max(this.lcToPct(endSec) - left, 0.15);
        return `left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${color};`;
    },

    lcBarAttrs(kind, pid, sessionId) {
        const esc = Utils.escapeHtml;
        return ` data-kind="${kind}" data-pid="${esc(pid)}"` + (sessionId ? ` data-session="${esc(sessionId)}"` : '');
    },

    lcAgentLabel(agent, withCaret) {
        const esc = Utils.escapeHtml;
        let caret = '';
        if (withCaret) {
            caret = agent.sessions.length > 0
                ? `<span class="lc-caret" data-toggle-pid="${esc(agent.pid)}">${this.lc.expanded.has(agent.pid) ? '▾' : '▸'}</span>`
                : '<span class="lc-caret"></span>';
        }
        const agt = agent.agentNumbers.length ? ` (Agt#${agent.agentNumbers.join(',')})` : '';
        const title = `PID ${agent.pid}${agt} - ${agent.sessions.length} sessions`;
        return `<div class="lc-label" title="${esc(title)}">${caret}PID ${esc(agent.pid)}${esc(agt)}` +
            ` <span class="lc-label-meta">· ${agent.sessions.length} sess.</span></div>`;
    },

    renderTreeRows(grid) {
        const lc = this.lc;
        const esc = Utils.escapeHtml;
        let html = '';
        lc.agents.forEach((agent, idx) => {
            const color = LC_COLORS[idx % LC_COLORS.length];
            let track = grid;
            if (this.lcIsVisible(agent.startSec, agent.endSec)) {
                track += `<div class="lc-bar agent-bar" style="${this.lcBarStyle(agent.startSec, agent.endSec, color)}"` +
                    `${this.lcBarAttrs('agent', agent.pid)}></div>`;
            }
            for (const s of agent.sessions) {
                if (s.startSec >= lc.view.xMin && s.startSec <= lc.view.xMax) {
                    track += `<div class="lc-session-tick" style="left:${this.lcToPct(s.startSec).toFixed(3)}%"></div>`;
                }
            }
            html += `<div class="lc-row agent">${this.lcAgentLabel(agent, true)}<div class="lc-track">${track}</div></div>`;

            if (!lc.expanded.has(agent.pid)) { return; }
            // Oldest session first; ties keep the service's session-id order (sort is stable)
            const sessions = [...agent.sessions].sort((a, b) => a.startSec - b.startSec);
            for (const s of sessions) {
                let sTrack = grid;
                if (this.lcIsVisible(s.startSec, s.endSec)) {
                    sTrack += `<div class="lc-bar session-bar${s.errorCount > 0 ? ' has-error' : ''}" ` +
                        `style="${this.lcBarStyle(s.startSec, s.endSec, color)}"` +
                        `${this.lcBarAttrs('session', agent.pid, s.sessionId)}></div>`;
                }
                html += `<div class="lc-row session"><div class="lc-label">${esc(s.sessionId)}</div>` +
                    `<div class="lc-track">${sTrack}</div></div>`;
            }
        });
        return html;
    },

    renderPackedRows(grid) {
        let html = '';
        this.lc.agents.forEach((agent, idx) => {
            const color = LC_COLORS[idx % LC_COLORS.length];
            const packed = Utils.packLanes(agent.sessions);
            const height = packed.laneCount * LC_PACKED_LANE_HEIGHT + 8;
            let track = grid;
            if (this.lcIsVisible(agent.startSec, agent.endSec)) {
                track += `<div class="lc-bar agent-band" style="${this.lcBarStyle(agent.startSec, agent.endSec, color)}"` +
                    `${this.lcBarAttrs('agent', agent.pid)}></div>`;
            }
            for (const { item, lane } of packed.placed) {
                if (!this.lcIsVisible(item.startSec, item.endSec)) { continue; }
                track += `<div class="lc-bar session-bar${item.errorCount > 0 ? ' has-error' : ''}" ` +
                    `style="${this.lcBarStyle(item.startSec, item.endSec, color)}top:${4 + lane * LC_PACKED_LANE_HEIGHT}px;"` +
                    `${this.lcBarAttrs('session', agent.pid, item.sessionId)}></div>`;
            }
            html += `<div class="lc-row packed" style="height:${height}px;">${this.lcAgentLabel(agent, false)}` +
                `<div class="lc-track">${track}</div></div>`;
        });
        return html;
    },

    renderLifecycles() {
        const lc = this.lc;
        const empty = document.getElementById('lcEmpty');
        const chart = document.getElementById('lcChart');
        const axis = document.getElementById('lcAxisArea');
        const rows = document.getElementById('lcRows');
        if (!empty || !chart || !axis || !rows) { return; }

        if (!lc.agents.length) {
            empty.classList.remove('hidden');
            chart.classList.add('hidden');
            return;
        }
        empty.classList.add('hidden');
        chart.classList.remove('hidden');

        const interval = Utils.computeTickInterval(lc.view.xMax - lc.view.xMin, axis.clientWidth || 600);
        const ticks = [];
        for (let t = Math.ceil(lc.view.xMin / interval) * interval; t <= lc.view.xMax; t += interval) {
            ticks.push(t);
        }
        axis.innerHTML = ticks.map(t =>
            `<span class="lc-tick-label" style="left:${this.lcToPct(t).toFixed(3)}%">${Utils.formatTimeAxis(t, interval)}</span>`
        ).join('');

        const grid = ticks.map(t => `<div class="lc-grid-line" style="left:${this.lcToPct(t).toFixed(3)}%"></div>`).join('');
        rows.innerHTML = lc.mode === 'tree' ? this.renderTreeRows(grid) : this.renderPackedRows(grid);
    },

    updateLifecycleModeButtons() {
        const lc = this.lc;
        const isTree = lc.mode === 'tree';
        const button = document.getElementById('lcBtnMode');
        if (button) {
            button.textContent = isTree ? 'Switch to Packed lanes' : 'Switch to Tree';
            button.setAttribute('aria-pressed', String(!isTree));
            button.title = isTree
                ? 'Show sessions packed into concurrent lanes inside each agent band'
                : 'Show agents as expandable rows with one row per session';
        }
        document.getElementById('lcBtnExpandAll')?.classList.toggle('hidden', !isTree);
        document.getElementById('lcBtnCollapseAll')?.classList.toggle('hidden', !isTree);
    },

    lifecycleTooltipHtml(bar) {
        const lc = this.lc;
        const esc = Utils.escapeHtml;
        const agent = lc.agents.find(a => a.pid === bar.dataset.pid);
        if (!agent) { return ''; }
        const session = bar.dataset.session ? agent.sessions.find(s => s.sessionId === bar.dataset.session) : undefined;
        const item = session ?? agent;
        const title = session
            ? `${esc(session.sessionId)} on PID ${esc(agent.pid)}`
            : `PID ${esc(agent.pid)}${agent.agentNumbers.length ? ` (Agt#${esc(agent.agentNumbers.join(','))})` : ''}`;
        let html = `<strong>${title}</strong><br>` +
            `Start: ${Utils.formatClockTime(item.startSec)} &nbsp; End: ${Utils.formatClockTime(item.endSec)}<br>` +
            `Duration: ${Utils.formatSpan(item.endSec - item.startSec)}<br>Log lines: ${item.entryCount}`;
        html += session
            ? `<br>Requests: ${session.requestCount} &nbsp; Errors: ${session.errorCount}`
            : `<br>Sessions: ${agent.sessions.length}`;
        return html;
    },

    /** Open the Logfiles view filtered on a PID, session or request. */
    openLifecycleInLogfiles(filter) {
        this.openLogfilesWith({
            applicationName: this.selectedApplication,
            date: this.lc.date,
            ...filter
        });
    },

    // ==================== DOM HELPERS ====================

    setText(id, text) {
        const element = document.getElementById(id);
        if (element) { element.textContent = text; }
    },

    setLifecyclesEmpty(text) {
        this.setText('lcEmpty', text);
        if (this.lc && !this.lc.agents.length) {
            document.getElementById('lcEmpty')?.classList.remove('hidden');
            document.getElementById('lcChart')?.classList.add('hidden');
        }
    },

    setLifecyclesStatus(text) {
        this.setText('lcLoadStatus', text);
    },

    setLifecyclesBusy(busy) {
        document.getElementById('lcSpinner')?.classList.toggle('active', busy);
    },

    setFlameBusy(busy) {
        document.getElementById('lcFlameSpinner')?.classList.toggle('active', busy);
    },

    showLifecyclesError(message) {
        const box = document.getElementById('lcError');
        if (!box) { return; }
        box.textContent = message;
        box.classList.toggle('hidden', !message);
    },

    // ==================== EVENT HANDLERS ====================

    setupLifecyclesEventHandlers() {
        if (this._lcHandlersAttached) { return; }
        this._lcHandlersAttached = true;
        const self = this;
        const lc = this.lc;

        const dateInput = document.getElementById('lcDate');
        if (dateInput) { dateInput.value = new Date().toISOString().split('T')[0]; }
        dateInput?.addEventListener('change', () => {
            lc.zoomed = false;
            self.loadLifecycles();
        });
        document.getElementById('lcBtnRefresh')?.addEventListener('click', () => {
            if (lc.sources) { self.refreshLifecycles(); } else { self.loadLifecycles(); }
        });

        let minSessionsTimer = null;
        document.getElementById('lcMinSessions')?.addEventListener('input', (e) => {
            clearTimeout(minSessionsTimer);
            minSessionsTimer = setTimeout(() => {
                lc.minSessions = Math.max(0, parseInt(e.target.value, 10) || 0);
                self.refreshAgentFilter();
            }, 200);
        });

        document.getElementById('lcBtnMode')?.addEventListener('click', () => {
            lc.mode = lc.mode === 'tree' ? 'packed' : 'tree';
            self.updateLifecycleModeButtons();
            self.renderLifecycles();
        });
        document.getElementById('lcBtnExpandAll')?.addEventListener('click', () => {
            lc.agents.forEach(a => { if (a.sessions.length) { lc.expanded.add(a.pid); } });
            self.renderLifecycles();
        });
        document.getElementById('lcBtnCollapseAll')?.addEventListener('click', () => {
            lc.expanded.clear();
            self.renderLifecycles();
        });
        document.getElementById('lcBtnResetZoom')?.addEventListener('click', () => self.resetLifecycleView());
        document.getElementById('lcBtnFlameToggle')?.addEventListener('click', () => self.toggleFlameChart());
        document.getElementById('lcBtnSessionFlameToggle')?.addEventListener('click', () => self.toggleSessionFlame());

        this.setupLifecycleChartInteractions();
        this.setupLifecycleCanvasCharts();
        this.setupLifecycleResizer();

        this.updateLifecycleModeButtons();
        this.applyFlameVisibility();
        this.applySessionFlameVisibility();
    },

    setupLifecycleChartInteractions() {
        const self = this;
        const lc = this.lc;
        const rows = document.getElementById('lcRows');
        const tooltip = document.getElementById('lcTooltip');
        const selection = document.getElementById('lcSelection');
        const axis = document.getElementById('lcAxisArea');
        const body = document.getElementById('lcBody');
        if (!rows || !tooltip || !selection || !axis || !body) { return; }

        const trackTimeAt = (clientX) => {
            const rect = axis.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
            return { ratio, sec: lc.view.xMin + ratio * (lc.view.xMax - lc.view.xMin) };
        };

        rows.addEventListener('mouseover', (e) => {
            const bar = e.target.closest('.lc-bar');
            if (!bar || lc.drag) { return; }
            tooltip.innerHTML = self.lifecycleTooltipHtml(bar);
            tooltip.style.display = 'block';
            LaneCanvasChart.positionTooltip(tooltip, e.clientX, e.clientY);
        });
        rows.addEventListener('mousemove', (e) => {
            if (tooltip.style.display === 'block') {
                LaneCanvasChart.positionTooltip(tooltip, e.clientX, e.clientY);
            }
        });
        rows.addEventListener('mouseout', (e) => {
            if (e.target.closest('.lc-bar')) { tooltip.style.display = 'none'; }
        });

        rows.addEventListener('click', (e) => {
            const caret = e.target.closest('[data-toggle-pid]');
            if (!caret) { return; }
            const pid = caret.dataset.togglePid;
            if (lc.expanded.has(pid)) { lc.expanded.delete(pid); } else { lc.expanded.add(pid); }
            self.renderLifecycles();
        });

        rows.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || !e.target.closest('.lc-track')) { return; }
            e.preventDefault();
            lc.drag = { startX: e.clientX, currentX: e.clientX, bar: e.target.closest('.lc-bar') };
            tooltip.style.display = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!lc.drag) { return; }
            if (e.buttons === 0) {
                // Button released outside the page: mouseup never arrived
                lc.drag = null;
                selection.style.display = 'none';
                return;
            }
            lc.drag.currentX = e.clientX;
            const rect = axis.getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            const x1 = Math.max(rect.left, Math.min(lc.drag.startX, lc.drag.currentX));
            const x2 = Math.min(rect.right, Math.max(lc.drag.startX, lc.drag.currentX));
            selection.style.display = 'block';
            selection.style.left = `${x1}px`;
            selection.style.width = `${Math.max(0, x2 - x1)}px`;
            selection.style.top = `${rect.bottom}px`;
            selection.style.height = `${Math.max(0, bodyRect.bottom - rect.bottom)}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!lc.drag) { return; }
            const drag = lc.drag;
            lc.drag = null;
            selection.style.display = 'none';
            if (Math.abs(drag.currentX - drag.startX) < 5) {
                if (drag.bar) {
                    self.openLifecycleInLogfiles({
                        processId: drag.bar.dataset.pid,
                        agentSessionId: drag.bar.dataset.session || undefined
                    });
                }
                return;
            }
            const a = trackTimeAt(Math.min(drag.startX, drag.currentX)).sec;
            const b = trackTimeAt(Math.max(drag.startX, drag.currentX)).sec;
            if (b - a >= 1) { self.setLifecycleView({ xMin: a, xMax: b }); }
        });

        // Plain wheel scrolls the rows; Ctrl+wheel zooms the time axis
        rows.addEventListener('wheel', (e) => {
            if (!e.ctrlKey || !e.target.closest('.lc-track')) { return; }
            e.preventDefault();
            const { ratio } = trackTimeAt(e.clientX);
            self.setLifecycleView(Utils.zoomRange(lc.view.xMin, lc.view.xMax, ratio, e.deltaY > 0));
        }, { passive: false });

        // Re-render only on real width changes to avoid scrollbar-driven feedback loops
        let axisWidth = 0;
        new ResizeObserver(() => {
            const width = axis.clientWidth;
            if (width === axisWidth) { return; }
            axisWidth = width;
            if (lc.agents.length) { self.renderLifecycles(); }
        }).observe(axis);
    },

    setupLifecycleCanvasCharts() {
        const self = this;
        const lc = this.lc;
        const getView = () => lc.view;
        const setView = (view) => self.setLifecycleView(view);
        const esc = Utils.escapeHtml;

        const flameCanvas = document.getElementById('lcFlameCanvas');
        if (flameCanvas) {
            lc.flameChart = new LaneCanvasChart({
                container: document.getElementById('lcFlameContainer'),
                canvas: flameCanvas,
                tooltip: document.getElementById('lcFlameTooltip'),
                gutter: LC_GUTTER_PX,
                barHeight: 14,
                laneHeight: 16,
                getView,
                setView,
                colorOf: (item) => self.lifecycleStatusColor(item.statusCode),
                tooltipHtml: (item) =>
                    `<b>${esc(item.method)} ${esc(item.url || '')}</b><br>` +
                    `Status: ${item.statusCode} &nbsp; Duration: ${(item.responseTime / 1000).toFixed(1)}ms<br>` +
                    `Start: ${Utils.formatClockTime(item.startSec)} &nbsp; End: ${Utils.formatClockTime(item.endSec)}<br>` +
                    `Client: ${esc(item.clientIp)}`,
                onSelect: (item) => {
                    if (item.requestId && item.requestId !== '-') {
                        self.openLifecycleInLogfiles({ requestId: item.requestId });
                    }
                }
            });
        }

        const sfCanvas = document.getElementById('lcSfCanvas');
        if (sfCanvas) {
            lc.sessionFlameChart = new LaneCanvasChart({
                container: document.getElementById('lcSfContainer'),
                canvas: sfCanvas,
                tooltip: document.getElementById('lcSfTooltip'),
                gutter: LC_GUTTER_PX,
                barHeight: 14,
                laneHeight: 16,
                getView,
                setView,
                // 'cc' = 80% alpha on the hex color
                colorOf: (item) => `${LC_COLORS[item.colorIdx % LC_COLORS.length]}cc`,
                outlineOf: (item) => (item.errors > 0 ? '#f14c4c' : null),
                tooltipHtml: (item) =>
                    `<b>${esc(item.sessionId)} on PID ${esc(item.pid)}</b><br>` +
                    `Start: ${Utils.formatClockTime(item.startSec)} &nbsp; End: ${Utils.formatClockTime(item.endSec)}<br>` +
                    `Duration: ${Utils.formatSpan(item.endSec - item.startSec)}<br>` +
                    `Requests: ${item.requests} &nbsp; Errors: ${item.errors}`,
                onSelect: (item) => self.openLifecycleInLogfiles({ processId: item.pid, agentSessionId: item.sessionId })
            });
        }
    },

    /** Drag handle between the lifecycle chart and the request flame panel. */
    setupLifecycleResizer() {
        const resizer = document.getElementById('lcResizer');
        const panel = document.getElementById('lcFlamePanel');
        if (!resizer || !panel) { return; }
        panel.style.height = '260px';
        document.getElementById('lcSfPanel').style.height = '220px';

        let state = null;
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            state = { startY: e.clientY, startHeight: panel.offsetHeight };
            resizer.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        });
        document.addEventListener('mousemove', (e) => {
            if (!state) { return; }
            const height = state.startHeight + (state.startY - e.clientY);
            panel.style.height = `${Math.max(60, Math.min(height, window.innerHeight - 200))}px`;
        });
        document.addEventListener('mouseup', () => {
            if (!state) { return; }
            state = null;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    }
};

// Allow CommonJS require() in test environments without affecting browser usage.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LifecyclesViewMixin };
}
