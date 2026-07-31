import { isAndroidRuntime } from './android-runtime';
import {
    collectCandidates,
    ensureFocusable,
    isTextEntry,
} from './spatial-candidates';
import { resolveZone, ZoneMemory } from './focus-zones';
import {
    applyRegion,
    expandContext,
    getContextPanel,
    getLastContextFocus,
    isAlreadySelectedCategory,
    isContextCategoryItem,
    isRegionCrossingAllowed,
    noteContextFocus,
    resolveRegion,
} from './panel-region';
import {
    clearVirtualFocus,
    getVirtualFocus,
    promoteVirtualFocus,
    setVirtualFocus,
} from './virtual-focus';
import { scrollToReveal } from './scroll-reach';
import { findBestCandidate, type TvDirection } from './spatial-geometry';
import { installTvFocusStyles } from './tv-focus.styles';

/**
 * D-pad navigation for the Android TV port.
 *
 * Entry point for the whole feature: `armTvNavigation()` is called once from
 * `main.ts` and no-ops off Android, so nothing here affects the PWA or the
 * Electron build.
 *
 * See docs/android-port/tv-navigation-reference.md for the behaviour this
 * reproduces.
 */

const DIRECTION_BY_KEY: Readonly<Record<string, TvDirection>> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

const memory = new ZoneMemory();

function currentElement(): HTMLElement | null {
    // A virtually focused text field is where the user believes focus is, even
    // though the browser has it on the body.
    const virtual = getVirtualFocus();
    if (virtual) {
        return virtual;
    }

    const active = document.activeElement;
    if (!active || active === document.body || !(active instanceof HTMLElement)) {
        return null;
    }
    return active;
}

function applyFocus(element: HTMLElement): void {
    ensureFocusable(element);

    // Arriving on a text field must not raise the keyboard — only OK does.
    // Real focus would open the IME immediately, so the field is marked instead
    // and DOM focus stays on the body, which keeps the D-pad alive.
    if (isTextEntry(element)) {
        setVirtualFocus(element);
    } else {
        clearVirtualFocus();
        element.focus({ preventScroll: true });
    }

    // Panels scroll independently, so the newly focused row is often just
    // outside its own container even though the page did not move.
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    memory.remember(element);
    noteContextFocus(element);
    applyRegion(element);
    scheduleAutoSelect(element);
}

/**
 * Categories follow focus — no OK needed. Debounced so that traversing the
 * column on the way somewhere else does not load every category it passes,
 * and skipped when the row is already the active category, because re-clicking
 * it reloads content for nothing (returning into the column via position
 * memory would otherwise reload on every visit).
 */
const AUTO_SELECT_DELAY_MS = 300;
let autoSelectTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleAutoSelect(element: HTMLElement): void {
    if (autoSelectTimer !== undefined) {
        clearTimeout(autoSelectTimer);
        autoSelectTimer = undefined;
    }

    if (!isContextCategoryItem(element) || isAlreadySelectedCategory(element)) {
        return;
    }

    autoSelectTimer = setTimeout(() => {
        autoSelectTimer = undefined;
        // Only if focus settled here; it may have moved on during the delay.
        if (currentElement() === element) {
            element.click();
        }
    }, AUTO_SELECT_DELAY_MS);
}

/** First focusable thing on screen, used when nothing holds focus yet. */
function focusFirstCandidate(): boolean {
    const candidates = collectCandidates();
    if (candidates.length === 0) {
        return false;
    }

    // Topmost, then leftmost: the reading order a viewer expects to start at.
    const first = candidates.reduce((best, candidate) =>
        candidate.rect.top < best.rect.top ||
        (candidate.rect.top === best.rect.top && candidate.rect.left < best.rect.left)
            ? candidate
            : best
    );

    applyFocus(first.target);
    return true;
}

/**
 * Unfolds the collapsed category column and lands on the row it was left on.
 *
 * The panel has to be expanded before its candidates can be collected: while
 * inert its children are excluded by design.
 */
function reopenContextPanel(): boolean {
    const panel = expandContext();
    if (!panel) {
        return false;
    }

    // Not read from the selection marks: the column holds several zones, and
    // the first mark in DOM order is the one in its header, not the row the
    // user left. Candidate collection is no help either — the panel is
    // mid-transition and still measures near zero, so the row would be filtered
    // out as invisible.
    const remembered = getLastContextFocus();
    if (remembered) {
        applyFocus(remembered);
        return true;
    }

    const candidates = collectCandidates(panel);
    if (candidates.length === 0) {
        return false;
    }

    applyFocus(candidates[0].target);
    return true;
}

