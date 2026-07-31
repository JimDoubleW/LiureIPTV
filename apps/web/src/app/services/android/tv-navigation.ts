import { isAndroidRuntime } from './android-runtime';
import { collectCandidates, ensureFocusable } from './spatial-candidates';
import { resolveZone, ZoneMemory } from './focus-zones';
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
    const active = document.activeElement;
    if (!active || active === document.body || !(active instanceof HTMLElement)) {
        return null;
    }
    return active;
}

function applyFocus(element: HTMLElement): void {
    ensureFocusable(element);
    element.focus({ preventScroll: true });

    // Panels scroll independently, so the newly focused row is often just
    // outside its own container even though the page did not move.
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    memory.remember(element);
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

function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
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
