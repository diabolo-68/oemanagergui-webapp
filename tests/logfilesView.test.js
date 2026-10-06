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
