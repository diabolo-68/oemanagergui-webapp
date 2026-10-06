/**
 * Unit tests for js/laneCanvasChart.js — lane packing, hit testing and drag/click handling.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { Utils } = require('../js/utils.js');
const { LaneCanvasChart } = require('../js/laneCanvasChart.js');

const GUTTER = 100;
const AXIS_H = 24;

function createChart(overrides = {}) {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 200 });
    const canvas = document.createElement('canvas');
    const context = new Proxy({}, { get: (target, prop) => (prop in target ? target[prop] : (target[prop] = vi.fn())) });
    canvas.getContext = () => context;
    const tooltip = document.createElement('div');
    container.appendChild(canvas);
    document.body.append(container, tooltip);

    const options = {
        container,
        canvas,
        tooltip,
        gutter: GUTTER,
        barHeight: 14,
        laneHeight: 16,
        getView: () => ({ xMin: 0, xMax: 900 }),
        setView: vi.fn(),
        colorOf: () => '#fff',
        tooltipHtml: (item) => item.id,
        onSelect: vi.fn(),
        ...overrides
    };
    return { chart: new LaneCanvasChart(options), options };
}

const ITEMS = [
    { id: 'a', startSec: 0, endSec: 100 },
    { id: 'b', startSec: 50, endSec: 150 }
];

beforeEach(() => {
    globalThis.Utils = Utils;
});

describe('LaneCanvasChart', () => {
    it('packs overlapping items into separate lanes and keeps them in start order', () => {
        const { chart } = createChart();

        chart.setEntries([ITEMS[1], ITEMS[0]]);

        expect(chart.entries.map(e => e.id)).toEqual(['a', 'b']);
        expect(chart.lanes).toEqual([0, 1]);
        expect(chart.laneCount).toBe(2);
    });

    it('hit tests bars by time and lane', () => {
        const { chart } = createChart();
        chart.setEntries(ITEMS);

        expect(chart.hitTest(GUTTER + 10, AXIS_H + 5)).toBe(0);
        expect(chart.hitTest(GUTTER + 120, AXIS_H + 16 + 5)).toBe(1);
        expect(chart.hitTest(GUTTER + 120, AXIS_H + 5)).toBe(-1);
        expect(chart.hitTest(GUTTER - 10, AXIS_H + 5)).toBe(-1);
        expect(chart.hitTest(GUTTER + 10, AXIS_H - 5)).toBe(-1);
    });

    it('does not draw while the container has no width', () => {
        const { chart, options } = createChart();
        Object.defineProperty(options.container, 'clientWidth', { value: 0, configurable: true });

        chart.setEntries(ITEMS);

        expect(chart.layout).toBeNull();
    });

    it('clear removes all items', () => {
        const { chart } = createChart();
        chart.setEntries(ITEMS);
        chart.clear();
        expect(chart.entries).toEqual([]);
        expect(chart.laneCount).toBe(1);
    });

    it('selects the item under the pointer on a click without dragging', () => {
        const { chart, options } = createChart();
        chart.setEntries(ITEMS);
        chart.drag = { startX: GUTTER + 10, currentX: GUTTER + 12 };

        document.dispatchEvent(new MouseEvent('mouseup', { clientY: AXIS_H + 5 }));

        expect(options.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
        expect(options.setView).not.toHaveBeenCalled();
        expect(chart.drag).toBeNull();
    });

    it('zooms to the dragged time range', () => {
        const { chart, options } = createChart();
        chart.setEntries(ITEMS);
        chart.drag = { startX: GUTTER, currentX: GUTTER + 100 };

        document.dispatchEvent(new MouseEvent('mouseup', { clientY: 0 }));

        expect(options.setView).toHaveBeenCalledTimes(1);
        const view = options.setView.mock.calls[0][0];
        expect(view.xMin).toBeCloseTo(0);
        expect(view.xMax).toBeCloseTo(100);
        expect(options.onSelect).not.toHaveBeenCalled();
    });

    it('cancels a stuck drag when the button was released outside the page', () => {
        const { chart } = createChart();
        chart.setEntries(ITEMS);
        chart.drag = { startX: 0, currentX: 0 };

        document.dispatchEvent(new MouseEvent('mousemove', { buttons: 0 }));

        expect(chart.drag).toBeNull();
    });

    it('positionTooltip flips to the left/top near the viewport edge', () => {
        const element = document.createElement('div');
        element.getBoundingClientRect = () => ({ width: 200, height: 100 });
        Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });

        LaneCanvasChart.positionTooltip(element, 450, 280);

        expect(element.style.left).toBe('238px');
        expect(element.style.top).toBe('168px');
    });
});
