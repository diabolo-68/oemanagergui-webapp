/**
 * Unit tests for js/logFileService.js — pure parsing / filtering logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
const { LogFileService } = require('../js/logFileService.js');

let svc;
beforeEach(() => { svc = new LogFileService(); });

describe('LogFileService.parseAgentLog', () => {
    it('parses a single agent log line into a structured entry', () => {
        const line = '2026-04-16T12:53:29.667+0200 012360 054540 1 AS-7 ROOT:w:0000abcd APPL hello world';
        const out = svc.parseAgentLog(line);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            source: 'agent',
            timestamp: '2026-04-16T12:53:29.667+0200',
            processId: '012360',
            sessionId: '054540',
            agentNumber: '1',
            agentSessionId: 'AS-7',
            appRequestId: 'ROOT:w:0000abcd',
            logEntryType: 'APPL',
            message: 'hello world',
            lineNumber: 1
        });
    });

    it('appends continuation lines to the previous entry message', () => {
        const content = [
            '2026-04-16T12:53:29.667+0200 012360 054540 1 AS-7 ?:?:? APPL first line',
            '   continued',
            '   more',
            '2026-04-16T12:53:30.000+0200 012360 054540 1 AS-7 ?:?:? APPL next',
        ].join('\n');
        const out = svc.parseAgentLog(content);
        expect(out).toHaveLength(2);
        expect(out[0].message).toBe('first line\n   continued\n   more');
        expect(out[1].message).toBe('next');
    });

    it('returns [] for empty input', () => {
        expect(svc.parseAgentLog('')).toEqual([]);
    });
});

describe('LogFileService.parseAccessLog', () => {
    it('parses an access log line into a structured entry', () => {
        const line = '192.168.18.38 - hulk1@de.ivnet.ch [2026-04-16T17:21:59.753+02:00] "GET /web/test HTTP/1.1" 200 1234 ROOT:w:0000e9c2 85';
        const out = svc.parseAccessLog(line);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            source: 'access',
            clientIp: '192.168.18.38',
            user: 'hulk1@de.ivnet.ch',
            method: 'GET',
            url: '/web/test',
            statusCode: 200,
            appRequestId: 'ROOT:w:0000e9c2',
            responseTime: 85,
            lineNumber: 1
        });
    });

    it('skips lines that do not match', () => {
        expect(svc.parseAccessLog('garbage')).toEqual([]);
    });
});

describe('LogFileService.mergeEntries', () => {
    it('merges and sorts by timestamp', () => {
        const a = [{ timestamp: '2026-04-16T12:00:00.000+0200', source: 'agent' }];
        const b = [{ timestamp: '2026-04-16T11:00:00.000+0200', source: 'access' }];
        const out = svc.mergeEntries(a, b);
        expect(out.map(e => e.source)).toEqual(['access', 'agent']);
    });
});

describe('LogFileService raw chunk windows', () => {
    it('sorts adjacent chunks and makes duplicate range retries idempotent', () => {
        let chunks = svc.mergeLogChunk([], {
            startOffset: 10,
            endOffset: 20,
            content: 'second\n'
        });
        chunks = svc.mergeLogChunk(chunks, {
            startOffset: 0,
            endOffset: 10,
            content: 'first\n'
        });
        chunks = svc.mergeLogChunk(chunks, {
            startOffset: 10,
            endOffset: 20,
            content: 'second\n'
        });

        expect(chunks).toHaveLength(2);
        expect(svc.joinLogChunks(chunks)).toBe('first\nsecond\n');
    });

    it('replaces overlapping chunks instead of duplicating content', () => {
        const chunks = svc.mergeLogChunk([
            { startOffset: 0, endOffset: 10, content: 'old\n' }
        ], {
            startOffset: 0,
            endOffset: 12,
            content: 'replacement\n'
        });

        expect(chunks).toEqual([
            { startOffset: 0, endOffset: 12, content: 'replacement\n' }
        ]);
    });

    it('retains the active edge when enforcing the chunk budget', () => {
        const chunks = [
            { startOffset: 0, endOffset: 10, content: 'a\n' },
            { startOffset: 10, endOffset: 20, content: 'b\n' },
            { startOffset: 20, endOffset: 30, content: 'c\n' }
        ];

        expect(svc.retainLogChunks(chunks, 2, 'older').map(c => c.startOffset))
            .toEqual([0, 10]);
        expect(svc.retainLogChunks(chunks, 2, 'newer').map(c => c.startOffset))
            .toEqual([10, 20]);
    });

    it('preserves multiline agent entries across adjacent chunk boundaries', () => {
        const chunks = [
            {
                startOffset: 0,
                endOffset: 100,
                content: '2026-04-16T12:53:29.667+0200 012360 054540 1 AS-7 ?:?:? APPL first\n'
            },
            {
                startOffset: 100,
                endOffset: 200,
                content: 'continued\n2026-04-16T12:53:30.000+0200 012360 054540 1 AS-7 ?:?:? APPL next\n'
            }
        ];

        const entries = svc.parseAgentLog(svc.joinLogChunks(chunks));

        expect(entries).toHaveLength(2);
        expect(entries[0].message).toBe('first\ncontinued');
    });
});

describe('LogFileService.extractShortRequestId', () => {
    it('returns the last colon-separated segment', () => {
        expect(svc.extractShortRequestId('ROOT:w:0000e9c2')).toBe('0000e9c2');
        expect(svc.extractShortRequestId('AppName:w:0000abcd')).toBe('0000abcd');
    });

    it('returns the original value if no colons', () => {
        expect(svc.extractShortRequestId('plain')).toBe('plain');
    });
});

describe('LogFileService.buildShortIdCorrelationIndex', () => {
    it('groups entries by short request id', () => {
        const entries = [
            { appRequestId: 'ROOT:w:111', source: 'access' },
            { appRequestId: 'AppX:w:111', source: 'agent' },
            { appRequestId: 'ROOT:w:222', source: 'access' },
            { appRequestId: '?:?:?',     source: 'agent' },
            { appRequestId: '-',          source: 'access' },
            { appRequestId: '',           source: 'agent' },
        ];
        const idx = svc.buildShortIdCorrelationIndex(entries);
        expect(idx.size).toBe(2);
        expect(idx.get('111')).toHaveLength(2);
        expect(idx.get('222')).toHaveLength(1);
    });
});

describe('LogFileService.filterEntries', () => {
    const entries = [
        { source: 'agent',  agentNumber: '1', processId: '111', logEntryType: 'APPL', appRequestId: 'X:w:abc', message: 'foo', timestamp: 't1' },
        { source: 'agent',  agentNumber: '2', processId: '222', logEntryType: 'TRC',  appRequestId: 'X:w:def', message: 'bar', timestamp: 't2' },
        { source: 'access', statusCode: 200, clientIp: '1.1.1.1', responseTime: 50, url: '/a', method: 'GET', user: '-', appRequestId: 'X:w:abc', timestamp: 't3' },
        { source: 'access', statusCode: 500, clientIp: '2.2.2.2', responseTime: 500, url: '/b', method: 'POST', user: '-', appRequestId: 'X:w:ghi', timestamp: 't4' },
    ];

    it('returns a copy when no filters', () => {
        const out = svc.filterEntries(entries, {});
        expect(out).toEqual(entries);
        expect(out).not.toBe(entries);
    });

    it('filters by source', () => {
        expect(svc.filterEntries(entries, { source: 'agent' })).toHaveLength(2);
        expect(svc.filterEntries(entries, { source: 'access' })).toHaveLength(2);
        expect(svc.filterEntries(entries, { source: 'all' })).toHaveLength(4);
    });

    it('filters agent entries by agentNumber/processId/logEntryType', () => {
        expect(svc.filterEntries(entries, { agentNumber: '1' })).toHaveLength(3);
        expect(svc.filterEntries(entries, { processId: '222' })).toHaveLength(3);
        expect(svc.filterEntries(entries, { logEntryType: 'APPL' })).toHaveLength(3);
    });

    it('filters access entries by statusCode/clientIp/minResponseTime', () => {
        expect(svc.filterEntries(entries, { statusCode: 500 })).toHaveLength(3);
        expect(svc.filterEntries(entries, { clientIp: '2.2.2.2' })).toHaveLength(3);
        expect(svc.filterEntries(entries, { minResponseTime: 100 })).toHaveLength(3);
    });

    it('filters by request id substring (case insensitive)', () => {
        expect(svc.filterEntries(entries, { requestId: 'abc' })).toHaveLength(2);
        expect(svc.filterEntries(entries, { requestId: 'ABC' })).toHaveLength(2);
    });

    it('filters by free-text searchText against searchable text', () => {
        expect(svc.filterEntries(entries, { searchText: 'foo' })).toHaveLength(1);
        expect(svc.filterEntries(entries, { searchText: '/b' })).toHaveLength(1);
    });

    it('filters by ABL session id (agent entries only, case insensitive)', () => {
        const withSessions = [
            { source: 'agent', agentSessionId: 'AS-7', appRequestId: 'a', timestamp: 't1' },
            { source: 'agent', agentSessionId: 'AS-70', appRequestId: 'b', timestamp: 't2' },
            { source: 'access', statusCode: 200, clientIp: '1.1.1.1', responseTime: 1, url: '/', method: 'GET', user: '-', appRequestId: 'c', timestamp: 't3' }
        ];
        const out = svc.filterEntries(withSessions, { agentSessionId: 'as-7' });
        expect(out).toHaveLength(1);
        expect(out[0].agentSessionId).toBe('AS-7');
    });
});

describe('LogFileService.timestampToSeconds', () => {
    it('parses ISO timestamps with milliseconds', () => {
        const s = svc.timestampToSeconds('2026-04-16T01:02:03.500+0200');
        expect(s).toBeCloseTo(1 * 3600 + 2 * 60 + 3 + 0.5);
    });

    it('parses ISO timestamps without milliseconds', () => {
        expect(svc.timestampToSeconds('2026-04-16T01:02:03+0200')).toBe(3723);
    });

    it('parses CLF timestamps', () => {
        expect(svc.timestampToSeconds('16/Apr/2026:10:20:30 +0200')).toBe(10 * 3600 + 20 * 60 + 30);
    });

    it('falls back to HH:MM:SS pattern', () => {
        expect(svc.timestampToSeconds('foo 04:05:06 bar')).toBe(4 * 3600 + 5 * 60 + 6);
    });

    it('returns null when nothing matches', () => {
        expect(svc.timestampToSeconds('no-time-here')).toBeNull();
    });
});

describe('LogFileService.getSearchableText', () => {
    it('builds a string for agent entries', () => {
        const t = svc.getSearchableText({
            source: 'agent', timestamp: 'ts', processId: 'p', sessionId: 's', agentNumber: 'a',
            agentSessionId: 'asid', appRequestId: 'rid', logEntryType: 'APPL', message: 'msg'
        });
        expect(t).toContain('msg');
        expect(t).toContain('APPL');
    });

    it('builds a string for access entries', () => {
        const t = svc.getSearchableText({
            source: 'access', timestamp: 'ts', clientIp: 'ip', user: 'u',
            method: 'GET', url: '/x', statusCode: 200, appRequestId: 'rid', responseTime: 1
        });
        expect(t).toContain('/x');
        expect(t).toContain('GET');
    });
});

describe('LogFileService.parseIniSections', () => {
    it('parses sections, comments, and key=value', () => {
        const out = svc.parseIniSections([
            '# header comment',
            '! also comment',
            'rootKey=rootVal',
            '[Section.A]',
            'key1=value1',
            'key2 = value2',
            '[Section.B]',
            'key3=value3'
        ].join('\n'));
        expect(out.get('')).toEqual({ rootKey: 'rootVal' });
        expect(out.get('Section.A')).toEqual({ key1: 'value1', key2: 'value2' });
        expect(out.get('Section.B')).toEqual({ key3: 'value3' });
    });

    it('handles continuation lines', () => {
        const out = svc.parseIniSections([
            '[S]',
            'k=part1 \\',
            'part2 \\',
            'part3'
        ].join('\n'));
        expect(out.get('S').k).toBe('part1 part2 part3');
    });
});

describe('LogFileService.parsePropertiesContent', () => {
    it('extracts per-app log file paths and inherits the default', () => {
        const content = [
            '[AppServer.SessMgr]',
            'agentLogFile=${catalina.base}/logs/{yyyy-MM-dd}.agent.log',
            '[AppServer.SessMgr.appA]',
            'agentLogFile=${catalina.base}/logs/appA-{yyyy-MM-dd}.log',
            '[AppServer.SessMgr.appB]',
            'someOther=value'
        ].join('\n');
        const out = svc.parsePropertiesContent(content, '/opt/pasoe');
        expect(out.get('appA')).toBe('/opt/pasoe/logs/appA-{yyyy-MM-dd}.log');
        expect(out.get('appB')).toBe('/opt/pasoe/logs/{yyyy-MM-dd}.agent.log');
    });
});

describe('LogFileService.resolveLogPath', () => {
    it('substitutes ${catalina.base} and normalizes slashes', () => {
        expect(svc.resolveLogPath('${catalina.base}\\logs\\foo.log', '/opt/pasoe'))
            .toBe('/opt/pasoe/logs/foo.log');
    });

    it('prepends pasoe base for relative paths', () => {
        expect(svc.resolveLogPath('logs/foo.log', '/opt/pasoe')).toBe('/opt/pasoe/logs/foo.log');
    });

    it('preserves absolute Unix paths', () => {
        expect(svc.resolveLogPath('/var/log/foo.log', '/opt/pasoe')).toBe('/var/log/foo.log');
    });

    it('preserves absolute Windows paths', () => {
        expect(svc.resolveLogPath('C:\\logs\\foo.log', '/opt/pasoe')).toBe('C:/logs/foo.log');
    });
});

describe('LogFileService.resolveAgentLogPath', () => {
    it('replaces date tokens', () => {
        expect(svc.resolveAgentLogPath('logs/{yyyy}-{MM}-{dd}.log', '2026-04-22'))
            .toBe('logs/2026-04-22.log');
        expect(svc.resolveAgentLogPath('logs/{yyyy-MM-dd}.log', '2026-04-22'))
            .toBe('logs/2026-04-22.log');
    });
});

describe('LogFileService.hasDateToken', () => {
    it('returns true when a date token is present', () => {
        expect(svc.hasDateToken('logs/{yyyy-MM-dd}.log')).toBe(true);
        expect(svc.hasDateToken('logs/{MM}.log')).toBe(true);
        expect(svc.hasDateToken('logs/{dd}.log')).toBe(true);
    });

    it('returns false when no date token', () => {
        expect(svc.hasDateToken('logs/agent.log')).toBe(false);
    });
});

describe('LogFileService.getLogDirectory', () => {
    it('returns the directory portion', () => {
        expect(svc.getLogDirectory('/opt/pasoe/logs/foo.log')).toBe('/opt/pasoe/logs');
        expect(svc.getLogDirectory('C:\\logs\\foo.log')).toBe('C:/logs');
    });

    it('returns "." when no slash', () => {
        expect(svc.getLogDirectory('foo.log')).toBe('.');
    });
});

describe('LogFileService.toRelativePath', () => {
    it('returns path relative to pasoe base', () => {
        expect(svc.toRelativePath('/opt/pasoe/logs/foo.log', '/opt/pasoe'))
            .toBe('logs/foo.log');
        expect(svc.toRelativePath('C:\\pasoe\\logs\\foo.log', 'C:\\pasoe'))
            .toBe('logs/foo.log');
    });

    it('returns the original path when not under base', () => {
        expect(svc.toRelativePath('/var/other/foo.log', '/opt/pasoe'))
            .toBe('/var/other/foo.log');
    });
});

describe('LogFileService lifecycles', () => {
    function agentEntry(time, pid, session, extra = {}) {
        return {
            source: 'agent',
            timestamp: `2026-04-16T${time}.000+0200`,
            processId: pid,
            agentNumber: '1',
            agentSessionId: session,
            appRequestId: '?:?:?',
            logEntryType: 'APPL',
            ...extra
        };
    }

    it('builds first/last seen ranges per PID and ABL session', () => {
        const out = svc.buildLifecycles([
            agentEntry('10:00:00', '200', 'AS-1'),
            agentEntry('10:05:00', '200', 'AS-1', { appRequestId: 'ROOT:w:1' }),
            agentEntry('10:10:00', '200', 'AS-2'),
            agentEntry('09:00:00', '100', 'AS-1')
        ]);

        expect(out.map(a => a.pid)).toEqual(['100', '200']);
        const agent = out[1];
        expect(agent.startSec).toBe(36000);
        expect(agent.endSec).toBe(36600);
        expect(agent.entryCount).toBe(3);
        expect(agent.sessions.map(s => s.sessionId)).toEqual(['AS-1', 'AS-2']);
        expect(agent.sessions[0]).toMatchObject({ startSec: 36000, endSec: 36300, entryCount: 2, requestCount: 1 });
    });

    it('ignores access entries, placeholder sessions and placeholder request ids', () => {
        const out = svc.buildLifecycles([
            { source: 'access', timestamp: '2026-04-16T10:00:00.000+0200' },
            agentEntry('10:00:00', '200', '-'),
            agentEntry('10:01:00', '200', 'AS-1', { appRequestId: '-' })
        ]);

        expect(out).toHaveLength(1);
        expect(out[0].sessions).toHaveLength(1);
        expect(out[0].sessions[0].requestCount).toBe(0);
    });

    it('counts ERROR-type lines as session errors', () => {
        const out = svc.buildLifecycles([
            agentEntry('10:00:00', '200', 'AS-1', { logEntryType: 'ERROR' }),
            agentEntry('10:00:01', '200', 'AS-1', { logEntryType: 'ERR' }),
            agentEntry('10:00:02', '200', 'AS-1')
        ]);
        expect(out[0].sessions[0].errorCount).toBe(2);
    });

    it('sorts PIDs numerically and sessions by their number', () => {
        const out = svc.buildLifecycles([
            agentEntry('10:00:00', '1000', 'AS-10'),
            agentEntry('10:00:00', '1000', 'AS-2'),
            agentEntry('10:00:00', '99', 'AS-1')
        ]);
        expect(out.map(a => a.pid)).toEqual(['99', '1000']);
        expect(out[1].sessions.map(s => s.sessionId)).toEqual(['AS-2', 'AS-10']);
    });

    it('accumulates incrementally across chunks like a single build', () => {
        const first = [agentEntry('10:00:00', '200', 'AS-1')];
        const second = [agentEntry('10:30:00', '200', 'AS-1'), agentEntry('10:31:00', '300', 'AS-1')];

        const acc = svc.createLifecycleAccumulator();
        svc.addLifecycleEntries(acc, first);
        svc.addLifecycleEntries(acc, second);

        expect(svc.snapshotLifecycles(acc)).toEqual(svc.buildLifecycles([...first, ...second]));
    });

    it('collects agent numbers for a PID', () => {
        const out = svc.buildLifecycles([
            agentEntry('10:00:00', '200', 'AS-1', { agentNumber: '2' }),
            agentEntry('10:00:01', '200', 'AS-1', { agentNumber: '1' })
        ]);
        expect(out[0].agentNumbers).toEqual(['1', '2']);
    });
});
