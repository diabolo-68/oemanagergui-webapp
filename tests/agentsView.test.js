/**
 * Unit tests for js/agentsView.js — getStateClass.
 */
import { describe, it, expect } from 'vitest';
const { AgentsViewMixin: M } = require('../js/agentsView.js');

describe('AgentsViewMixin.getStateClass', () => {
    it('maps known states to CSS class names (case-insensitive)', () => {
        expect(M.getStateClass('AVAILABLE')).toBe('state-available');
        expect(M.getStateClass('available')).toBe('state-available');
        expect(M.getStateClass('Running')).toBe('state-running');
        expect(M.getStateClass('idle')).toBe('state-idle');
        expect(M.getStateClass('LOCKED')).toBe('state-locked');
    });

    it('returns empty string for unknown / falsy state', () => {
        expect(M.getStateClass('UNKNOWN')).toBe('');
        expect(M.getStateClass('')).toBe('');
        expect(M.getStateClass(null)).toBe('');
        expect(M.getStateClass(undefined)).toBe('');
    });
});