function move(direction: TvDirection): boolean {
    const origin = currentElement();
    if (!origin) {
        return focusFirstCandidate();
    }

    // Left out of the content restores the folded column first, one panel at a
    // time. Geometry alone would skip straight past it to the rail, which is
    // still on screen — the user would lose the categories entirely and have to
    // come back through the rail to find them again.
    if (
        direction === 'left' &&
        resolveRegion(origin) === 'content' &&
        getContextPanel()?.hasAttribute('inert') === true &&
        reopenContextPanel()
    ) {
        return true;
    }

    const candidates = collectCandidates().filter(
        (candidate) =>
            candidate.target !== origin &&
            isRegionCrossingAllowed(origin, candidate.target, direction)
    );
    const target = findBestCandidate(
        origin.getBoundingClientRect(),
        candidates,
        direction
    );

    if (!target) {
        // Nothing in range does not mean nothing exists: candidate collection
        // is bounded to the viewport, so anything below the fold — the play
        // button on a movie detail, for one — is invisible to the search. Scroll
        // that way and look again, otherwise such content can never be focused
        // and therefore never scrolled to.
        if (scrollToReveal(origin, direction)) {
            const revealed = findBestCandidate(
                origin.getBoundingClientRect(),
                collectCandidates().filter(
                    (c) =>
                        c.target !== origin &&
                        isRegionCrossingAllowed(origin, c.target, direction)
                ),
                direction
            );
            if (revealed) {
                applyFocus(revealed);
                return true;
            }
        }

        // Deliberately do not wrap around: on a TV the user cannot see where
        // focus went, and wrapping reads as focus vanishing.
        return false;
    }

    // Entering a different panel restores that panel's own selection rather
    // than landing wherever geometry pointed. This is what makes navigation
    // feel like it remembers you.
    const targetZone = resolveZone(target);
    const destination =
        targetZone === resolveZone(origin)
            ? target
            : (memory.recall(targetZone) ?? target);

    applyFocus(destination);
    return true;
}

/**
 * The remote's OK button.
 *
 * Clicks everything itself, native controls included. The native key layer
 * consumes DPAD_CENTER/ENTER before the WebView sees them, so the browser's
 * own Enter-activates-buttons behaviour never runs any more — if this only
 * clicked the non-native elements, every real <button> would go dead.
 */
function activate(): boolean {
    const active = currentElement();
    if (!active) {
        return false;
    }

    // Granting real focus is what raises the keyboard; no coaxing needed.
    if (isTextEntry(active)) {
        return promoteVirtualFocus();
    }

    active.click();
    return true;
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
    }

    if (event.key === 'Enter') {
        if (activate()) {
            event.preventDefault();
            event.stopPropagation();
        }
        return;
    }

    const direction = DIRECTION_BY_KEY[event.key];
    if (!direction) {
        return;
    }

    // Let the focused widget handle its own arrows — a select, a slider or an
    // open menu owns them, and stealing them breaks the control.
    const active = currentElement();
    if (active?.closest('[role="menu"], [role="slider"], select')) {
        return;
    }

    // A field holding *real* focus has the keyboard open over it. Left/right
    // belong to the caret, but up/down must still escape, or the field is a
    // trap once the user is done typing.
    if (
        active &&
        isTextEntry(active) &&
        !getVirtualFocus() &&
        (direction === 'left' || direction === 'right')
    ) {
        return;
    }

    if (move(direction)) {
        event.preventDefault();
        event.stopPropagation();
    }
}

const NATIVE_KEYS: Readonly<Record<string, TvDirection | 'ok' | 'back'>> = {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    ok: 'ok',
    back: 'back',
};

/**
 * The remote's back button, forwarded by the native layer. Ordered from the
 * most local escape to the least:
 *
 * 1. An open overlay (dialog, menu) closes first — walking history underneath
 *    an open dialog would change the page behind it instead of dismissing it.
 *    CDK closes on Escape, so one synthetic Escape is the whole gesture.
 * 2. In-app history steps back. The Navigation API says whether there is
 *    anywhere to go; `history.length` cannot, since it never shrinks.
 * 3. At the real root, hand the task back to the launcher by minimizing.
 *    Finishing the activity — the old default — is why back used to quit the
 *    app from any list.
 */
function goBack(): void {
    const overlay = document.querySelector(
        '.cdk-overlay-container .cdk-overlay-pane'
    );
    if (overlay) {
        const escape = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        });
        // Material's dialogs still test `event.keyCode === 27`, and a
        // synthesized KeyboardEvent carries keyCode 0 — without this the
        // Escape lands and nothing closes.
        Object.defineProperty(escape, 'keyCode', { value: 27 });
        document.body.dispatchEvent(escape);
        return;
    }

    const navigation = (
        globalThis.window as Window & {
            navigation?: { canGoBack?: boolean };
        }
    ).navigation;
    if (navigation?.canGoBack) {
        history.back();
        return;
    }

    const capacitor = (
        globalThis.window as Window & {
            Capacitor?: {
                Plugins?: { App?: { minimizeApp?: () => Promise<void> } };
            };
        }
    ).Capacitor;
    void capacitor?.Plugins?.App?.minimizeApp?.()?.catch(() => undefined);
}

/**
 * Entry point for the native key layer. MainActivity.dispatchKeyEvent consumes
 * the D-pad before the WebView can run its own focus search — the search that
 * raised the IME on traversal and teleported focus when a key was declined —
 * and forwards each press here. Once the native layer is in place, this is the
 * only way D-pad input reaches the app.
 */
function dispatchFromNative(key: string): void {
    const mapped = NATIVE_KEYS[key];
    if (!mapped) {
        return;
    }

    if (mapped === 'ok') {
        activate();
        return;
    }

    if (mapped === 'back') {
        goBack();
        return;
    }

    move(mapped);
}

let armed = false;

/**
 * Installs D-pad navigation. Safe to call more than once, and a no-op outside
 * the Capacitor Android shell.
 */
export function armTvNavigation(): void {
    if (armed || !isAndroidRuntime()) {
        return;
    }
    armed = true;

    installTvFocusStyles();

    (window as Window & { __tvKeyDispatch?: (key: string) => void }).__tvKeyDispatch =
        dispatchFromNative;

    // Kept as a fallback for an APK whose native layer predates the dispatch
    // hook. When the native layer is present these keys are consumed before
    // the WebView, so this listener simply never fires for them.
    document.addEventListener('keydown', onKeyDown, { capture: true });
}
