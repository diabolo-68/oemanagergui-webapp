/**
 * Unit tests for js/agentService.js — REST API wrapper.
 *
 * `fetch` is mocked globally per-test; we assert URL, method, headers,
 * body, success parsing, and error mapping (incl. 405 CORS hint).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { AgentService } = require('../js/agentService.js');

const APP = 'PASOE_DEVSET';
const BASE = 'https://server.example.com';

function makeOkResponse(body) {
    return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
}

function makeErrResponse(status, text = 'err', statusText = 'Bad') {
    return {
        ok: false,
        status,
        statusText,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => text
    };
}

let svc;
beforeEach(() => {
    svc = new AgentService();
    svc.setConfig(BASE + '/', 'admin', 'secret');
});

describe('config helpers', () => {
    it('strips trailing slash from baseUrl', () => {
        svc.setConfig('https://x/', 'u', 'p');
        expect(svc.config.baseUrl).toBe('https://x');
    });

    it('builds API URL with /oemanager prefix', () => {
        expect(svc.apiUrl('/applications')).toBe(`${BASE}/oemanager/applications`);
    });

    it('builds Basic Auth header from credentials', () => {
        const h = svc.getHeaders();
        expect(h.Accept).toBe('*/*');
        expect(h.Authorization).toBe('Basic ' + btoa('admin:secret'));
    });

    it('getHeadersWithBody adds Content-Type', () => {
        const h = svc.getHeadersWithBody('application/vnd.progress+json');
        expect(h['Content-Type']).toBe('application/vnd.progress+json');
        expect(h.Authorization).toMatch(/^Basic /);
    });

    it('handleError appends CORS hint for 405', () => {
        expect(() => svc.handleError({ status: 405 }, 'no', 'Op'))
            .toThrow(/Method Not Allowed.*CORS/);
    });

    it('handleError throws generic error otherwise', () => {
        expect(() => svc.handleError({ status: 500 }, 'boom', 'Op'))
            .toThrow(/Op: 500 boom/);
    });
});

