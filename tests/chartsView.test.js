/**
 * Unit tests for js/chartsView.js — getChartColors.
 */
import { describe, it, expect } from 'vitest';
const { ChartsViewMixin: M } = require('../js/chartsView.js');

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
