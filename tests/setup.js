/**
 * Vitest global setup for oemanagergui-webapp.
 *
 * Provides browser-globals stubs that the production code expects when
 * loaded via <script> tags. jsdom already supplies window/document/btoa.
 */
import { afterEach, beforeEach, vi } from 'vitest';

// Default no-op Chart constructor so chart-views can be loaded under jsdom.
class FakeChart {
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.data = config?.data ?? { datasets: [] };
        this.options = config?.options ?? {};
        this.destroyed = false;
    }
    update() {}
    destroy() { this.destroyed = true; }
}

beforeEach(() => {
    // fetch — replaced per-test as needed
    globalThis.fetch = vi.fn();

    // Chart.js global
    globalThis.Chart = FakeChart;

    // localStorage is provided by jsdom; clear between tests
    try { window.localStorage.clear(); } catch { /* noop */ }

    // confirm/alert defaults
    globalThis.confirm = vi.fn(() => true);
    globalThis.alert = vi.fn();

    // navigator.clipboard
    if (!globalThis.navigator.clipboard) {
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) }
        });
    }

    // ResizeObserver (used by some chart layout code)
    if (!globalThis.ResizeObserver) {
        globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.head.innerHTML = '';
});