describe('fetchApplications', () => {
    it('maps result.Application to {name,version,description}', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({
            result: { Application: [{ name: 'A', version: '1', description: 'd' }] }
        }));
        const apps = await svc.fetchApplications();
        expect(apps).toEqual([{ name: 'A', version: '1', description: 'd' }]);

        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${BASE}/oemanager/applications`);
        expect(opts.method).toBe('GET');
        expect(opts.headers.Authorization).toBe('Basic ' + btoa('admin:secret'));
    });

    it('returns [] on empty/missing payload', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        expect(await svc.fetchApplications()).toEqual([]);
    });

    it('throws on non-ok response', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(500, '', 'Boom'));
        await expect(svc.fetchApplications()).rejects.toThrow(/Failed to fetch applications: 500/);
    });
});

describe('fetchAgents', () => {
    it('extracts result.agents', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { agents: [{ agentId: '1' }] } }));
        const out = await svc.fetchAgents(APP);
        expect(out).toEqual([{ agentId: '1' }]);
        expect(globalThis.fetch.mock.calls[0][0])
            .toBe(`${BASE}/oemanager/applications/${APP}/agents`);
    });

    it('falls back to data.agents', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ agents: [{ x: 1 }] }));
        expect(await svc.fetchAgents(APP)).toEqual([{ x: 1 }]);
    });

    it('falls back to bare array', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse([{ a: 1 }]));
        expect(await svc.fetchAgents(APP)).toEqual([{ a: 1 }]);
    });

    it('returns [] on unknown shape', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ foo: 'bar' }));
        expect(await svc.fetchAgents(APP)).toEqual([]);
    });
});

describe('fetchSessions', () => {
    it('extracts result.AgentSession', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { AgentSession: [{ SessionId: 1 }] } }));
        expect(await svc.fetchSessions(APP, 'A1'))
            .toEqual([{ SessionId: 1 }]);
        expect(globalThis.fetch.mock.calls[0][0])
            .toBe(`${BASE}/oemanager/applications/${APP}/agents/A1/sessions`);
    });

    it('falls back to result.sessions', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { sessions: [{ x: 1 }] } }));
        expect(await svc.fetchSessions(APP, 'A1')).toEqual([{ x: 1 }]);
    });

    it('returns [] on unknown shape', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        expect(await svc.fetchSessions(APP, 'A1')).toEqual([]);
    });
});

describe('fetchRequests / fetchMetrics', () => {
    it('fetchRequests extracts result.Request', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { Request: [{ requestID: 'r1' }] } }));
        expect(await svc.fetchRequests(APP)).toEqual([{ requestID: 'r1' }]);
    });

    it('fetchRequests returns [] when missing', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        expect(await svc.fetchRequests(APP)).toEqual([]);
    });

    it('fetchMetrics returns result object', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { requests: 12 } }));
        expect(await svc.fetchMetrics(APP)).toEqual({ requests: 12 });
    });

    it('fetchMetrics returns {} when result missing', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        expect(await svc.fetchMetrics(APP)).toEqual({});
    });
});

describe('per-agent fetch endpoints', () => {
    it('fetchAgentMetrics returns the full body', async () => {
        const body = { result: { AgentStatHist: [{ ActiveThreads: 1 }] } };
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse(body));
        expect(await svc.fetchAgentMetrics(APP, 'A1')).toEqual(body);
        expect(globalThis.fetch.mock.calls[0][0])
            .toBe(`${BASE}/oemanager/applications/${APP}/agents/A1/metrics`);
    });

    it('fetchAgentConnections extracts result.AgentConnection', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { AgentConnection: [{ ConnectionId: 1 }] } }));
        expect(await svc.fetchAgentConnections(APP, 'A1')).toEqual([{ ConnectionId: 1 }]);
    });

    it('fetchAgentRequests extracts result.AgentRequest', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { AgentRequest: [{ requestID: 'x' }] } }));
        expect(await svc.fetchAgentRequests(APP, 'A1')).toEqual([{ requestID: 'x' }]);
    });

    it('fetchAgentThreads extracts result.AgentThread', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { AgentThread: [{ ThreadId: 4 }] } }));
        expect(await svc.fetchAgentThreads(APP, 'A1')).toEqual([{ ThreadId: 4 }]);
    });

    it('fetchAgentProperties returns result or full body', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { foo: 1 } }));
        expect(await svc.fetchAgentProperties(APP)).toEqual({ foo: 1 });
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ bar: 2 }));
        expect(await svc.fetchAgentProperties(APP)).toEqual({ bar: 2 });
    });
});

describe('mutation endpoints', () => {
    it('updateAgentProperties PUTs JSON with progress content-type', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        await svc.updateAgentProperties(APP, { x: 1 });
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${BASE}/oemanager/applications/${APP}/agents/properties`);
        expect(opts.method).toBe('PUT');
        expect(opts.headers['Content-Type']).toBe('application/vnd.progress+json');
        expect(opts.body).toBe(JSON.stringify({ x: 1 }));
    });

    it('updateAgentProperties throws on non-ok', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(500, 'nope'));
        await expect(svc.updateAgentProperties(APP, {})).rejects.toThrow(/Failed to update agent properties: 500 nope/);
    });

    it('addAgent POSTs and returns parsed body', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ added: true }));
        const out = await svc.addAgent(APP);
        expect(out).toEqual({ added: true });
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${BASE}/oemanager/applications/${APP}/addAgent`);
        expect(opts.method).toBe('POST');
    });

    it('addAgent throws with body text on non-ok', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(500, 'oops'));
        await expect(svc.addAgent(APP)).rejects.toThrow(/Failed to add agent: 500 oops/);
    });

    it('trimAgent DELETEs with wait params and surfaces 405 CORS hint', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        await svc.trimAgent(APP, 'A1', 1000, 500);
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${BASE}/oemanager/applications/${APP}/agents/A1?waitToFinish=1000&waitAfterStop=500`);
        expect(opts.method).toBe('DELETE');

        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(405, ''));
        await expect(svc.trimAgent(APP, 'A1')).rejects.toThrow(/CORS/);
    });

    it('cancelRequest URL-encodes ids and silently succeeds on failure', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        await svc.cancelRequest(APP, 'ROOT:w:0001', 'sid 1');
        const url = globalThis.fetch.mock.calls[0][0];
        expect(url).toContain('requestID=ROOT%3Aw%3A0001');
        expect(url).toContain('sessionID=sid%201');

        // Failure is swallowed (no throw).
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(500, 'gone'));
        await expect(svc.cancelRequest(APP, 'r', 's')).resolves.toBeUndefined();
    });

    it('terminateSession DELETEs with terminateOpt=2', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        await svc.terminateSession(APP, 'A1', 'S1');
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${BASE}/oemanager/applications/${APP}/agents/A1/sessions/S1?terminateOpt=2`);
        expect(opts.method).toBe('DELETE');
    });

    it('enableABLObjects PUTs {enable:"true"}', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        await svc.enableABLObjects(APP, 'A1');
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${BASE}/oemanager/applications/${APP}/agents/A1/ABLObjects/status`);
        expect(opts.method).toBe('PUT');
        expect(opts.body).toBe(JSON.stringify({ enable: 'true' }));
    });

    it('disableABLObjects PUTs {enable:"false"}', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        await svc.disableABLObjects(APP, 'A1');
        expect(globalThis.fetch.mock.calls[0][1].body).toBe(JSON.stringify({ enable: 'false' }));
    });

    it('getABLObjectsReport returns raw text', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse('REPORT-BODY'));
        expect(await svc.getABLObjectsReport(APP, 'A1')).toBe('REPORT-BODY');
    });

    it('getABLObjectsReport throws on non-ok', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(500, 'no'));
        await expect(svc.getABLObjectsReport(APP, 'A1')).rejects.toThrow(/Failed to get ABL Objects report: 500 no/);
    });

    it('resetAgentStatistics DELETEs agentStatData', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        await svc.resetAgentStatistics(APP, 'A1');
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${BASE}/oemanager/applications/${APP}/agents/A1/agentStatData`);
        expect(opts.method).toBe('DELETE');
    });

    it('fetchAgentsWithSessions extracts result.agents or array', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ result: { agents: [{ a: 1 }] } }));
        expect(await svc.fetchAgentsWithSessions(APP)).toEqual([{ a: 1 }]);

        globalThis.fetch.mockResolvedValueOnce(makeOkResponse([{ b: 2 }]));
        expect(await svc.fetchAgentsWithSessions(APP)).toEqual([{ b: 2 }]);

        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({}));
        expect(await svc.fetchAgentsWithSessions(APP)).toEqual([]);
    });
});

describe('file reader API', () => {
    beforeEach(() => {
        // jsdom's default location is http://localhost:3000/
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: new URL('http://localhost:8080/oemanagergui/index.html')
        });
    });

    it('fileApiUrl strips trailing index.html and joins endpoint', () => {
        const u = svc.fileApiUrl('/api/read-file?info=true');
        expect(u).toBe('http://localhost:8080/oemanagergui/api/read-file?info=true');
    });

    it('getFileApiHeaders adds X-Pasoe-Path only when override given', () => {
        expect(svc.getFileApiHeaders()).toEqual({ Accept: '*/*' });
        expect(svc.getFileApiHeaders('/x')).toEqual({ Accept: '*/*', 'X-Pasoe-Path': '/x' });
    });

    it('getPasoeInfo returns parsed JSON', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse({ catalinaBase: '/opt/pasoe' }));
        const out = await svc.getPasoeInfo();
        expect(out).toEqual({ catalinaBase: '/opt/pasoe' });
    });

    it('getPasoeInfo throws on non-ok', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(500, 'boom'));
        await expect(svc.getPasoeInfo()).rejects.toThrow(/getPasoeInfo failed: 500 boom/);
    });

    it('readServerFile extracts headers and body', async () => {
        const headers = new Map([['X-New-Offset', '128'], ['X-Total-Size', '1024']]);
        globalThis.fetch.mockResolvedValueOnce({
            ok: true, status: 200,
            headers: { get: k => headers.get(k) ?? null },
            text: async () => 'file-content'
        });
        const out = await svc.readServerFile('conf/openedge.properties', { offset: 64, pasoePathOverride: '/p' });
        expect(out).toEqual({ content: 'file-content', newOffset: 128, totalSize: 1024 });
        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('path=conf%2Fopenedge.properties');
        expect(url).toContain('offset=64');
        expect(opts.headers['X-Pasoe-Path']).toBe('/p');
    });

    it('readServerFile throws on non-ok with descriptive message', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(404, 'missing'));
        await expect(svc.readServerFile('x')).rejects.toThrow(/readServerFile failed for "x": 404 missing/);
    });

    it('listServerDirectory returns parsed JSON list', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeOkResponse(['a.log', 'b.log']));
        const out = await svc.listServerDirectory('logs');
        expect(out).toEqual(['a.log', 'b.log']);
        expect(globalThis.fetch.mock.calls[0][0]).toContain('list=logs');
    });

    it('listServerDirectory throws on non-ok', async () => {
        globalThis.fetch.mockResolvedValueOnce(makeErrResponse(403, 'denied'));
        await expect(svc.listServerDirectory('logs')).rejects.toThrow(/listServerDirectory failed for "logs": 403 denied/);
    });
});
