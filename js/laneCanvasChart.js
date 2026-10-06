/**
 * OE Manager GUI - Lane Canvas Chart
 * Canvas 2D time chart that packs items into lanes (flame-chart style).
 * Shares its time window with the Lifecycles chart through getView/setView.
 * Items expose startSec/endSec in seconds since midnight.
 */
class LaneCanvasChart {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - Scrollable element that sizes the canvas
     * @param {HTMLCanvasElement} options.canvas
     * @param {HTMLElement} options.tooltip
     * @param {number} options.gutter - Left blank area (px) aligning the plot with the lifecycle labels
     * @param {number} options.barHeight
     * @param {number} options.laneHeight
     * @param {() => {xMin: number, xMax: number}} options.getView
     * @param {(view: {xMin: number, xMax: number}) => void} options.setView
     * @param {(item: Object) => string} options.colorOf
     * @param {(item: Object) => string|null} [options.outlineOf]
     * @param {(item: Object) => string} options.tooltipHtml - Must return escaped HTML
     * @param {(item: Object) => void} [options.onSelect]
     */
    constructor(options) {
        Object.assign(this, options);
        this.entries = [];
        this.lanes = [];
        this.laneCount = 1;
        this.hoverIdx = -1;
        this.drag = null;
        this.layout = null;
        this.boxWidth = 0;
        this.boxHeight = 0;
        this.attach();
    }

    static positionTooltip(element, clientX, clientY) {
        const box = element.getBoundingClientRect();
        let left = clientX + 12;
        let top = clientY + 12;
        if (left + box.width > window.innerWidth - 8) { left = clientX - box.width - 12; }
        if (top + box.height > window.innerHeight - 8) { top = clientY - box.height - 12; }
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
    }

    /** Replace the drawn items; they are lane-packed here, so input order does not matter. */
    setEntries(entries) {
        const packed = Utils.packLanes(entries);
        this.entries = packed.placed.map(p => p.item);
        this.lanes = packed.placed.map(p => p.lane);
        this.laneCount = packed.laneCount;
        this.hoverIdx = -1;
        this.tooltip.style.display = 'none';
        this.draw();
    }

    clear() {
        this.setEntries([]);
    }

