/**
 * Unit tests for js/lifecyclesView.js — pure helpers and the bounded log streaming loader.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { Utils } = require('../js/utils.js');
const { LogFileService } = require('../js/logFileService.js');
const { LifecyclesViewMixin } = require('../js/lifecyclesView.js');

const AGENT_LINE = (time, pid, session) =>
    `2026-04-16T${time}.000+0200 ${pid} 222 1 ${session} ?:?:? APPL message\n`;

const ACCESS_LINE = (time, requestId, micros) =>
    `10.0.0.1 - user [2026-04-16T${time}.000+02:00] "GET /web/x HTTP/1.1" 200 - ${requestId} ${micros}\n`;

function chunk(startOffset, newOffset, totalSize, content, hasNewer = newOffset < totalSize) {
    return { content, startOffset, newOffset, totalSize, hasOlder: startOffset > 0, hasNewer, fileTruncated: false };
}

let app;

beforeEach(() => {
    globalThis.Utils = Utils;
    globalThis.LogFileService = LogFileService;

    app = {
        agentService: { readServerFile: vi.fn() },
        config: {},
        refreshIntervals: { logs: 5 }
    };
    Object.assign(app, LifecyclesViewMixin);
    app.initLifecyclesState();
    app.resetLifecyclesData();
    app.lc.date = '2026-04-16';
    app.lc.sources = {
        agentLogRelPath: 'logs/agent.log',
        accessLogRelPath: 'logs/access.log',
        pasoePath: undefined,
        hasDateToken: true
    };
});

describe('LifecyclesViewMixin pure helpers', () => {
    const agents = [
        { pid: '1', startSec: 100, endSec: 200, sessions: [{}, {}, {}] },
        { pid: '2', startSec: 150, endSec: 300, sessions: [{}] }
    ];

    it('filterLifecycleAgents keeps agents with at least the threshold sessions', () => {
        expect(app.filterLifecycleAgents(agents, 2).map(a => a.pid)).toEqual(['1']);
        expect(app.filterLifecycleAgents(agents, 0)).toHaveLength(2);
    });

    it('computeLifecycleFit pads the agent range by 3 percent', () => {
        const fit = app.computeLifecycleFit(agents, null);
        expect(fit.xMin).toBeCloseTo(94);
        expect(fit.xMax).toBeCloseTo(306);
    });

    it('computeLifecycleFit includes the request range and falls back to a full day', () => {
        const fit = app.computeLifecycleFit(agents, { min: 10, max: 5000 });
        expect(fit.xMin).toBeLessThan(10 + 1);
        expect(fit.xMax).toBeGreaterThan(5000);
        expect(app.computeLifecycleFit([], null)).toEqual({ xMin: 0, xMax: 86400 });
    });

    it('computeLifecycleFit never exceeds the day bounds', () => {
        const fit = app.computeLifecycleFit([{ startSec: 0, endSec: 86400, sessions: [] }], null);
        expect(fit.xMin).toBe(0);
        expect(fit.xMax).toBe(86400);
    });

    it('toFlameEntries derives start from end minus microsecond duration and sorts by start', () => {
        const entries = app.toFlameEntries([
            { timestamp: '2026-04-16T10:00:10.000+02:00', responseTime: 2_000_000, method: 'GET', url: '/b', statusCode: 200, clientIp: '1', appRequestId: 'r2' },
            { timestamp: '2026-04-16T10:00:05.000+02:00', responseTime: 1_000_000, method: 'GET', url: '/a', statusCode: 500, clientIp: '1', appRequestId: 'r1' },
            { timestamp: 'garbage', responseTime: 1, method: 'GET', url: '/c', statusCode: 200, clientIp: '1', appRequestId: 'r3' }
        ]);
        expect(entries.map(e => e.requestId)).toEqual(['r1', 'r2']);
        expect(entries[0]).toMatchObject({ startSec: 36000 + 4, endSec: 36000 + 5 });
        expect(entries[1].startSec).toBe(36000 + 8);
    });

    it('toFlameEntries clamps the start at midnight', () => {
        const [entry] = app.toFlameEntries([
            { timestamp: '2026-04-16T00:00:01.000+02:00', responseTime: 5_000_000, method: 'GET', url: '/', statusCode: 200, clientIp: '1', appRequestId: 'r' }
        ]);
        expect(entry.startSec).toBe(0);
    });

    it('buildSessionFlameEntries colors sessions by their agent index', () => {
        const entries = app.buildSessionFlameEntries([
            { pid: 'A', sessions: [{ sessionId: 'AS-1', startSec: 1, endSec: 2, requestCount: 3, errorCount: 0 }] },
            { pid: 'B', sessions: [{ sessionId: 'AS-1', startSec: 1, endSec: 2, requestCount: 0, errorCount: 1 }] }
        ]);
        expect(entries.map(e => [e.pid, e.colorIdx, e.errors])).toEqual([['A', 0, 0], ['B', 1, 1]]);
    });

    it('lifecycleStatusColor maps status classes to distinct colors', () => {
        const colors = [200, 301, 404, 503, 100].map(code => app.lifecycleStatusColor(code));
        expect(new Set(colors).size).toBe(5);
    });
});

describe('LifecyclesViewMixin.streamLifecycleSource', () => {
    it('reads forward in chunks until the server reports no newer data', async () => {
        app.agentService.readServerFile
            .mockResolvedValueOnce(chunk(0, 100, 150, AGENT_LINE('10:00:00', '111', 'AS-1')))
            .mockResolvedValueOnce(chunk(100, 150, 150, AGENT_LINE('10:30:00', '111', 'AS-1')));

        const result = await app.streamLifecycleSource('agent', app.lc.loadToken);

        expect(result).toEqual({ changed: true, truncated: false });
        const offsets = app.agentService.readServerFile.mock.calls.map(call => call[1].offset);
        expect(offsets).toEqual([0, 100]);
        expect(app.agentService.readServerFile.mock.calls[0][1]).toMatchObject({ direction: 'forward' });
        expect(app.lc.agentOffset).toBe(150);

        const lifecycles = app.lcLogService.snapshotLifecycles(app.lc.accumulator);
        expect(lifecycles[0]).toMatchObject({ pid: '111', startSec: 36000, endSec: 37800, entryCount: 2 });
    });

    it('stops when a chunk makes no progress instead of looping forever', async () => {
        app.agentService.readServerFile.mockResolvedValue(chunk(0, 0, 5_000_000, '', true));

        const result = await app.streamLifecycleSource('agent', app.lc.loadToken);

        expect(app.agentService.readServerFile).toHaveBeenCalledTimes(1);
        expect(result.changed).toBe(false);
    });

    it('resumes from the stored offset on refresh', async () => {
        app.lc.agentOffset = 400;
        app.agentService.readServerFile.mockResolvedValueOnce(chunk(400, 400, 400, '', false));

        const result = await app.streamLifecycleSource('agent', app.lc.loadToken);

        expect(app.agentService.readServerFile.mock.calls[0][1].offset).toBe(400);
        expect(result.changed).toBe(false);
    });

    it('reports a truncated or rotated file without consuming the chunk', async () => {
        app.lc.agentOffset = 900;
        app.agentService.readServerFile.mockResolvedValueOnce({
            ...chunk(100, 100, 100, '', false), fileTruncated: true
        });

        const result = await app.streamLifecycleSource('agent', app.lc.loadToken);

        expect(result.truncated).toBe(true);
        expect(app.lc.agentOffset).toBe(900);
    });

    it('drops data from a superseded load', async () => {
        app.agentService.readServerFile.mockImplementationOnce(async () => {
            app.lc.loadToken++;
            return chunk(0, 100, 200, AGENT_LINE('10:00:00', '111', 'AS-1'));
        });

        await app.streamLifecycleSource('agent', app.lc.loadToken);

        expect(app.lcLogService.snapshotLifecycles(app.lc.accumulator)).toEqual([]);
        expect(app.lc.agentOffset).toBe(0);
    });

    it('keeps only the selected day when the agent log path has no date token', async () => {
        app.lc.sources.hasDateToken = false;
        const content = AGENT_LINE('10:00:00', '111', 'AS-1') +
            '2026-04-15T23:59:59.000+0200 111 222 1 AS-1 ?:?:? APPL yesterday\n';
        app.agentService.readServerFile.mockResolvedValueOnce(chunk(0, content.length, content.length, content));

        await app.streamLifecycleSource('agent', app.lc.loadToken);

        const [agent] = app.lcLogService.snapshotLifecycles(app.lc.accumulator);
        expect(agent.entryCount).toBe(1);
    });

    it('collects access log entries from the access source', async () => {
        const content = ACCESS_LINE('10:00:05', 'ROOT:w:0001', 1000) + ACCESS_LINE('10:00:06', 'ROOT:w:0002', 2000);
        app.agentService.readServerFile.mockResolvedValueOnce(chunk(0, content.length, content.length, content));

        await app.streamLifecycleSource('access', app.lc.loadToken);

        expect(app.agentService.readServerFile.mock.calls[0][0]).toBe('logs/access.log');
        expect(app.lc.accessEntries).toHaveLength(2);
        expect(app.lc.accessOffset).toBe(content.length);
    });

    it('propagates read errors so the caller can show them', async () => {
        app.agentService.readServerFile.mockRejectedValueOnce(new Error('readServerFile failed: 404'));
        await expect(app.streamLifecycleSource('agent', app.lc.loadToken)).rejects.toThrow('404');
    });
});

describe('LifecyclesViewMixin lifecycle control', () => {
    it('stopLifecyclesActivity invalidates the running load token and clears the timer', () => {
        const before = app.lc.loadToken;
        app.lc.refreshTimer = setInterval(() => {}, 1000);

        app.stopLifecyclesActivity();

        expect(app.lc.loadToken).toBe(before + 1);
        expect(app.lc.refreshTimer).toBeNull();
        expect(app.lc.loading).toBe(false);
    });

    it('startLifecyclesRefresh schedules by the log refresh interval and stop clears it', () => {
        vi.useFakeTimers();
        app.refreshLifecycles = vi.fn();

        app.startLifecyclesRefresh();
        vi.advanceTimersByTime(10_000);
        expect(app.refreshLifecycles).toHaveBeenCalledTimes(2);

        app.stopLifecyclesRefresh();
        vi.advanceTimersByTime(10_000);
        expect(app.refreshLifecycles).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('openLifecycleInLogfiles passes application, date and filter', () => {
        app.selectedApplication = 'PASOE_DEVSET';
        app.openLogfilesWith = vi.fn();

        app.openLifecycleInLogfiles({ processId: '123', agentSessionId: 'AS-7' });

        expect(app.openLogfilesWith).toHaveBeenCalledWith({
            applicationName: 'PASOE_DEVSET',
            date: '2026-04-16',
            processId: '123',
            agentSessionId: 'AS-7'
        });
    });

    it('refreshAgentFilter hides agents below the threshold and updates the summary', () => {
        document.body.innerHTML = '<div id="lcEmpty"></div><div id="lcChart"></div><div id="lcSummary"></div>';
        app.lc.allAgents = [
            { pid: '1', startSec: 0, endSec: 10, agentNumbers: [], entryCount: 1, sessions: [{ startSec: 0, endSec: 1 }] },
            { pid: '2', startSec: 0, endSec: 10, agentNumbers: [], entryCount: 1, sessions: [] }
        ];
        app.lc.minSessions = 1;

        app.refreshAgentFilter();

        expect(app.lc.agents.map(a => a.pid)).toEqual(['1']);
        expect(document.getElementById('lcSummary').textContent).toBe('1 agents · 1 sessions · 1 hidden');
    });
});
