import { isAndroidRuntime } from './android-runtime';
import {
    collectCandidates,
    ensureFocusable,
    isNativelyActivatable,
    isTextEntry,
} from './spatial-candidates';
import { resolveZone, ZoneMemory } from './focus-zones';
import { applyRegion } from './panel-region';
import {
    clearVirtualFocus,
    getVirtualFocus,
    promoteVirtualFocus,
    setVirtualFocus,
} from './virtual-focus';
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
    applyRegion(element);
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

function move(direction: TvDirection): boolean {
    const origin = currentElement();
    if (!origin) {
        return focusFirstCandidate();
    }

    const candidates = collectCandidates().filter(
        (candidate) => candidate.target !== origin
    );
    const target = findBestCandidate(
        origin.getBoundingClientRect(),
        candidates,
        direction
    );

    if (!target) {
        // Nothing that way. Deliberately do not wrap around: on a TV the user
        // cannot see where focus went, and wrapping reads as focus vanishing.
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
 * The remote's OK button. Native controls activate themselves on Enter; the
 * clickable `div`s that make up most tiles and rows do not, so without this the
 * D-pad can reach every part of the UI and operate none of it.
 */
function activateFocused(event: KeyboardEvent): void {
    const active = currentElement();
    if (!active) {
        return;
    }

    // Granting real focus is what raises the keyboard; no coaxing needed.
    if (isTextEntry(active) && promoteVirtualFocus()) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    if (isTextEntry(active)) {
        return;
    }

    if (isNativelyActivatable(active)) {
        return;
    }

    active.click();
    event.preventDefault();
    event.stopPropagation();
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
    }

    if (event.key === 'Enter') {
        activateFocused(event);
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
    // Capture phase: the remote's arrows must be resolved before a component's
    // own keydown handler consumes them.
    document.addEventListener('keydown', onKeyDown, { capture: true });
}
