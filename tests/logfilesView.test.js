import { beforeEach, describe, expect, it, vi } from 'vitest';

const { LogFileService } = require('../js/logFileService.js');
const { LogfilesViewMixin } = require('../js/logfilesView.js');

function rangeResult(startOffset, newOffset, totalSize, content) {
    return {
        content,
        startOffset,
        newOffset,
        totalSize,
        hasOlder: startOffset > 0,
        hasNewer: newOffset < totalSize,
        fileTruncated: false
    };
}

let app;

beforeEach(() => {
    app = {
        logFileService: new LogFileService(),
        agentService: {
            readServerFile: vi.fn()
        }
    };
    Object.assign(app, LogfilesViewMixin);
});

describe('LogfilesViewMixin bounded server windows', () => {
    it('starts with a backward tail request and retains only that chunk', async () => {
        const source = app.createLogSourceWindow('agent');
        source.relativePath = 'logs/agent.log';
        app.agentService.readServerFile.mockResolvedValueOnce(
            rangeResult(750, 1000, 1000, 'tail\n')
        );

        const changed = await app.loadLogSourceChunk(source, 'initial');

        expect(changed).toBe(true);
        expect(app.agentService.readServerFile).toHaveBeenCalledWith('logs/agent.log', {
            direction: 'backward',
            offset: undefined,
            maxBytes: 256 * 1024,
            pasoePathOverride: undefined
        });
        expect(source.chunks).toEqual([
            { startOffset: 750, endOffset: 1000, content: 'tail\n' }
        ]);
        expect(source.hasOlder).toBe(true);
        expect(source.hasNewer).toBe(false);
        expect(source.atTail).toBe(true);
    });

    it('loads older data from the current start and evicts the newest chunk at the budget', async () => {
        const source = app.createLogSourceWindow('agent');
        source.relativePath = 'logs/agent.log';
        source.totalSize = 400;
        source.chunks = [
            { startOffset: 100, endOffset: 200, content: 'b\n' },
            { startOffset: 200, endOffset: 300, content: 'c\n' },
            { startOffset: 300, endOffset: 400, content: 'd\n' }
        ];
        source.hasOlder = true;
        app.agentService.readServerFile.mockResolvedValueOnce(
            rangeResult(0, 100, 400, 'a\n')
        );

        await app.loadLogSourceChunk(source, 'older');

        expect(app.agentService.readServerFile.mock.calls[0][1].offset).toBe(100);
        expect(source.chunks.map(chunk => chunk.startOffset)).toEqual([0, 100, 200]);
        expect(source.hasOlder).toBe(false);
        expect(source.hasNewer).toBe(true);
        expect(source.atTail).toBe(false);
    });

    it('keeps newer navigation available for a final sub-chunk remainder', async () => {
        const source = app.createLogSourceWindow('agent');
        source.relativePath = 'logs/agent.log';
        source.totalSize = 1000;
        source.chunks = [
            { startOffset: 500, endOffset: 800, content: 'existing\n' }
        ];
        source.hasNewer = true;
        app.agentService.readServerFile.mockResolvedValueOnce(
            rangeResult(800, 900, 1000, 'next\n')
        );

        await app.loadLogSourceChunk(source, 'newer');

        expect(source.hasNewer).toBe(true);
        expect(source.atTail).toBe(false);
    });

    it('resets to the new tail when a followed file is truncated or rotated', async () => {
        const source = app.createLogSourceWindow('access');
        source.relativePath = 'logs/access.log';
        source.chunks = [
            { startOffset: 900, endOffset: 1000, content: 'old\n' }
        ];
        source.totalSize = 1000;
        source.atTail = true;

        app.agentService.readServerFile
            .mockResolvedValueOnce({
                ...rangeResult(200, 200, 200, ''),
                fileTruncated: true
            })
            .mockResolvedValueOnce(rangeResult(100, 200, 200, 'new\n'));

        await app.loadLogSourceChunk(source, 'newer');

        expect(app.agentService.readServerFile).toHaveBeenCalledTimes(2);
        expect(app.agentService.readServerFile.mock.calls[1][1].direction).toBe('backward');
        expect(source.chunks).toEqual([
            { startOffset: 100, endOffset: 200, content: 'new\n' }
        ]);
        expect(source.atTail).toBe(true);
    });

    it('does not page the file when a filter leaves no scrollable rows', () => {
        document.body.innerHTML = '<div id="logScrollContainer"></div>';
        const scrollContainer = document.getElementById('logScrollContainer');
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 500 });
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 0 });
        app.logFilteredEntries = [];
        app.logPageEntries = new Array(200);
        app.logCurrentStartIndex = 0;
        app.logFollowTail = false;
        app.loadAdjacentLogWindow = vi.fn();

        app.handleLogScroll();

        expect(app.loadAdjacentLogWindow).not.toHaveBeenCalled();
    });
});

