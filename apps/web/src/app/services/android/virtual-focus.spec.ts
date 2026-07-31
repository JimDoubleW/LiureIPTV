import {
    clearVirtualFocus,
    getVirtualFocus,
    promoteVirtualFocus,
    setVirtualFocus,
    VIRTUAL_FOCUS_ATTRIBUTE,
} from './virtual-focus';

function byId(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`missing test fixture #${id}`);
    }
    return element;
}

describe('virtual focus', () => {
    beforeEach(() => {
        document.body.innerHTML =
            '<button id="button"></button><input id="field" /><input id="other" />';
    });

    afterEach(() => {
        clearVirtualFocus();
        document.body.innerHTML = '';
    });

    it('marks the field without letting the browser focus it', () => {
        // Real focus is what opens the Android keyboard, so it must not happen
        // just because the D-pad passed over the field.
        const field = byId('field');
        setVirtualFocus(field);

        expect(field.hasAttribute(VIRTUAL_FOCUS_ATTRIBUTE)).toBe(true);
        expect(document.activeElement).not.toBe(field);
        expect(getVirtualFocus()).toBe(field);
    });

    it('blurs whatever held real focus, so only one thing looks focused', () => {
        const button = byId('button');
        button.focus();

        setVirtualFocus(byId('field'));

        expect(document.activeElement).not.toBe(button);
    });

    it('moves the mark rather than accumulating it', () => {
        setVirtualFocus(byId('field'));
        setVirtualFocus(byId('other'));

        expect(byId('field').hasAttribute(VIRTUAL_FOCUS_ATTRIBUTE)).toBe(false);
        expect(document.querySelectorAll(`[${VIRTUAL_FOCUS_ATTRIBUTE}]`)).toHaveLength(
            1
        );
    });

    it('grants real focus on promotion, which is what raises the keyboard', () => {
        const field = byId('field');
        setVirtualFocus(field);

        expect(promoteVirtualFocus()).toBe(true);
        expect(document.activeElement).toBe(field);
        expect(field.hasAttribute(VIRTUAL_FOCUS_ATTRIBUTE)).toBe(false);
    });

    it('reports nothing to promote when no field is marked', () => {
        expect(promoteVirtualFocus()).toBe(false);
    });

    it('forgets a field detached by a route change', () => {
        const field = byId('field');
        setVirtualFocus(field);
        field.remove();

        expect(getVirtualFocus()).toBeNull();
    });
});
