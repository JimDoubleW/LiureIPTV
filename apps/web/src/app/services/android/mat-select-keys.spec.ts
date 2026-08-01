/**
 * Regression coverage for the "can't navigate the language dropdown" bug.
 *
 * `mat-select`'s open panel uses the ARIA 1.1 "activedescendant" combobox
 * pattern: real DOM focus stays on the trigger, and an Angular `(keydown)`
 * binding on that host moves `aria-activedescendant` in response to a genuine
 * keydown event. The native key layer consumes every D-pad press before the
 * WebView sees one, so that binding stopped firing — confirmed on the
 * reference device, where DOWN in the open language list left
 * `aria-activedescendant` untouched and silently moved real focus onto an
 * unrelated "Visual theme" button via this engine's own geometric search.
 *
 * These tests exercise `dispatchFromNative` end to end (import side effect:
 * `armTvNavigation` installs `window.__tvKeyDispatch`), rather than the
 * individual helpers, because the bug was specifically about what the native
 * key path does — the same helpers used correctly by the old DOM-listener path
 * would not have caught a regression only visible from that entry point.
 */
import { armTvNavigation } from './tv-navigation';

// jsdom does not implement scrollIntoView; applyFocus() calls it on every
// focus move, and the "no overlay" case here exercises that full path rather
// than a lower-level helper.
HTMLElement.prototype.scrollIntoView ??= () => undefined;

function dispatch(key: string): void {
    (
        window as Window & { __tvKeyDispatch?: (key: string) => void }
    ).__tvKeyDispatch?.(key);
}

describe('native key dispatch and mat-select-style overlays', () => {
    beforeEach(() => {
        // isAndroidRuntime() reads this directly; simulating the Capacitor
        // global avoids mocking a module that several other files also import
        // (jest.mock's hoisting resolved against the wrong base file here).
        (window as unknown as { Capacitor: { getPlatform(): string } }).Capacitor =
            { getPlatform: () => 'android' };
        document.body.innerHTML = '';
        document.documentElement.removeAttribute('data-tv-nav');
        armTvNavigation();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    it('dispatches a real ArrowDown to the open combobox instead of moving focus', () => {
        document.body.innerHTML = `
            <mat-select role="combobox" aria-activedescendant="mat-option-4" tabindex="0"></mat-select>
            <button id="unrelated">Visual theme</button>
            <div class="cdk-overlay-pane">
                <div role="option" id="mat-option-4"></div>
                <div role="option" id="mat-option-5"></div>
            </div>
        `;
        const select = document.querySelector('mat-select') as HTMLElement;
        select.focus();

        const received: KeyboardEvent[] = [];
        select.addEventListener('keydown', (e) => received.push(e as KeyboardEvent));

        dispatch('down');

        // The bug: real focus jumped to #unrelated and the trigger never saw
        // the key at all. The fix: the trigger receives it, and nothing else
        // steals focus.
        expect(received).toHaveLength(1);
        expect(received[0].key).toBe('ArrowDown');
        expect(received[0].keyCode).toBe(40);
        expect(document.activeElement).toBe(select);
    });

    it('dispatches Enter, not a synthetic click, to confirm the highlighted option', () => {
        document.body.innerHTML = `
            <mat-select role="combobox" tabindex="0"></mat-select>
            <div class="cdk-overlay-pane"></div>
        `;
        const select = document.querySelector('mat-select') as HTMLElement;
        select.focus();
        const received: KeyboardEvent[] = [];
        select.addEventListener('keydown', (e) => received.push(e as KeyboardEvent));

        dispatch('ok');

        expect(received).toHaveLength(1);
        expect(received[0].key).toBe('Enter');
    });

    it('leaves ordinary navigation untouched when no overlay is open', () => {
        document.body.innerHTML = `
            <button id="a">A</button>
            <button id="b" style="position:absolute;top:40px;left:0;">B</button>
        `;
        const a = document.getElementById('a') as HTMLButtonElement;
        const b = document.getElementById('b') as HTMLButtonElement;
        a.getBoundingClientRect = () =>
            ({ top: 0, bottom: 20, left: 0, right: 50, width: 50, height: 20 }) as DOMRect;
        b.getBoundingClientRect = () =>
            ({ top: 40, bottom: 60, left: 0, right: 50, width: 50, height: 20 }) as DOMRect;
        a.focus();

        dispatch('down');

        // No overlay: the geometric engine still runs, as it always did.
        expect(document.activeElement).toBe(b);
    });
});