describe('LogfilesViewMixin.resolveLogSources', () => {
    const PROPERTIES = [
        '[AppServer.SessMgr.PASOE_DEVSET]',
        'agentLogFile=${catalina.base}/logs/PASOE_DEVSET.{yyyy-MM-dd}.agent.log'
    ].join('\n');

    beforeEach(() => {
        app.selectedApplication = 'PASOE_DEVSET';
        app.getEffectivePasoePath = () => '/opt/pasoe';
        app.getPasoePathOption = () => undefined;
        app.agentService.readServerFile.mockResolvedValue({ content: PROPERTIES });
    });

    it('resolves relative agent and access log paths for a date', async () => {
        const sources = await app.resolveLogSources('2026-04-16');

        expect(sources).toMatchObject({
            agentLogRelPath: 'logs/PASOE_DEVSET.2026-04-16.agent.log',
            accessLogRelPath: 'logs/localhost-access.2026-04-16.log',
            agentLogFileName: 'PASOE_DEVSET.2026-04-16.agent.log',
            accessLogFileName: 'localhost-access.2026-04-16.log',
            hasDateToken: true
        });
    });

    it('rejects with a readable message when no PASOE path is available', async () => {
        app.getEffectivePasoePath = () => '';
        await expect(app.resolveLogSources('2026-04-16')).rejects.toThrow('PASOE path not available');
    });

    it('rejects when the application has no agentLogFile configured', async () => {
        app.selectedApplication = 'OTHER';
        await expect(app.resolveLogSources('2026-04-16')).rejects.toThrow('No agentLogFile found for application "OTHER"');
    });

    it('rejects when no application is selected', async () => {
        app.selectedApplication = '';
        await expect(app.resolveLogSources('2026-04-16')).rejects.toThrow('select an application');
    });
});

describe('LogfilesViewMixin full-log filter scan', () => {
    const line = (ts, msg) => `${ts} 100 1 1 AS-1 ROOT:w:00000001 APPL  ${msg}\n`;

    beforeEach(() => {
        app.logCurrentFilters = {};
        app.logScanEntries = [];
        app.logScanToken = 0;
        app.logScanStatus = '';
        app.logAllEntries = [];
        app.logCurrentStartIndex = 0;
        app.logSortField = 'timestamp';
        app.logSourceWindows = {
            agent: { ...app.createLogSourceWindow('agent'), relativePath: 'logs/agent.log' },
            access: app.createLogSourceWindow('access')
        };
        app.updateLogEntryCount = vi.fn();
        app.sendLogPage = vi.fn();
    });

    it('only scans when a text filter has at least 3 characters', () => {
        app.logCurrentFilters = { searchText: 'ab' };
        expect(app.hasLogScanFilter()).toBe(false);
        app.logCurrentFilters = { searchText: 'abc' };
        expect(app.hasLogScanFilter()).toBe(true);
        app.logCurrentFilters = { agentNumber: '12345' };
        expect(app.hasLogScanFilter()).toBe(false);
    });

    it('does not read the log for a short filter', async () => {
        app.logCurrentFilters = { searchText: 'ab' };

        await app.startLogFilterScan();

        expect(app.agentService.readServerFile).not.toHaveBeenCalled();
    });

    it('streams the whole log and keeps only matching entries outside the window', async () => {
        app.logCurrentFilters = { searchText: 'needle' };
        app.agentService.readServerFile
            .mockResolvedValueOnce(rangeResult(0, 100, 200, line('2026-04-16T10:00:00.000+0200', 'needle early') + line('2026-04-16T10:00:01.000+0200', 'other')))
            .mockResolvedValueOnce(rangeResult(100, 200, 200, line('2026-04-16T10:00:02.000+0200', 'needle late')));

        await app.startLogFilterScan();

        expect(app.agentService.readServerFile).toHaveBeenCalledTimes(2);
        expect(app.agentService.readServerFile.mock.calls[1][1].offset).toBe(100);
        expect(app.logScanEntries.map(e => e.message.trim())).toEqual(['needle early', 'needle late']);
        expect(app.logFilteredEntries).toHaveLength(2);
        expect(app.logScanStatus).toBe('full log searched');
    });

    it('does not duplicate matches already in the loaded window', () => {
        const entries = app.logFileService.parseAgentLog(line('2026-04-16T10:00:00.000+0200', 'needle'));
        app.logAllEntries = entries;
        app.logScanEntries = app.logFileService.parseAgentLog(line('2026-04-16T10:00:00.000+0200', 'needle'));
        app.logCurrentFilters = { searchText: 'needle' };

        expect(app.filterLogCandidates()).toHaveLength(1);
    });

    it('discards results of a scan that was superseded', async () => {
        app.logCurrentFilters = { searchText: 'needle' };
        app.agentService.readServerFile.mockImplementationOnce(async () => {
            app.cancelLogFilterScan();
            return rangeResult(0, 100, 100, line('2026-04-16T10:00:00.000+0200', 'needle'));
        });

        await app.startLogFilterScan();

        expect(app.logScanEntries).toEqual([]);
    });
});

