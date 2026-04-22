/**
 * Unit tests for js/app.js — pure config / URL helpers on OeManagerApp.prototype.
 *
 * The constructor of OeManagerApp wires up DOM listeners and starts timers,
 * so we invoke its methods directly on the prototype with hand-crafted
 * `this` contexts to keep the tests pure.
 */
import { describe, it, expect, beforeEach } from 'vitest';
const { OeManagerApp } = require('../js/app.js');

describe('OeManagerApp.prototype.loadStoredConfig', () => {
    beforeEach(() => window.localStorage.clear());

    it('returns defaults when no stored config exists', () => {
        const cfg = OeManagerApp.prototype.loadStoredConfig.call({});
        expect(cfg).toEqual({
            username: '',
            password: '',
            waitToFinish: 120000,
            waitAfterStop: 60000,
            agentsRefreshSec: 10,
            requestsRefreshSec: 5,
            chartsRefreshSec: 10,
            pasoeStatsRefreshSec: 30,
            logRefreshSec: 5,
            pasoePathOverride: ''
        });
    });

    it('hydrates fields from localStorage but never restores password', () => {
        window.localStorage.setItem('oemanager.config', JSON.stringify({
            username: 'admin',
            password: 'should-be-ignored',
            waitToFinish: 1000,
            agentsRefreshSec: 20,
            pasoePathOverride: '/srv/pasoe'
        }));
        const cfg = OeManagerApp.prototype.loadStoredConfig.call({});
        expect(cfg.username).toBe('admin');
        expect(cfg.password).toBe('');
        expect(cfg.waitToFinish).toBe(1000);
        expect(cfg.agentsRefreshSec).toBe(20);
        expect(cfg.pasoePathOverride).toBe('/srv/pasoe');
        // Defaults still applied for missing fields:
        expect(cfg.waitAfterStop).toBe(60000);
    });

    it('returns defaults when JSON is malformed', () => {
        window.localStorage.setItem('oemanager.config', '{not-json');
        const cfg = OeManagerApp.prototype.loadStoredConfig.call({});
        expect(cfg.username).toBe('');
        expect(cfg.waitToFinish).toBe(120000);
    });
});

describe('OeManagerApp.prototype.saveConfig', () => {
    beforeEach(() => window.localStorage.clear());

    it('serializes config to localStorage WITHOUT the password field', () => {
        const ctx = {
            config: {
                username: 'admin',
                password: 'secret-do-not-store',
                waitToFinish: 100,
                waitAfterStop: 200,
                pasoePathOverride: '/p'
            },
            refreshIntervals: {
                agents: 1, requests: 2, charts: 3, pasoeStats: 4, logs: 5
            }
        };
        OeManagerApp.prototype.saveConfig.call(ctx);
        const stored = JSON.parse(window.localStorage.getItem('oemanager.config'));
        expect(stored).toEqual({
            username: 'admin',
            waitToFinish: 100,
            waitAfterStop: 200,
            agentsRefreshSec: 1,
            requestsRefreshSec: 2,
            chartsRefreshSec: 3,
            pasoeStatsRefreshSec: 4,
            logRefreshSec: 5,
            pasoePathOverride: '/p'
        });
        expect(stored.password).toBeUndefined();
    });

    it('coerces missing pasoePathOverride to empty string', () => {
        const ctx = {
            config: { username: '', waitToFinish: 0, waitAfterStop: 0 },
            refreshIntervals: { agents: 0, requests: 0, charts: 0, pasoeStats: 0, logs: 0 }
        };
        OeManagerApp.prototype.saveConfig.call(ctx);
        const stored = JSON.parse(window.localStorage.getItem('oemanager.config'));
        expect(stored.pasoePathOverride).toBe('');
    });
});

describe('OeManagerApp.prototype.getOemanagerBaseUrl', () => {
    function setLocation(href) {
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: new URL(href)
        });
    }

    it('strips /oemanagergui suffix', () => {
        setLocation('https://nr.ivnet.ch/oemanagergui/');
        expect(OeManagerApp.prototype.getOemanagerBaseUrl.call({})).toBe('https://nr.ivnet.ch');
    });

    it('strips /index.html and /oemanagergui suffix', () => {
        setLocation('https://nr.ivnet.ch/oemanagergui/index.html');
        expect(OeManagerApp.prototype.getOemanagerBaseUrl.call({})).toBe('https://nr.ivnet.ch');
    });

    it('preserves path prefix above webapp name', () => {
        setLocation('https://nr.ivnet.ch/proxy/oemanagergui');
        expect(OeManagerApp.prototype.getOemanagerBaseUrl.call({})).toBe('https://nr.ivnet.ch/proxy');
    });

    it('handles trailing slashes', () => {
        setLocation('https://x.example.com/oemanagergui///');
        expect(OeManagerApp.prototype.getOemanagerBaseUrl.call({})).toBe('https://x.example.com');
    });
});
