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
import {
    enterFullscreen,
    exitFullscreen,
    handleFullscreenDirection,
    isActiveChannelRow,
    isInsidePlayer,
    focusPlayerControls,
    isTvFullscreen,
    isInsidePlayerControls,
    armPlayerControlsIdleHide,
} from './player-keys';
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

const KEY_BY_DIRECTION: Readonly<Record<TvDirection, string>> = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
};

const KEY_CODES: Readonly<Record<string, number>> = {
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Enter: 13,
    Escape: 27,
};

/**
 * Dispatches a real `KeyboardEvent`, indistinguishable from a genuine one to
 * any ordinary `(keydown)` listener — only `isTrusted` differs, which matters
 * for browser-gated APIs like fullscreen/autoplay but not for Angular's own
 * event bindings. This is how control is handed back to a native or Material
 * widget that owns its own keyboard handling instead of this engine.
 */
function dispatchRealKey(key: string, target: EventTarget): void {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });

    // Old-style `keyCode`/`which` are still tested by some libraries — Material
    // itself, for one, which is why Escape needed this for BACK to close a
    // dialog. A synthesized KeyboardEvent carries 0 for both unless set here.
    const keyCode = KEY_CODES[key];
    if (keyCode !== undefined) {
        Object.defineProperty(event, 'keyCode', { value: keyCode });
        Object.defineProperty(event, 'which', { value: keyCode });
    }

    target.dispatchEvent(event);
}

/**
 * Whether the focused element currently belongs to a native/Material control
 * that must keep driving its own arrow/Enter handling.
 *
 * The concrete case this exists for: `mat-select`'s open panel uses the ARIA
 * 1.1 "activedescendant" combobox pattern. Real DOM focus never leaves the
 * trigger — `document.activeElement` stays `MAT-SELECT` the whole time — and
 * an `(keydown)` binding on that host element moves `aria-activedescendant`
 * and scrolls the panel. That binding only fires on a genuine keydown event
 * reaching the trigger, which stopped happening once the native key layer
 * began consuming every D-pad press before the WebView ever saw it: confirmed
 * on the reference device, pressing DOWN in the open language list left
 * `aria-activedescendant` untouched and silently moved real focus onto an
 * unrelated "Visual theme" button via this engine's own geometric search,
 * while the dropdown sat there unresponsive.
 *
 * `select`/`[role="slider"]` are the same kind of case for a plain native
 * `<select>` or a slider: both drive their own value via real keydown handling
 * that this engine would otherwise short-circuit.
 *
 * Deliberately **not** included here: a bare `[role="menu"]` ancestor. A
 * `mat-menu` panel always carries that role on its own container regardless
 * of what is inside it, and confirmed on the reference device, the "Select
 * playlist" menu's Search/Add-playlist buttons carry no ARIA role at all (the
 * panel is a `mat-menu` used purely for positioning, not built from
 * `[mat-menu-item]`). Treating "inside a role=menu container" as reason
 * enough to defer breaks two ways at once for that panel: real focus never
 * moves off the trigger into it in the first place (Angular Material only
 * auto-focuses a panel's first item for a keyboard-*initiated* open, and this
 * engine's OK always synthesizes a mouse-style click), and even after this
 * engine's own geometric search moves focus onto one of its buttons, nothing
 * inside the panel implements its own arrow-key handling to hand off to
 * either — both buttons were completely unreachable. Whether a `role="menu"`
 * container actually has real Material keyboard handling to defer to is
 * decided by `overlayHasNativeKeyboardHandling` below (its own `menuitem`
 * children), not by the role on the container itself. `move()` scopes its
 * own search to a panel with no such children instead — see
 * `findUnmanagedOverlay`.
 */
function isNativeControlOpen(active: Element | null): boolean {
    if (active?.closest('[role="slider"], select')) {
        return true;
    }

    // No fixed ancestor assumed: confirmed on the reference device that this
    // app's mat-select renders its panel (`.cdk-overlay-pane`) as a direct
    // child of the trigger itself (`cdk-overlay-popover`), not appended to a
    // global `.cdk-overlay-container` the way most Angular CDK docs describe —
    // a selector requiring that ancestor silently never matched, which is why
    // the first version of this fix still failed on-device even though it
    // passed in tests (jsdom fixtures had assumed the same wrong shape). The
    // element is confirmed removed from the DOM on close, not merely hidden,
    // so matching it anywhere in the document carries no stale-match risk.
    const overlay = document.querySelector('.cdk-overlay-pane');
    return overlay !== null && overlayHasNativeKeyboardHandling(overlay);
}

/**
 * The open `.cdk-overlay-pane` with no ARIA role (`option`/`menuitem`/
 * `slider`) among its content, or `null` if none is open or the open one owns
 * its own keyboard handling (mat-select's listbox, a real `[mat-menu-item]`
 * menu). `move()` scopes candidate search to this element: the overlay's
 * backdrop does not mark the rest of the page `aria-hidden`, so without a
 * scoped search, background content behind the dropdown would still be a
 * valid, reachable candidate.
 */