describe('LogfilesViewMixin pre-filtered open', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <select id="logFilterPid"><option value="">All</option><option value="100">100</option></select>
            <input id="logFilterSession"><input id="logFilterRequestId">`;
    });

    it('setLogFilterValue adds a missing select option so the filter can still apply', () => {
        app.setLogFilterValue('logFilterPid', '200');

        const select = document.getElementById('logFilterPid');
        expect(select.value).toBe('200');
        expect(Array.from(select.options).map(o => o.value)).toEqual(['', '100', '200']);
    });

    it('setLogFilterValue sets text inputs and ignores empty values', () => {
        app.setLogFilterValue('logFilterSession', 'AS-7');
        app.setLogFilterValue('logFilterRequestId', undefined);

        expect(document.getElementById('logFilterSession').value).toBe('AS-7');
        expect(document.getElementById('logFilterRequestId').value).toBe('');
    });

    it('openLogfilesWith loads the date, then applies the filters and shows the window hint', async () => {
        document.body.innerHTML += '<input id="logAutoDate"><span id="logAutoStatus"></span>';
        app.selectedApplication = 'APP';
        app.initLogfilesState = vi.fn();
        app.switchView = vi.fn();
        app.selectApplication = vi.fn();
        app.autoLoadLogs = vi.fn().mockResolvedValue(undefined);
        app.clearLogFilters = vi.fn();
        app.sendLogFilters = vi.fn();

        await app.openLogfilesWith({ applicationName: 'APP', date: '2026-04-16', processId: '100', agentSessionId: 'AS-7', requestId: 'ROOT:w:1' });

        expect(app.selectApplication).not.toHaveBeenCalled();
        expect(app.switchView).toHaveBeenCalledWith('logfiles');
        expect(document.getElementById('logAutoDate').value).toBe('2026-04-16');
        expect(document.getElementById('logFilterPid').value).toBe('100');
        expect(document.getElementById('logFilterSession').value).toBe('AS-7');
        expect(document.getElementById('logFilterRequestId').value).toBe('ROOT:w:1');
        expect(app.sendLogFilters).toHaveBeenCalled();
        expect(document.getElementById('logAutoStatus').textContent).toMatch(/full-log search/);
        expect(app._logfilesAutoLoadAttempted).toBe(true);
    });

    it('openLogfilesWith switches the application first when it differs', async () => {
        document.body.innerHTML += '<select id="applicationSelect"><option value="APP"></option><option value="OTHER"></option></select>';
        app.selectedApplication = 'APP';
        app.initLogfilesState = vi.fn();
        app.switchView = vi.fn();
        app.selectApplication = vi.fn();
        app.autoLoadLogs = vi.fn().mockResolvedValue(undefined);
        app.clearLogFilters = vi.fn();
        app.sendLogFilters = vi.fn();

        await app.openLogfilesWith({ applicationName: 'OTHER', requestId: 'x' });

        expect(app.selectApplication).toHaveBeenCalledWith('OTHER');
        expect(document.getElementById('applicationSelect').value).toBe('OTHER');
    });
});
