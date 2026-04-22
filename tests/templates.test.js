/**
 * Unit tests for js/templates.js — get / populate primitives.
 *
 * The other render helpers in templates.js depend on specific <template>
 * elements declared in index.html; we exercise them via the generic
 * get/populate API which is the most-used surface.
 */
import { describe, it, expect, beforeEach } from 'vitest';
const { Templates } = require('../js/templates.js');

beforeEach(() => {
    document.body.innerHTML = `
        <template id="rowTpl">
            <div class="row" data-id="">
                <span data-field="name"></span>
                <input data-field="value" type="text" />
            </div>
        </template>
    `;
});

describe('Templates.get', () => {
    it('returns a cloned DocumentFragment', () => {
        const frag = Templates.get('rowTpl');
        expect(frag).toBeInstanceOf(DocumentFragment);
        expect(frag.querySelector('.row')).not.toBeNull();
    });

    it('returns null and logs an error when template id is missing', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(Templates.get('missing')).toBeNull();
        expect(spy).toHaveBeenCalled();
    });
});

describe('Templates.populate', () => {
    it('sets textContent on non-form fields and value on form fields', () => {
        const el = Templates.populate('rowTpl', { name: 'Alice', value: 'hello' });
        expect(el).toBeInstanceOf(HTMLElement);
        expect(el.querySelector('[data-field="name"]').textContent).toBe('Alice');
        expect(el.querySelector('[data-field="value"]').value).toBe('hello');
    });

    it('returns null when template id is missing', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(Templates.populate('missing', {})).toBeNull();
    });
});