    draw() {
        const canvas = this.canvas;
        const width = this.container.clientWidth;
        if (width === 0) { return; }

        const axisH = 24;
        const plotW = Math.max(width - this.gutter, 1);
        const height = Math.max(axisH + this.laneCount * this.laneHeight + 4, this.container.clientHeight);
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.layout = { width, height, plotW, axisH };

        const { xMin, xMax } = this.getView();
        const range = xMax - xMin;
        const timeToX = (sec) => this.gutter + (sec - xMin) / range * plotW;

        const style = getComputedStyle(document.body);
        const textColor = style.getPropertyValue('--text-primary').trim() || '#cccccc';
        const gridColor = style.getPropertyValue('--border-color').trim() || '#3e3e42';

        ctx.clearRect(0, 0, width, height);
        const interval = Utils.computeTickInterval(range, plotW);
        ctx.font = '10px Consolas, Monaco, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let t = Math.ceil(xMin / interval) * interval; t <= xMax; t += interval) {
            const x = timeToX(t);
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x, axisH);
            ctx.lineTo(x, height);
            ctx.stroke();
            ctx.fillStyle = textColor;
            ctx.fillText(Utils.formatTimeAxis(t, interval), x, axisH - 4);
        }
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, axisH);
        ctx.lineTo(width, axisH);
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.rect(this.gutter, axisH, plotW, height - axisH);
        ctx.clip();
        for (let i = 0; i < this.entries.length; i++) {
            const item = this.entries[i];
            const x1 = timeToX(item.startSec);
            const barW = Math.max(timeToX(item.endSec) - x1, 2);
            if (x1 + barW < this.gutter || x1 > width) { continue; }
            const y = axisH + this.lanes[i] * this.laneHeight;

            ctx.fillStyle = this.colorOf(item);
            ctx.fillRect(x1, y, barW, this.barHeight);
            const outline = this.outlineOf?.(item);
            if (outline) {
                ctx.strokeStyle = outline;
                ctx.lineWidth = 2;
                ctx.strokeRect(x1 + 1, y + 1, Math.max(barW - 2, 1), this.barHeight - 2);
            }
            if (i === this.hoverIdx) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x1 - 0.5, y - 0.5, barW + 1, this.barHeight + 1);
            }
        }
        ctx.restore();

        if (this.drag) {
            const x1 = Math.max(this.gutter, Math.min(this.drag.startX, this.drag.currentX));
            const x2 = Math.min(width, Math.max(this.drag.startX, this.drag.currentX));
            ctx.fillStyle = 'rgba(55, 148, 255, 0.15)';
            ctx.fillRect(x1, axisH, x2 - x1, height - axisH);
            ctx.strokeStyle = 'rgba(55, 148, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x1, axisH, x2 - x1, height - axisH);
        }
    }

    hitTest(px, py) {
        if (!this.layout || py < this.layout.axisH || px < this.gutter) { return -1; }
        const { xMin, xMax } = this.getView();
        const range = xMax - xMin;
        for (let i = 0; i < this.entries.length; i++) {
            const item = this.entries[i];
            const x1 = this.gutter + (item.startSec - xMin) / range * this.layout.plotW;
            const x2 = this.gutter + (item.endSec - xMin) / range * this.layout.plotW;
            const y = this.layout.axisH + this.lanes[i] * this.laneHeight;
            if (px >= x1 && px <= x1 + Math.max(x2 - x1, 2) && py >= y && py <= y + this.barHeight) {
                return i;
            }
        }
        return -1;
    }

    /** Convert a canvas x coordinate to a ratio (0..1) of the plot width. */
    plotRatio(x) {
        return Math.min(1, Math.max(0, (x - this.gutter) / this.layout.plotW));
    }

    endDrag() {
        this.drag = null;
        this.draw();
    }

    attach() {
        const canvas = this.canvas;

        canvas.addEventListener('mousemove', (e) => {
            if (this.drag || this.entries.length === 0) { return; }
            const idx = this.hitTest(e.offsetX, e.offsetY);
            if (idx !== this.hoverIdx) {
                this.hoverIdx = idx;
                this.draw();
            }
            if (idx < 0) {
                this.tooltip.style.display = 'none';
            } else {
                this.tooltip.innerHTML = this.tooltipHtml(this.entries[idx]);
                this.tooltip.style.display = '';
                LaneCanvasChart.positionTooltip(this.tooltip, e.clientX, e.clientY);
            }
            canvas.style.cursor = idx >= 0 ? 'pointer' : 'crosshair';
        });

        canvas.addEventListener('mouseleave', () => {
            this.tooltip.style.display = 'none';
            if (this.hoverIdx >= 0) {
                this.hoverIdx = -1;
                this.draw();
            }
        });

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || this.entries.length === 0) { return; }
            this.drag = { startX: e.offsetX, currentX: e.offsetX };
            this.tooltip.style.display = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.drag) { return; }
            if (e.buttons === 0) {
                // Button released outside the page: mouseup never arrived
                this.endDrag();
                return;
            }
            this.drag.currentX = e.clientX - canvas.getBoundingClientRect().left;
            this.draw();
        });

        document.addEventListener('mouseup', (e) => {
            if (!this.drag) { return; }
            const { startX, currentX } = this.drag;
            this.drag = null;

            if (Math.abs(currentX - startX) < 5) {
                const idx = this.hitTest(startX, e.clientY - canvas.getBoundingClientRect().top);
                if (idx >= 0) { this.onSelect?.(this.entries[idx]); }
                this.draw();
                return;
            }

            const { xMin, xMax } = this.getView();
            const range = xMax - xMin;
            const a = xMin + this.plotRatio(Math.min(startX, currentX)) * range;
            const b = xMin + this.plotRatio(Math.max(startX, currentX)) * range;
            if (b - a >= 1) {
                this.setView({ xMin: a, xMax: b });
            } else {
                this.draw();
            }
        });

        // Plain wheel scrolls the container; Ctrl+wheel zooms the shared time axis
        canvas.addEventListener('wheel', (e) => {
            if (!e.ctrlKey || !this.layout) { return; }
            e.preventDefault();
            const { xMin, xMax } = this.getView();
            this.setView(Utils.zoomRange(xMin, xMax, this.plotRatio(e.offsetX), e.deltaY > 0));
        }, { passive: false });

        // Redraw only on real size changes to avoid scrollbar-driven feedback loops
        new ResizeObserver(() => {
            const w = this.container.clientWidth;
            const h = this.container.clientHeight;
            if (w === this.boxWidth && h === this.boxHeight) { return; }
            this.boxWidth = w;
            this.boxHeight = h;
            this.draw();
        }).observe(this.container);
    }
}

// CommonJS export for unit tests (no-op in the browser script-tag context).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LaneCanvasChart };
}
