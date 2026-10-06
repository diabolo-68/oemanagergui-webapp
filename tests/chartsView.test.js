/**
 * Unit tests for js/chartsView.js — palette, history/legend bookkeeping and legend interactions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { Utils } = require('../js/utils.js');
const { ChartsViewMixin: M } = require('../js/chartsView.js');

function session(id, extra = {}) {
    return { SessionId: id, SessionState: 'IDLE', StartTime: '2026-01-27T18:07:27.090-01:00', SessionMemory: 3 * 1024 * 1024, RequestsCompleted: 5, RequestsFailed: 1, ...extra };
}

function agent(agentId, sessions, extra = {}) {
    return { agentId, pid: '4711', state: 'AVAILABLE', sessions, ...extra };
}

let app;

beforeEach(() => {
    globalThis.Utils = Utils;
    document.body.innerHTML = ['memory', 'completed', 'failed'].map(id => `
        <div class="legend-control" data-chart="${id}">
            <button class="legend-toggle" data-chart="${id}"></button>
            <div class="legend-popover" data-chart="${id}"></div>
        </div>`).join('');

    app = {
        selectedApplication: 'APP',
        chartHistoryData: new Map(),
        refreshIntervals: { charts: 10 },
        agentService: {
            fetchAgentsWithSessions: vi.fn(),
            fetchAgentMetrics: vi.fn().mockResolvedValue({ result: { AgentStatHist: [{ CStackMemory: 2048, ActiveThreads: 4 }] } })
        }
    };
    Object.assign(app, M);
});

describe('ChartsViewMixin.getChartColors', () => {
    it('returns 10 RGBA color strings', () => {
        const colors = M.getChartColors();
        expect(Array.isArray(colors)).toBe(true);
        expect(colors).toHaveLength(10);
        for (const c of colors) {
            expect(c).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*1\)$/);
        }
    });

    it('returns the same palette on repeated calls', () => {
        expect(M.getChartColors()).toEqual(M.getChartColors());
    });
});

describe('ChartsViewMixin.loadChartsData legend bookkeeping', () => {
    it('records history, agent metrics and session info for the legend', async () => {
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('A1', [session(4), session(5)])]);

        await app.loadChartsData();
        await app.chartMetricsPromise;

        expect(app.chartHistoryData.get('A1-4')).toHaveLength(1);
        const [legendAgent] = app.chartLegendInfo.agents;
        expect(legendAgent).toMatchObject({ agentId: 'A1', pid: '4711', state: 'AVAILABLE' });
        expect(legendAgent.metrics).toMatchObject({ ActiveThreads: 4 });
        expect(legendAgent.sessions.map(s => s.sessionKey)).toEqual(['A1-4', 'A1-5']);
        expect(legendAgent.sessions[0]).toMatchObject({ memory: 3, requestsCompleted: 5, requestsFailed: 1, state: 'IDLE' });
    });

    it('keeps the last known metrics when a metrics request fails', async () => {
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('A1', [session(4)])]);
        await app.loadChartsData();
        await app.chartMetricsPromise;

        app.agentService.fetchAgentMetrics.mockRejectedValue(new Error('down'));
        await app.loadChartsData();
        await app.chartMetricsPromise;

        expect(app.chartLegendInfo.agents[0].metrics).toMatchObject({ ActiveThreads: 4 });
    });

    it('records history and updates charts without waiting for slow agent metrics', async () => {
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('A1', [session(4)])]);
        app.agentService.fetchAgentMetrics.mockReturnValue(new Promise(() => {}));
        app.updateCharts = vi.fn();

        await app.loadChartsData();

        expect(app.updateCharts).toHaveBeenCalledTimes(1);
        expect(app.chartHistoryData.get('A1-4')).toHaveLength(1);
    });

    it('removes a session from history and legend once it left the 200-point window', async () => {
        app.agentService.fetchAgentsWithSessions.mockResolvedValueOnce([agent('A1', [session(4), session(5)])]);
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('A1', [session(4)])]);

        await app.loadChartsData();
        for (let i = 0; i < 199; i++) { await app.loadChartsData(); }
        expect(app.chartHistoryData.has('A1-5')).toBe(true);

        await app.loadChartsData();

        expect(app.chartHistoryData.has('A1-5')).toBe(false);
        expect(app.chartLegendInfo.agents[0].sessions.map(s => s.sessionId)).toEqual(['4']);
        expect(app.chartHistoryData.get('A1-4')).toHaveLength(200);
    });

    it('drops an agent once none of its sessions remain in the window', async () => {
        app.agentService.fetchAgentsWithSessions.mockResolvedValueOnce([agent('A1', [session(4)]), agent('A2', [session(1)])]);
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('A1', [session(4)])]);

        for (let i = 0; i < 201; i++) { await app.loadChartsData(); }

        expect(app.chartLegendInfo.agents.map(a => a.agentId)).toEqual(['A1']);
        expect(app.chartAgentInfo.has('A2')).toBe(false);
    });

    it('discards results when the application changed during the request', async () => {
        app.agentService.fetchAgentsWithSessions.mockImplementation(async () => {
            app.selectedApplication = 'OTHER';
            return [agent('A1', [session(4)])];
        });

        await app.loadChartsData();

        expect(app.chartHistoryData.size).toBe(0);
    });

    it('clearChartHistory resets history, caches, colors and the rendered legend', async () => {
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('A1', [session(4)])]);
        await app.loadChartsData();

        app.clearChartHistory();

        expect(app.chartHistoryData.size).toBe(0);
        expect(app.chartSessionInfo.size).toBe(0);
        expect(app.chartSessionColors.size).toBe(0);
        expect(document.querySelector('.legend-popover').textContent).toBe('No sessions');
    });
});

describe('ChartsViewMixin.assignChartSessionColors', () => {
    beforeEach(() => app.ensureChartLegendState());

    it('keeps existing session colors when new sessions appear', () => {
        app.assignChartSessionColors(['a', 'b']);
        const colorA = app.chartSessionColors.get('a');
        const colorB = app.chartSessionColors.get('b');

        app.assignChartSessionColors(['a', 'b', 'c']);

        expect(app.chartSessionColors.get('a')).toBe(colorA);
        expect(app.chartSessionColors.get('b')).toBe(colorB);
        expect(new Set(app.chartSessionColors.values()).size).toBe(3);
    });

    it('reuses the color of a removed session and clears its hidden flag', () => {
        app.assignChartSessionColors(['a', 'b']);
        const colorA = app.chartSessionColors.get('a');
        app.chartHiddenSessions.memory.add('a');

        app.assignChartSessionColors(['b', 'c']);

        expect(app.chartSessionColors.has('a')).toBe(false);
        expect(app.chartSessionColors.get('c')).toBe(colorA);
        expect(app.chartHiddenSessions.memory.has('a')).toBe(false);
    });

    it('wraps around the palette when there are more sessions than colors', () => {
        const keys = Array.from({ length: 12 }, (_, i) => `s${i}`);
        app.assignChartSessionColors(keys);
        expect(app.chartSessionColors.size).toBe(12);
    });
});

describe('ChartsViewMixin legend rendering and interaction', () => {
    async function loadWithLegend() {
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('A1', [session(4)])]);
        await app.loadChartsData();
    }

    it('renders agent info, metrics and one row per session with the chart specific value', async () => {
        await loadWithLegend();

        const memory = document.querySelector('.legend-popover[data-chart="memory"]');
        expect(memory.textContent).toContain('Agent A1');
        expect(memory.textContent).toContain('PID 4711');
        expect(memory.textContent).toContain('4 threads');
        expect(memory.querySelectorAll('.legend-session')).toHaveLength(1);
        expect(memory.querySelector('.legend-session-value').textContent).toBe('3.0 MB');
        expect(document.querySelector('.legend-popover[data-chart="completed"] .legend-session-value').textContent).toBe('5');
        expect(document.querySelector('.legend-popover[data-chart="failed"] .legend-session-value').textContent).toBe('1');
    });

    it('escapes agent and session text coming from the server', async () => {
        app.agentService.fetchAgentsWithSessions.mockResolvedValue([agent('<img src=x>', [session('<b>1</b>')])]);

        await app.loadChartsData();

        const popover = document.querySelector('.legend-popover[data-chart="memory"]');
        expect(popover.querySelector('img')).toBeNull();
        expect(popover.querySelector('b')).toBeNull();
    });

    it('clicking the icon pins and unpins the legend', async () => {
        await loadWithLegend();
        const toggle = document.querySelector('.legend-toggle[data-chart="memory"]');
        const control = document.querySelector('.legend-control[data-chart="memory"]');

        app.handleChartLegendClick({ target: toggle });
        expect(control.classList.contains('pinned')).toBe(true);

        app.handleChartLegendClick({ target: toggle });
        expect(control.classList.contains('pinned')).toBe(false);
    });

    it('clicking a session row hides and shows its line on that chart only', async () => {
        await loadWithLegend();
        const dataset = { label: 'A1-4', hidden: false };
        const chart = { data: { datasets: [dataset] }, update: vi.fn(), getDatasetMeta: () => ({ hidden: true }) };
        app.memoryTimeChart = chart;

        const row = () => document.querySelector('.legend-popover[data-chart="memory"] .legend-session');
        app.handleChartLegendClick({ target: row() });

        expect(dataset.hidden).toBe(true);
        expect(chart.update).toHaveBeenCalledWith('none');
        expect(row().classList.contains('hidden-series')).toBe(true);
        expect(document.querySelector('.legend-popover[data-chart="completed"] .legend-session').classList.contains('hidden-series')).toBe(false);

        app.handleChartLegendClick({ target: row() });
        expect(dataset.hidden).toBe(false);
    });

    it('shows a placeholder when there are no sessions', () => {
        app.ensureChartLegendState();
        app.chartLegendInfo = { agents: [] };
        app.renderChartLegends();
        expect(document.querySelector('.legend-popover[data-chart="memory"]').textContent).toBe('No sessions');
    });
});
