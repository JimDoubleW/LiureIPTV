import {
    collectCandidates,
    ensureFocusable,
    isNativelyActivatable,
    isNativelyFocusable,
    isPointerWidgetRoot,
    isTextEntry,
} from './spatial-candidates';

function withSize(el: HTMLElement, width = 40, height = 40): HTMLElement {
    el.getBoundingClientRect = () =>
        ({ width, height, left: 0, top: 0, right: width, bottom: height }) as DOMRect;
    return el;
}

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
            ['<input type="range" />'],
            ['<input type="button" />'],
            ['<input type="submit" />'],
            ['<button></button>'],
            ['<div></div>'],
        ])('treats %s as reachable', (html) => {
            expect(isTextEntry(element(html))).toBe(false);
        });
    });

    describe('isNativelyFocusable', () => {
        // Text entry was once left out of this selector, on the reasoning that
        // the IME makes those fields hostile. The effect was that no form in
        // the app could be filled from a remote — including the Xtream
        // credentials, without which the app does nothing at all.
        it.each([
            ['<input type="text" />'],
            ['<input type="password" />'],
            ['<input />'],
            ['<textarea></textarea>'],
            ['<div contenteditable="true"></div>'],
        ])('reaches %s', (html) => {
            expect(isNativelyFocusable(element(html))).toBe(true);
        });

        it('ignores hidden inputs', () => {
            expect(isNativelyFocusable(element('<input type="hidden" />'))).toBe(false);
        });
    });

    describe('isPointerWidgetRoot', () => {
        it('accepts the clickable card itself', () => {
            const card = element('<div style="cursor: pointer"></div>');

            expect(isPointerWidgetRoot(card)).toBe(true);
        });

        it('rejects the text inside a clickable card', () => {
            // `cursor` inherits, so the description paragraph also reports
            // pointer. Accepting it drew the focus ring around a line of text
            // inside the "Add playlist" cards instead of around the card.
            element(`
                <div style="cursor: pointer">
                    <h3 style="cursor: pointer">Xtream credentials</h3>
                    <p style="cursor: pointer" id="description">
                        Connect with host, username and password
                    </p>
                </div>
            `);
            const description = document.getElementById('description');
            if (!(description instanceof HTMLElement)) {
                throw new Error('fixture missing');
            }

            expect(isPointerWidgetRoot(description)).toBe(false);
        });

        it('rejects an element that is not clickable at all', () => {
            const plain = element('<div style="cursor: default"></div>');

            expect(isPointerWidgetRoot(plain)).toBe(false);
        });
    });

    describe('isNativelyActivatable', () => {
        it.each([['<button></button>'], ['<a href="#"></a>'], ['<select></select>']])(
            'lets the browser activate %s itself',
            (html) => {
                expect(isNativelyActivatable(element(html))).toBe(true);
            }
        );

        it.each([['<div></div>'], ['<li></li>'], ['<div role="button"></div>']])(
            'reports %s as needing a synthetic click',
            (html) => {
                // Enter does nothing on these, so the remote's OK button would
                // move focus around a UI it could never operate.
                expect(isNativelyActivatable(element(html))).toBe(false);
            }
        );
    });

    describe('collectCandidates', () => {
        // Reported by the user: every checkbox across Settings was completely
        // unreachable. mat-checkbox (and mat-radio-button, mat-slide-toggle —
        // the same Material pattern) renders its real, tabbable native
        // <input> at opacity: 0 and paints the visible mark on a sibling —
        // confirmed on the reference device. The outer <mat-checkbox> has no
        // tabindex and cursor: auto (not pointer), so only the transparent
        // input was ever a candidate at all, and it was being rejected by the
        // opacity check.
        it('reaches a native control whose real input is opacity: 0 (mat-checkbox)', () => {
            document.body.innerHTML = `
                <mat-checkbox style="cursor: auto">
                    <input type="checkbox" tabindex="0" style="opacity: 0" />
                </mat-checkbox>
            `;
            const input = withSize(
                document.querySelector('input') as HTMLElement
            );
            withSize(document.querySelector('mat-checkbox') as HTMLElement);

            const candidates = collectCandidates();

            expect(candidates.map((c) => c.target)).toContain(input);
        });

        it('still excludes a genuinely hidden control', () => {
            document.body.innerHTML = `
                <input type="checkbox" tabindex="0" style="opacity: 0; display: none" />
            `;
            withSize(document.querySelector('input') as HTMLElement);

            const candidates = collectCandidates();

            expect(candidates).toHaveLength(0);
        });

        it('still excludes a non-focusable div faded out with opacity', () => {
            // opacity leniency only applies to elements the browser already
            // focuses natively — an ordinary clickable div that has been
            // faded to invisible (a dismissed toast, a hidden overlay
            // remnant) must stay excluded.
            document.body.innerHTML = `
                <div style="cursor: pointer; opacity: 0"></div>
            `;
            withSize(document.querySelector('div') as HTMLElement);

            const candidates = collectCandidates();

            expect(candidates).toHaveLength(0);
        });

        it("does not also offer mat-checkbox's cursor:pointer wrapper div as a second, competing candidate", () => {
            // The real bug, one layer deeper than the opacity fix above: even
            // once the transparent <input> became reachable, its parent
            // div.mdc-checkbox (cursor: pointer, tabindex="-1" — Material's
            // own styling shell, exactly overlapping the input) still
            // qualified as its own candidate too. Document order lists a
            // parent before its children, so this wrapper was always found
            // first, and findBestCandidate keeps the first candidate on a
            // score tie — it always won over the input at the identical
            // spot. Clicking it did not toggle the checkbox: confirmed on
            // the reference device, where the second checkbox in every
            // section a user reached this way silently failed to check.
            document.body.innerHTML = `
                <mat-checkbox style="cursor: auto">
                    <div class="mdc-checkbox" tabindex="-1" style="cursor: pointer">
                        <input type="checkbox" tabindex="0" style="opacity: 0" />
                    </div>
                </mat-checkbox>
            `;
            const wrapper = withSize(
                document.querySelector('.mdc-checkbox') as HTMLElement
            );
            const input = withSize(document.querySelector('input') as HTMLElement);

            const candidates = collectCandidates().map((c) => c.target);

            expect(candidates).toContain(input);
            expect(candidates).not.toContain(wrapper);
        });

        it("still keeps a card's own Play button reachable alongside the card", () => {
            // The card is much larger than the button it contains — not the
            // same spot — so both stay legitimate, independent candidates.
            document.body.innerHTML = `
                <div id="card" style="cursor: pointer">
                    <button id="play">Play</button>
                </div>
            `;
            const card = document.getElementById('card') as HTMLElement;
            card.getBoundingClientRect = () =>
                ({ width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200 }) as DOMRect;
            const play = withSize(document.getElementById('play') as HTMLElement);

            const candidates = collectCandidates().map((c) => c.target);

            expect(candidates).toContain(card);
            expect(candidates).toContain(play);
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
