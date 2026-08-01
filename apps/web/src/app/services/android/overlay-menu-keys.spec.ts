/**
 * Regression coverage for the "can't add a playlist" bug.
 *
 * The "Select playlist" dropdown is a `mat-menu` used purely for positioning:
 * its Search/Add-playlist buttons carry no ARIA role at all (no
 * `[mat-menu-item]`, no `role="option"`/`"menuitem"`). `isNativeControlOpen`
 * used to treat ANY open `.cdk-overlay-pane` as native-controlled and hand its
 * keys to `document.activeElement` — but real DOM focus never leaves the
 * trigger for this kind of panel (Angular Material only auto-focuses a panel
 * for a keyboard-*initiated* open, and this engine's OK always synthesizes a
 * mouse-style click), and nothing inside the panel implements its own keydown
 * handling either. The result, confirmed on the reference device: arrow keys
 * and OK were dispatched to the stale, disconnected trigger, and "+ Add
 * playlist" was completely unreachable.
 *
 * These tests exercise `dispatchFromNative` end to end (import side effect:
 * `armTvNavigation` installs `window.__tvKeyDispatch`), matching
 * mat-select-keys.spec.ts, since the bug was specifically about the native key
 * entry point.
 */
import { armTvNavigation } from './tv-navigation';

// jsdom does not implement scrollIntoView; applyFocus() calls it on every
// focus move.
HTMLElement.prototype.scrollIntoView ??= () => undefined;

function dispatch(key: string): void {
    (
        window as Window & { __tvKeyDispatch?: (key: string) => void }
    ).__tvKeyDispatch?.(key);
}

function withRect(
    element: HTMLElement,
    rect: { top: number; bottom: number; left: number; right: number }
): HTMLElement {
    element.getBoundingClientRect = () =>
        ({
            ...rect,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        }) as DOMRect;
    return element;
}

describe('native key dispatch and an unmanaged (role-less) overlay menu', () => {
    beforeEach(() => {
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

    it('moves real focus into the panel instead of handing keys to the stale trigger', () => {
        document.body.innerHTML = `
            <div class="playlist-switcher-trigger" tabindex="-1" aria-haspopup="menu" aria-expanded="true"></div>
            <button id="background">Live TV</button>
            <div class="cdk-overlay-pane">
                <div role="menu" class="mat-mdc-menu-panel">
                    <button id="search">search</button>
                    <button id="addPlaylist">Add playlist</button>
                </div>
            </div>
        `;
        const trigger = withRect(
            document.querySelector('.playlist-switcher-trigger') as HTMLElement,
            { top: 0, bottom: 20, left: 0, right: 200 }
        );
        // Closer and better-aligned to the trigger than either overlay
        // button — the geometric engine would prefer this over both if
        // candidate search were not scoped to the open overlay.
        withRect(document.getElementById('background') as HTMLElement, {
            top: 30,
            bottom: 50,
            left: 80,
            right: 120,
        });
        withRect(document.getElementById('search') as HTMLElement, {
            top: 60,
            bottom: 80,
            left: 170,
            right: 200,
        });
        const addPlaylist = withRect(
            document.getElementById('addPlaylist') as HTMLElement,
            { top: 100, bottom: 120, left: 0, right: 200 }
        );
        trigger.focus();

        dispatch('down');

        const overlay = document.querySelector('.cdk-overlay-pane') as HTMLElement;
        expect(overlay.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(
            document.getElementById('background')
        );

        dispatch('down');

        expect(document.activeElement).toBe(addPlaylist);
    });

    it('clicks the focused panel button on OK', () => {
        document.body.innerHTML = `
            <div class="cdk-overlay-pane">
                <div role="menu" class="mat-mdc-menu-panel">
                    <button id="addPlaylist">Add playlist</button>
                </div>
            </div>
        `;
        const addPlaylist = document.getElementById(
            'addPlaylist'
        ) as HTMLButtonElement;
        addPlaylist.setAttribute('tabindex', '-1');
        addPlaylist.focus();
        let clicked = false;
        addPlaylist.addEventListener('click', () => {
            clicked = true;
        });

        dispatch('ok');

        expect(clicked).toBe(true);
    });

    it('closes the panel with a synthetic Escape on BACK', () => {
        document.body.innerHTML = `
            <div class="cdk-overlay-pane">
                <div role="menu" class="mat-mdc-menu-panel">
                    <button id="addPlaylist">Add playlist</button>
                </div>
            </div>
        `;
        const received: KeyboardEvent[] = [];
        document.body.addEventListener('keydown', (e) =>
            received.push(e as KeyboardEvent)
        );

        dispatch('back');

        expect(received).toHaveLength(1);
        expect(received[0].key).toBe('Escape');
    });
});
