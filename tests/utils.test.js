/**
 * Unit tests for js/utils.js — Utils class.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { Utils } = require('../js/utils.js');

describe('Utils.parseIsoDate', () => {
    it('returns null for empty/falsy input', () => {
        expect(Utils.parseIsoDate('')).toBeNull();
        expect(Utils.parseIsoDate(null)).toBeNull();
        expect(Utils.parseIsoDate(undefined)).toBeNull();
    });

    it('normalizes non-standard "-00:00" suffix to UTC', () => {
        const d = Utils.parseIsoDate('2026-04-22T10:30:00.000-00:00');
        expect(d).toBeInstanceOf(Date);
        expect(d.getTime()).toBe(Date.UTC(2026, 3, 22, 10, 30, 0));
    });

    it('parses standard ISO with offset', () => {
        const d = Utils.parseIsoDate('2026-04-22T10:30:00+02:00');
        expect(d).toBeInstanceOf(Date);
        expect(d.getTime()).toBe(Date.UTC(2026, 3, 22, 8, 30, 0));
    });

    it('returns null for invalid input', () => {
        expect(Utils.parseIsoDate('not a date')).toBeNull();
    });
});

describe('Utils.formatIsoDate', () => {
    it('returns "-" for empty input', () => {
        expect(Utils.formatIsoDate('')).toBe('-');
        expect(Utils.formatIsoDate(null)).toBe('-');
    });

    it('extracts and formats components without timezone conversion', () => {
        // Server reports 22:43:23, must display the same wall-clock time.
        const out = Utils.formatIsoDate('2026-01-28T22:43:23.910-01:00');
        expect(out).toBe('1/28/2026, 22:43:23');
    });

    it('returns "-" for malformed strings', () => {
        expect(Utils.formatIsoDate('2026/01/28 22:43:23')).toBe('-');
    });
});

describe('Utils.formatTimestamp', () => {
    it('returns "-" for falsy input', () => {
        expect(Utils.formatTimestamp(null)).toBe('-');
    });

    it('returns a string for a valid ISO timestamp', () => {
        const out = Utils.formatTimestamp('2026-04-22T10:30:00+00:00');
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
    });
});

describe('Utils.calculateElapsed', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
    });

    it('returns "-" for falsy input', () => {
        expect(Utils.calculateElapsed(null)).toBe('-');
    });

    it('formats <60s as seconds', () => {
        expect(Utils.calculateElapsed('2026-04-22T11:59:30Z')).toBe('30s');
    });

    it('formats minutes branch', () => {
        expect(Utils.calculateElapsed('2026-04-22T11:55:00Z')).toBe('5m 0s');
    });

    it('formats hours branch', () => {
        expect(Utils.calculateElapsed('2026-04-22T10:30:00Z')).toBe('1h 30m');
    });
});

describe('Utils.formatBytes', () => {
    it('returns "0 B" for falsy/zero', () => {
        expect(Utils.formatBytes(0)).toBe('0 B');
        expect(Utils.formatBytes(null)).toBe('0 B');
    });

    it('formats KB/MB/GB', () => {
        expect(Utils.formatBytes(2048)).toBe('2 KB');
        expect(Utils.formatBytes(5 * 1024 * 1024)).toBe('5 MB');
        expect(Utils.formatBytes(3 * 1024 * 1024 * 1024)).toBe('3 GB');
    });
});

describe('Utils.formatDuration', () => {
    it('returns "0ms" for zero/null', () => {
        expect(Utils.formatDuration(0)).toBe('0ms');
        expect(Utils.formatDuration(null)).toBe('0ms');
    });

    it('formats sub-second as ms', () => {
        expect(Utils.formatDuration(450)).toBe('450ms');
    });

    it('formats sub-minute as seconds', () => {
        expect(Utils.formatDuration(2500)).toBe('2.5s');
    });

    it('formats >=60s as minutes/seconds', () => {
        expect(Utils.formatDuration(125000)).toBe('2m 5s');
    });
});

describe('Utils.truncate', () => {
    it('returns empty string for falsy', () => {
        expect(Utils.truncate(null, 5)).toBe('');
    });

    it('returns input unchanged when under limit', () => {
        expect(Utils.truncate('abc', 10)).toBe('abc');
    });

    it('truncates and appends ellipsis', () => {
        expect(Utils.truncate('abcdefghij', 5)).toBe('abcde...');
    });
});

describe('Utils time-axis helpers', () => {
    it('formatClockTime pads HH:MM:SS and handles null', () => {
        expect(Utils.formatClockTime(3723)).toBe('01:02:03');
        expect(Utils.formatClockTime(null)).toBe('??:??:??');
    });

    it('formatSpan renders hours, minutes and seconds', () => {
        expect(Utils.formatSpan(45)).toBe('45s');
        expect(Utils.formatSpan(125)).toBe('2m 5s');
        expect(Utils.formatSpan(3725)).toBe('1h 2m 5s');
        expect(Utils.formatSpan(-5)).toBe('0s');
    });

    it('computeTickInterval picks the first nice interval that fits', () => {
        // 600 px => 6 target ticks; 3600 s / 6 = 600 s
        expect(Utils.computeTickInterval(3600, 600)).toBe(600);
        expect(Utils.computeTickInterval(86400 * 10, 600)).toBe(86400);
    });

    it('formatTimeAxis shows seconds only below one-minute intervals', () => {
        expect(Utils.formatTimeAxis(3723, 30)).toBe('01:02:03');
        expect(Utils.formatTimeAxis(3723, 60)).toBe('01:02');
    });

    it('zoomRange narrows around the anchor and stays inside the day', () => {
        const zoomedIn = Utils.zoomRange(0, 1000, 0.5, false);
        expect(zoomedIn.xMax - zoomedIn.xMin).toBeCloseTo(1000 / 1.3);
        expect((zoomedIn.xMin + zoomedIn.xMax) / 2).toBeCloseTo(500);

        const clamped = Utils.zoomRange(0, 86400, 0.5, true);
        expect(clamped).toEqual({ xMin: 0, xMax: 86400 });
    });

    it('zoomRange never goes below 5 seconds', () => {
        const out = Utils.zoomRange(100, 106, 0.5, false);
        expect(out.xMax - out.xMin).toBeCloseTo(5);
    });

    it('packLanes reuses a lane once the previous item has ended', () => {
        const items = [
            { id: 'a', startSec: 0, endSec: 10 },
            { id: 'b', startSec: 5, endSec: 8 },
            { id: 'c', startSec: 11, endSec: 12 }
        ];
        const { placed, laneCount } = Utils.packLanes(items);
        const lanes = Object.fromEntries(placed.map(p => [p.item.id, p.lane]));
        expect(lanes).toEqual({ a: 0, b: 1, c: 0 });
        expect(laneCount).toBe(2);
    });

    it('packLanes returns one lane for empty input and does not mutate it', () => {
        expect(Utils.packLanes([])).toEqual({ placed: [], laneCount: 1 });
        const items = [{ startSec: 5, endSec: 6 }, { startSec: 1, endSec: 2 }];
        Utils.packLanes(items);
        expect(items[0].startSec).toBe(5);
    });
});

describe('Utils.escapeHtml', () => {
    it('escapes all five special characters', () => {
        expect(Utils.escapeHtml(`<a href="x" name='y'>&</a>`))
            .toBe('&lt;a href=&quot;x&quot; name=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    });

    it('returns empty string for falsy', () => {
        expect(Utils.escapeHtml(null)).toBe('');
    });

    it('coerces non-strings', () => {
        expect(Utils.escapeHtml(42)).toBe('42');
    });
});

describe('Utils.updateStatus / updateLastRefresh', () => {
    it('sets connection status text when element present', () => {
        document.body.innerHTML = '<span id="connectionStatus"></span>';
        Utils.updateStatus('Connected');
        expect(document.getElementById('connectionStatus').textContent).toBe('Connected');
    });

    it('is a no-op when status element is missing', () => {
        expect(() => Utils.updateStatus('x')).not.toThrow();
    });

    it('updates last-refresh element with a timestamp prefix', () => {
        document.body.innerHTML = '<span id="lastUpdate"></span>';
        Utils.updateLastRefresh();
        expect(document.getElementById('lastUpdate').textContent).toMatch(/^Last update: /);
    });
});

describe('Utils.showToast', () => {
    it('creates a toast container and toast element with the right class', () => {
        Utils.showToast('Hello', 'success');
        const container = document.querySelector('.toast-container');
        expect(container).not.toBeNull();
        const toast = container.querySelector('.toast.toast-success');
        expect(toast).not.toBeNull();
        expect(toast.textContent).toBe('Hello');
    });

    it('removes any pre-existing toasts when invoked', () => {
        Utils.showToast('First', 'info');
        Utils.showToast('Second', 'error');
        const toasts = document.querySelectorAll('.toast');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toBe('Second');
    });

    it('auto-removes the toast after 5 seconds', () => {
        vi.useFakeTimers();
        Utils.showToast('Bye', 'info');
        expect(document.querySelector('.toast')).not.toBeNull();
        vi.advanceTimersByTime(5000);
        expect(document.querySelector('.toast')).toBeNull();
        vi.useRealTimers();
    });
});