function findUnmanagedOverlay(): HTMLElement | null {
    const overlay = document.querySelector<HTMLElement>('.cdk-overlay-pane');
    if (!overlay || overlayHasNativeKeyboardHandling(overlay)) {
        return null;
    }
    return overlay;
}

function overlayHasNativeKeyboardHandling(overlay: Element): boolean {
    return (
        overlay.querySelector('[role="option"], [role="menuitem"], [role="slider"]') !==
        null
    );
}

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
    // Fullscreen video owns the D-pad outright: UP/DOWN zap, LEFT returns to
    // the list, RIGHT is swallowed. No geometry while the video has the screen.
    if (handleFullscreenDirection(direction)) {
        return true;
    }

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

    // An open overlay with no native keyboard handling of its own (see
    // findUnmanagedOverlay) has no other mechanism to move focus among its
    // content, so this engine's own search is confined to it — otherwise
    // background content, which the overlay's backdrop does not mark
    // `aria-hidden`, would still be a reachable candidate right behind it.
    const overlay = findUnmanagedOverlay();
    const searchRoot: ParentNode = overlay ?? document;

    const candidates = collectCandidates(searchRoot).filter(
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
                collectCandidates(searchRoot).filter(
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

    // OK over fullscreen video raises the transport controls — the reference
    // player's gesture, and the same one in live as on demand. Live used to
    // fall through to the branch below and hit `enterFullscreen()`, which
    // reports success for an already-fullscreen player and so swallowed the
    // press: pause was unreachable with the picture up. On demand there is
    // nothing focused at all, because entering the watch layout removes the
    // button that started playback.
    //
    // Once focus is on a control, OK belongs to that control and falls
    // through to the click below.
    if (isTvFullscreen() && !isInsidePlayerControls(active)) {
        return focusPlayerControls();
    }

    if (!active) {
        return false;
    }

    // Granting real focus is what raises the keyboard; no coaxing needed.
    if (isTextEntry(active)) {
        return promoteVirtualFocus();
    }

    // The benchmark's two-step OK: the first press on a channel tunes it and
    // the list survives; the second — the row is now the active one — commits
    // to fullscreen. OK on the player itself commits the same way.
    //
    // Only before fullscreen. `enterFullscreen()` reports success for an
    // already-fullscreen player, so leaving this reachable swallowed every OK
    // aimed at a transport control — they all sit inside the player view.
    if (
        !isTvFullscreen() &&
        (isActiveChannelRow(active) || isInsidePlayer(active))
    ) {
        if (enterFullscreen()) {
            return true;
        }
    }

    active.click();
    return true;
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
    }

    // Checked before branching on Enter vs. direction, and before anything
    // else: a select, a slider, an open menu, or an open mat-select's
    // activedescendant panel owns BOTH its arrows and its Enter, and a real
    // keydown reaching this listener already IS what such controls need, so
    // simply not touching it is enough here (unlike dispatchFromNative, which
    // has to synthesize one). Checking this only for the direction branch, as
    // an earlier version did, left Enter going through `activate()` first —
    // which calls `stopPropagation()` on success — so a synthetic Enter this
    // same module dispatches at a mat-select to hand it control would have
    // been swallowed by this very listener's capture-phase run before ever
    // reaching the trigger's own binding.
    const active = currentElement();
    if (isNativeControlOpen(active)) {
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
    // Fullscreen first: walking history underneath fullscreen video would
    // leave the page while the user only meant to shrink the picture.
    if (exitFullscreen()) {
        return;
    }

    // Same lesson as isNativeControlOpen: this app's overlays are not
    // appended under a global `.cdk-overlay-container`, so requiring that
    // ancestor silently never matched — BACK could not close a `mat-select`
    // or menu at all, falling straight through to the history/minimize
    // branches below instead.
    if (document.querySelector('.cdk-overlay-pane')) {
        dispatchRealKey('Escape', document.body);
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

    if (mapped === 'back') {
        goBack();
        return;
    }

    // Every press below can leave focus sitting on a transport control, which
    // pins the bar open. Re-arming here rather than at each call site means
    // the timer measures how long the remote has been quiet.
    try {
        handleNavigationKey(mapped);
    } finally {
        armPlayerControlsIdleHide();
    }
}

function handleNavigationKey(mapped: TvDirection | 'ok'): void {
    // A native/Material control (an open mat-select, a slider, a plain
    // <select>) must keep driving its own arrow/Enter handling — see
    // isNativeControlOpen's doc comment for the mat-select case this was
    // written for. Handing it a real KeyboardEvent is what makes that
    // handling run at all, now that the native key layer means this
    // function is the only thing that ever sees these presses.
    if (isNativeControlOpen(currentElement())) {
        const target = document.activeElement ?? document.body;
        dispatchRealKey(mapped === 'ok' ? 'Enter' : KEY_BY_DIRECTION[mapped], target);
        return;
    }

    if (mapped === 'ok') {
        activate();
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
