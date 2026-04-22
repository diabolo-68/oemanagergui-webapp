/**
 * Unit tests for js/ablObjectsView.js — pure aggregation / parsing helpers.
 *
 * The mixin methods use `this.foo` for state, but the helpers tested here
 * are pure (no `this` access), so we invoke them directly on the mixin object.
 */
import { describe, it, expect } from 'vitest';
const { AblObjectsViewMixin: M } = require('../js/ablObjectsView.js');

describe('countAblObjects', () => {
    it('returns 0 for an empty/missing report', () => {
        expect(M.countAblObjects(null)).toBe(0);
        expect(M.countAblObjects({})).toBe(0);
        expect(M.countAblObjects({ result: { ABLOutput: { ABLObjects: [] } } })).toBe(0);
    });

    it('sums Objects across sessions', () => {
        const report = {
            result: {
                ABLOutput: {
                    ABLObjects: [
                        { Objects: [1, 2, 3] },
                        { Objects: [4, 5] },
                        { Objects: [] },
                        { /* no Objects */ }
                    ]
                }
            }
        };
        expect(M.countAblObjects(report)).toBe(5);
    });
});

describe('parseAccessLog', () => {
    it('parses a tomcat-style access log line', () => {
        const line = '192.168.1.1 - tomcat [27/Jan/2026:18:13:36.879 +0100] "GET /web/Menu HTTP/1.1" 200 - ROOT:w:0000004c 9';
        const out = M.parseAccessLog(line);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            ip: '192.168.1.1',
            user: 'tomcat',
            datestamp: '27/Jan/2026:18:13:36.879 +0100',
            query: 'GET /web/Menu HTTP/1.1',
            status: '200',
            queryid: 'ROOT:w:0000004c',
            resptime: '9'
        });
    });

    it('skips blank lines and unmatched lines', () => {
        expect(M.parseAccessLog('\n\nnot a log line\n')).toEqual([]);
    });
});

describe('aggregateBySource', () => {
    const data = [
        { source: 'A.cls', cRqstIdOrig: 'r1', sessionId: 's1', objectCount: 4 },
        { source: 'A.cls', cRqstIdOrig: 'r2', sessionId: 's1', objectCount: 6 },
        { source: 'B.cls', cRqstIdOrig: 'r1', sessionId: 's2', objectCount: 2 },
    ];

    it('groups by source with totals, distinct requests, and avg', () => {
        const out = M.aggregateBySource(data);
        expect(out).toHaveLength(2);
        const a = out.find(r => r.source === 'A.cls');
        expect(a).toEqual({ source: 'A.cls', totalObjects: 10, distinctRequests: 2, avgPerRequest: 5 });
        const b = out.find(r => r.source === 'B.cls');
        expect(b).toEqual({ source: 'B.cls', totalObjects: 2, distinctRequests: 1, avgPerRequest: 2 });
    });

    it('orders results by totalObjects descending', () => {
        const out = M.aggregateBySource(data);
        expect(out[0].source).toBe('A.cls');
    });

    it('returns [] for empty input', () => {
        expect(M.aggregateBySource([])).toEqual([]);
    });
});

describe('aggregateByRequest', () => {
    it('groups by request id, keeping first non-empty query and counting sources', () => {
        const out = M.aggregateByRequest([
            { cRqstIdOrig: 'r1', query: '',           source: 'A', objectCount: 1 },
            { cRqstIdOrig: 'r1', query: 'GET /x',     source: 'B', objectCount: 2 },
            { cRqstIdOrig: 'r2', query: 'POST /y',    source: 'A', objectCount: 5 },
        ]);
        const r1 = out.find(r => r.cRqstIdOrig === 'r1');
        expect(r1).toEqual({ cRqstIdOrig: 'r1', query: 'GET /x', totalObjects: 3, distinctSources: 2 });
        const r2 = out.find(r => r.cRqstIdOrig === 'r2');
        expect(r2.distinctSources).toBe(1);
        expect(out[0].cRqstIdOrig).toBe('r2'); // sorted by totalObjects desc
    });
});

describe('aggregateBySession', () => {
    it('groups by session, counting distinct requests and sources', () => {
        const out = M.aggregateBySession([
            { sessionId: 's1', cRqstIdOrig: 'r1', source: 'A', objectCount: 3 },
            { sessionId: 's1', cRqstIdOrig: 'r2', source: 'A', objectCount: 4 },
            { sessionId: 's2', cRqstIdOrig: 'r3', source: 'B', objectCount: 1 },
        ]);
        const s1 = out.find(r => r.sessionId === 's1');
        expect(s1).toEqual({ sessionId: 's1', totalObjects: 7, distinctRequests: 2, distinctSources: 1 });
        expect(out[0].sessionId).toBe('s1'); // 7 > 1
    });
});

describe('sortAblData', () => {
    const data = [
        { source: 'B', totalObjects: 5 },
        { source: 'A', totalObjects: 10 },
        { source: 'C', totalObjects: 3 },
    ];

    it('returns the input unchanged when column or direction is empty', () => {
        expect(M.sortAblData(data, '', 'asc')).toBe(data);
        expect(M.sortAblData(data, 'source', '')).toBe(data);
    });

    it('sorts numerically asc/desc', () => {
        const asc = M.sortAblData(data, 'totalObjects', 'asc').map(r => r.totalObjects);
        const desc = M.sortAblData(data, 'totalObjects', 'desc').map(r => r.totalObjects);
        expect(asc).toEqual([3, 5, 10]);
        expect(desc).toEqual([10, 5, 3]);
    });

    it('sorts strings using localeCompare', () => {
        const asc = M.sortAblData(data, 'source', 'asc').map(r => r.source);
        expect(asc).toEqual(['A', 'B', 'C']);
    });

    it('does not mutate the input array', () => {
        const original = [...data];
        M.sortAblData(data, 'totalObjects', 'desc');
        expect(data).toEqual(original);
    });
});
