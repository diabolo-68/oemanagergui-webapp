/**
 * Unit tests for js/metricsView.js — condensed agent metrics (summary table + combined grids).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { Utils } = require('../js/utils.js');
const { MetricsViewMixin } = require('../js/metricsView.js');

const GRID_NAMES = ['Summary', 'Threads', 'Connections', 'Requests'];

function buildMetricsDom() {
    const grids = GRID_NAMES.map(name => `
        <span id="metrics${name}Count"></span>
        <table id="metrics${name}Table"><thead id="metrics${name}Head"></thead><tbody></tbody></table>
        <div id="metrics${name}Empty"></div>`).join('');
    document.body.innerHTML = `
        <div id="metricsContainer"><div id="metricsError" class="hidden"></div>
        <div id="sessionManagerContent"></div>${grids}</div>
        <span id="metricsSpinner"></span><span id="metricsRefreshStatus"></span><button id="pauseMetricsBtn"></button>`;
}

function snapshot(agentId, overrides = {}) {
    return {
        agentId,
        pid: '4711',
        metrics: { CStackMemory: 2048, ActiveThreads: 3, RequestsCompleted: 10, AvgRequestDuration: 1500 },
        status: { threads: 6, sessions: 5, connections: 4, requests: 99 },
        threads: [{ ThreadId: 1, ThreadState: 'IDLE', StartTime: '2026-01-27T18:07:27.090-01:00', EndTime: null }],
        connections: [{ ConnectionId: 7, ConnectionState: 'CONNECTED', SessionId: 2 }],
        requests: [],
        ...overrides
    };
}

let app;

beforeEach(() => {
    globalThis.Utils = Utils;
    buildMetricsDom();
    app = {
        selectedApplication: 'APP',
        includeRequests: false,
        refreshIntervals: { metrics: 10 },
        metricsPaused: false,
        metricsData: {},
        agentService: {
            fetchMetrics: vi.fn().mockResolvedValue({ requests: 1 }),
            fetchAgents: vi.fn().mockResolvedValue([{ agentId: 'A1', pid: '1' }, { agentId: 'A2', pid: '2' }]),
            fetchAgentMetrics: vi.fn().mockResolvedValue({ result: { AgentStatHist: [{ ActiveThreads: 2 }] } }),
            fetchAgentConnections: vi.fn().mockResolvedValue([]),
            fetchAgentThreads: vi.fn().mockResolvedValue([]),
            fetchAgentStatus: vi.fn().mockResolvedValue({ threads: 1 }),
            fetchAgentRequests: vi.fn().mockResolvedValue([])
        }
    };
    Object.assign(app, MetricsViewMixin);
    // Rendering of the SessionManager table needs Templates, which is out of scope here
    app.renderMetricsView = function renderOnlyAgents() {
        this.renderMetrics(this.metricsData.agentMetrics || [], this.includeRequests);
    };
});

describe('MetricsViewMixin summary rows', () => {
    it('builds label, formatted metrics and a reset button cell for a healthy agent', () => {
        const cells = app.metricsSummaryCells(snapshot('A1'));

        expect(cells[0]).toEqual({ text: 'A1 (PID 4711)', cls: 'agent-cell' });
        expect(cells.map(c => c.text).slice(1, 5)).toEqual([6, 5, 4, 99]);
        expect(cells.find(c => c.text === '2 KB')).toBeDefined();
        expect(cells.find(c => c.text === '1.5s')).toBeDefined();
        expect(cells[cells.length - 1].button).toMatchObject({ label: 'Reset', agentId: 'A1' });
    });

    it('spans the error message over all metric columns for a failed agent', () => {
        const cells = app.metricsSummaryCells(snapshot('A1', { error: 'boom' }));

        expect(cells).toHaveLength(3);
        expect(cells[1]).toMatchObject({ text: 'boom', cls: 'group-start error-cell' });
        expect(cells[1].colSpan).toBeGreaterThan(10);
    });

    it('flattenMetricsRows pairs every item with its agent', () => {
        const rows = app.flattenMetricsRows([snapshot('A1'), snapshot('A2')], 'connections');
        expect(rows.map(r => r.agent.agentId)).toEqual(['A1', 'A2']);
        expect(rows[0].item.ConnectionId).toBe(7);
    });
});

describe('MetricsViewMixin.renderMetrics', () => {
    it('renders one summary row per agent and combined grids with counts', () => {
        app.renderMetrics([snapshot('A1'), snapshot('A2')], false);

        expect(document.querySelectorAll('#metricsSummaryTable tbody tr')).toHaveLength(2);
        expect(document.querySelectorAll('#metricsThreadsTable tbody tr')).toHaveLength(2);
        expect(document.getElementById('metricsThreadsCount').textContent).toBe('(2)');
        expect(document.querySelectorAll('#metricsSummaryHead tr')).toHaveLength(2);
    });

    it('reuses existing rows by key so selection survives a refresh', () => {
        app.renderMetrics([snapshot('A1')], false);
        const firstRow = document.querySelector('#metricsSummaryTable tbody tr');

        app.renderMetrics([snapshot('A1', { status: { threads: 9 } })], false);

        expect(document.querySelector('#metricsSummaryTable tbody tr')).toBe(firstRow);
        expect(firstRow.cells[1].textContent).toBe('9');
    });

    it('removes rows of agents that disappeared and shows the empty text', () => {
        app.renderMetrics([snapshot('A1'), snapshot('A2')], false);
        app.renderMetrics([], false);

        expect(document.querySelectorAll('#metricsSummaryTable tbody tr')).toHaveLength(0);
        expect(document.getElementById('metricsSummaryEmpty').textContent).toBe('No agents found');
        expect(document.getElementById('metricsSummaryEmpty').classList.contains('hidden')).toBe(false);
    });

    it('builds the summary header only once', () => {
        app.renderMetrics([], false);
        app.renderMetrics([], false);
        expect(document.querySelectorAll('#metricsSummaryHead tr')).toHaveLength(2);
    });

    it('shows request rows with a clickable Request ID only when requests are included', () => {
        const withRequest = snapshot('A1', {
            requests: [{ RequestNum: 1, requestID: 'ROOT:w:00000001', RequestProcName: 'p', SessionId: 4, ConnectionId: 8, StartTime: null, RequestLen: 12, RequestStatus: 0 }]
        });

        app.renderMetrics([withRequest], true);
        const link = document.querySelector('#metricsRequestsTable .request-id-link');
        expect(link.dataset.requestId).toBe('ROOT:w:00000001');

        app.renderMetrics([withRequest], false);
        expect(document.querySelectorAll('#metricsRequestsTable tbody tr')).toHaveLength(0);
        expect(document.getElementById('metricsRequestsEmpty').textContent).toMatch(/Include Requests/);
    });

    it('orders threads newest first', () => {
        const agent = snapshot('A1', {
            threads: [
                { ThreadId: 1, ThreadState: 'IDLE', StartTime: '2026-01-27T10:00:00.000+01:00' },
                { ThreadId: 2, ThreadState: 'IDLE', StartTime: '2026-01-27T12:00:00.000+01:00' }
            ]
        });
        app.renderMetrics([agent], false);

        const ids = Array.from(document.querySelectorAll('#metricsThreadsTable tbody tr')).map(r => r.cells[1].textContent);
        expect(ids).toEqual(['2', '1']);
    });
});

describe('MetricsViewMixin.loadMetricsData', () => {
    it('fetches status together with metrics, threads and connections for each agent', async () => {
        await app.loadMetricsData();

        expect(app.agentService.fetchAgentStatus).toHaveBeenCalledTimes(2);
        expect(app.agentService.fetchAgentRequests).not.toHaveBeenCalled();
        expect(app.metricsData.agentMetrics.map(a => a.agentId)).toEqual(['A1', 'A2']);
        expect(app.metricsData.agentMetrics[0].metrics).toEqual({ ActiveThreads: 2 });
        expect(app.metricsData.agentMetrics[0].status).toEqual({ threads: 1 });
    });

    it('fetches requests only when included', async () => {
        app.includeRequests = true;
        await app.loadMetricsData();
        expect(app.agentService.fetchAgentRequests).toHaveBeenCalledTimes(2);
    });

    it('reports a failing agent in its own row without failing the others', async () => {
        app.agentService.fetchAgentThreads.mockImplementation(async (_app, id) => {
            if (id === 'A1') { throw new Error('agent down'); }
            return [];
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await app.loadMetricsData();

        const [first, second] = app.metricsData.agentMetrics;
        expect(first.error).toBe('agent down');
        expect(second.error).toBeUndefined();
    });

    it('drops timer ticks while a load is running but queues explicit reloads', async () => {
        let release;
        app.agentService.fetchAgents.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]); }));

        const first = app.loadMetricsData();
        await app.loadMetricsData(false);
        expect(app._metricsReloadQueued).toBeFalsy();

        await app.loadMetricsData(true);
        expect(app._metricsReloadQueued).toBe(true);

        app.agentService.fetchAgents.mockResolvedValue([]);
        release();
        await first;
        expect(app.agentService.fetchAgents.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('ignores results for an application that is no longer selected', async () => {
        app.agentService.fetchAgents.mockImplementationOnce(async () => {
            app.selectedApplication = 'OTHER';
            return [{ agentId: 'A1', pid: '1' }];
        });

        await app.loadMetricsData();

        expect(app.metricsData).toEqual({});
    });

    it('shows an error box when the agent list cannot be loaded', async () => {
        app.agentService.fetchAgents.mockRejectedValueOnce(new Error('offline'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await app.loadMetricsData();

        const box = document.getElementById('metricsError');
        expect(box.textContent).toBe('Error loading metrics: offline');
        expect(box.classList.contains('hidden')).toBe(false);
    });
});

describe('MetricsViewMixin auto-refresh', () => {
    it('refreshes on the configured interval without queueing and stops on pause', () => {
        vi.useFakeTimers();
        app.loadMetricsData = vi.fn();

        app.startMetricsAutoRefresh();
        vi.advanceTimersByTime(20_000);
        expect(app.loadMetricsData).toHaveBeenCalledTimes(2);
        expect(app.loadMetricsData).toHaveBeenCalledWith(false);

        app.toggleMetricsPause();
        app.loadMetricsData.mockClear();
        vi.advanceTimersByTime(20_000);
        expect(app.loadMetricsData).not.toHaveBeenCalled();
        expect(document.getElementById('pauseMetricsBtn').textContent).toBe('Resume');
        vi.useRealTimers();
    });

    it('does not schedule a timer when the interval is 0', () => {
        app.refreshIntervals.metrics = 0;
        app.startMetricsAutoRefresh();
        expect(app.metricsRefreshTimer).toBeFalsy();
        expect(document.getElementById('metricsRefreshStatus').textContent).toMatch(/auto-refresh off/);
    });

    it('resuming reloads immediately and restarts the timer', () => {
        vi.useFakeTimers();
        app.loadMetricsData = vi.fn();
        app.metricsPaused = true;

        app.toggleMetricsPause();

        expect(app.metricsPaused).toBe(false);
        expect(app.loadMetricsData).toHaveBeenCalledTimes(1);
        expect(app.metricsRefreshTimer).toBeTruthy();
        app.stopMetricsAutoRefresh();
        vi.useRealTimers();
    });
});

describe('MetricsViewMixin.handleMetricsClick', () => {
    it('opens the Logfiles view for a clicked Request ID', () => {
        app.openLogfilesWith = vi.fn();
        document.body.innerHTML = '<table><tr><td class="request-id-link" data-request-id="ROOT:w:1"><b>x</b></td></tr></table>';

        app.handleMetricsClick({ target: document.querySelector('b') });

        expect(app.openLogfilesWith).toHaveBeenCalledWith({ applicationName: 'APP', requestId: 'ROOT:w:1' });
    });

    it('resets one agent when its Reset button is clicked', () => {
        app.resetAgentStatistics = vi.fn();
        document.body.innerHTML = '<button class="btn-reset-agent" data-agent-id="A9">Reset</button>';

        app.handleMetricsClick({ target: document.querySelector('button') });

        expect(app.resetAgentStatistics).toHaveBeenCalledWith('A9');
    });
});
