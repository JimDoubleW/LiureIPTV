import { ensureFocusable, isTextEntry } from './spatial-candidates';

function element(html: string): HTMLElement {
    document.body.innerHTML = html;
    const first = document.body.firstElementChild;
    if (!(first instanceof HTMLElement)) {
        throw new Error('fixture produced no element');
    }
    return first;
}

describe('spatial candidates', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('isTextEntry', () => {
        // Focusing text entry opens the Android IME, which halves the viewport
        // and swallows the remote's key events — the remote goes dead. These
        // must never be arrow-key destinations.
        it.each([
            ['<input type="text" />'],
            ['<input type="search" />'],
            ['<input />'],
            ['<textarea></textarea>'],
            ['<div contenteditable="true"></div>'],
        ])('treats %s as text entry', (html) => {
            expect(isTextEntry(element(html))).toBe(true);
        });

        it.each([
            ['<input type="checkbox" />'],
            ['<input type="radio" />'],
            ['<input type="button" />'],
            ['<input type="submit" />'],
            ['<button></button>'],
            ['<div></div>'],
        ])('treats %s as reachable', (html) => {
            expect(isTextEntry(element(html))).toBe(false);
        });
    });

    describe('ensureFocusable', () => {
        it('makes a clickable div focusable', () => {
            // focus() is a no-op on an element with no tabindex, so clickable
            // divs — most of the channel and movie tiles — need one.
            const div = element('<div></div>');
            ensureFocusable(div);

            expect(div.getAttribute('tabindex')).toBe('-1');
        });

        it('leaves natively focusable elements alone', () => {
            const button = element('<button></button>');
            ensureFocusable(button);

            expect(button.hasAttribute('tabindex')).toBe(false);
        });

        it('does not clobber an author-provided tabindex', () => {
            const div = element('<div tabindex="0"></div>');
            ensureFocusable(div);

            expect(div.getAttribute('tabindex')).toBe('0');
        });
    });
});
