import {
    TV_FULLSCREEN_ATTRIBUTE,
    TV_FULLSCREEN_LOCKED_ATTRIBUTE,
} from '@iptvnator/shared/interfaces';
import type { TvDirection } from './spatial-geometry';

/**
 * The playback side of the reference-player key contract.
 *
 * The Android TV OK gesture tunes a live channel and folds its list while
 * keeping playback inline beside the EPG. OK with focus on the player is the
 * explicit fullscreen gesture. UP/DOWN over fullscreen video zap to the previous and
 * next channel with no surface open at all, and LEFT reveals the channel
 * list (here: leaves fullscreen, which is the closest structural equivalent).
 * See docs/android-port/tv-navigation-reference.md.
 *
 * Fullscreen here is layout, not the Fullscreen API. Every key press arrives
 * through the native layer's `evaluateJavascript`, which carries no user
 * activation, and `requestFullscreen` rejects without one — the same mechanism
 * that forced the keyboard through @capacitor/keyboard. An attribute on the
 * document element plus a fixed-inset style needs no gesture and stays fully
 * under this engine's control.
 *
 * LEFT/RIGHT remain inside the fullscreen surface; BACK exits it. Everything
 * else works off one DOM contract the app already maintains:
 * `.channel-list-item` rows with `active` marking the tuned channel. No
 * component is modified.
 */

// Re-exported so this module stays the one place the TV key contract is read
// from; the constants themselves live in a lib because the player that sets
// them cannot import `apps/web`.
export { TV_FULLSCREEN_ATTRIBUTE, TV_FULLSCREEN_LOCKED_ATTRIBUTE };

const PLAYER_VIEW_SELECTOR = 'app-web-player-view';
const CHANNEL_ROW_SELECTOR = '.channel-list-item';
const ACTIVE_ROW_CLASS = 'active';
const ACTIVE_CHANNEL_ROW_SELECTOR = `${CHANNEL_ROW_SELECTOR}.${ACTIVE_ROW_CLASS}`;
const CATCHUP_TARGET_SELECTOR = '[data-tv-catchup-target]';
const CATCHUP_PLAYER_SELECTOR =
    `${PLAYER_VIEW_SELECTOR}[data-tv-catchup-playing]`;
const DOUBLE_OK_WINDOW_MS = 650;
const CATCHUP_FULLSCREEN_WAIT_MS = 5000;

let lastCatchupTarget: Element | null = null;
let lastCatchupOkAt = 0;
let cancelPendingCatchupFullscreen: (() => void) | null = null;

/**
 * "Is something actually playing to enlarge?" — asked of the DOM, so it has
 * to name every engine's surface. `video` covers the web players; the Android
 * native engine (ExoPlayer, the default on this port) has no `<video>` at all,
 * only a placeholder div the native SurfaceView is bounds-synced against, so a
 * `video`-only test made fullscreen permanently unreachable there.
 */
const PLAYBACK_SURFACE_SELECTOR = [
    `${PLAYER_VIEW_SELECTOR} video`,
    `${PLAYER_VIEW_SELECTOR} app-android-native-player`,
].join(', ');

export function isInsidePlayer(element: Element): boolean {
    return element.closest(PLAYER_VIEW_SELECTOR) !== null;
}

/** True when the focused element belongs to the row of the tuned channel. */
export function isActiveChannelRow(element: Element): boolean {
    const row = element.closest(CHANNEL_ROW_SELECTOR);
    return row !== null && row.classList.contains(ACTIVE_ROW_CLASS);
}

export function isTvFullscreen(): boolean {
    return document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE);
}

/**
 * Consumes the second quick OK on a replay programme and enters fullscreen.
 * The archive URL may still be resolving, so wait for its marked player rather
 * than briefly enlarging the live programme that is being replaced.
 */
export function handleCatchupProgrammeOk(element: Element | null): boolean {
    const target = element?.closest(CATCHUP_TARGET_SELECTOR);
    if (!target || isTvFullscreen()) {
        lastCatchupTarget = null;
        return false;
    }

    const now = Date.now();
    const isDoubleOk =
        target === lastCatchupTarget && now - lastCatchupOkAt <= DOUBLE_OK_WINDOW_MS;
    lastCatchupTarget = target;
    lastCatchupOkAt = now;
    if (!isDoubleOk) {
        return false;
    }

    lastCatchupTarget = null;
    waitForCatchupFullscreen();
    return true;
}

function waitForCatchupFullscreen(): void {
    cancelPendingCatchupFullscreen?.();
    if (enterFullscreenForCatchup()) {
        return;
    }

    const observer = new MutationObserver(() => {
        if (enterFullscreenForCatchup()) {
            cancelPendingCatchupFullscreen?.();
        }
    });
    let timeout: number | null = null;
    const cancel = () => {
        observer.disconnect();
        if (timeout !== null) {
            window.clearTimeout(timeout);
        }
        if (cancelPendingCatchupFullscreen === cancel) {
            cancelPendingCatchupFullscreen = null;
        }
    };
    cancelPendingCatchupFullscreen = cancel;
    observer.observe(document.body, { childList: true, subtree: true });
    timeout = window.setTimeout(cancel, CATCHUP_FULLSCREEN_WAIT_MS);
}

function enterFullscreenForCatchup(): boolean {
    return (
        document.querySelector(CATCHUP_PLAYER_SELECTOR) !== null &&
        enterFullscreen()
    );
}

/**
 * Put focus on a transport button, which is what makes the controls appear:
 * the bar reveals itself on `focusin` and stays up while focus is inside.
 *
 * Deliberately a button and not "the first focusable thing in the player".
 * The seek slider is an `<input type="range">`, and focusing an input raises
 * the soft keyboard on the reference device — which is worse than doing
 * nothing, because `MainActivity` then hands every D-pad key to the IME and
 * the remote stops reaching the app at all.
 */
export function focusPlayerControls(): boolean {
    const button = document.querySelector<HTMLElement>(
        `${PLAYER_VIEW_SELECTOR} app-player-controls button:not([disabled])`
    );
    if (!button) {
        return false;
    }
    button.focus();
    return true;
}

/** True when focus already sits on a transport control. */
export function isInsidePlayerControls(element: Element | null): boolean {
    return (
        element?.closest(`${PLAYER_VIEW_SELECTOR} app-player-controls`) != null
    );
}

/**
 * How long the controls stay up with the remote idle. Longer than the shared
 * bar's own 2.5s hover delay: a pointer leaves the bar on its way elsewhere,
 * whereas a viewer reading a seek position from three metres away has not
 * finished looking at it yet.
 */
const CONTROLS_IDLE_MS = 5000;
let controlsIdleTimer: number | null = null;

function focusedControl(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement &&
        active.closest(`${PLAYER_VIEW_SELECTOR} app-player-controls`)
        ? active
        : null;
}

/**
 * Let the controls fade again after the remote goes quiet.
 *
 * The shared bar hides itself on a timer, but pins itself open while focus is
 * inside — sensible for a pointer, which moves on by itself. A remote's focus
 * never moves on: there is nowhere else to put it while the shell is blanked,
 * so the bar sat over the film forever. Dropping focus is what releases the
 * pin; the bar's own `focusout` handler then schedules the hide it always
 * would have. Re-armed on every key, so it measures idleness, not age.
 */
export function armPlayerControlsIdleHide(): void {
    if (controlsIdleTimer !== null) {
        window.clearTimeout(controlsIdleTimer);
        controlsIdleTimer = null;
    }
    if (!focusedControl()) {
        return;
    }

    controlsIdleTimer = window.setTimeout(() => {
        controlsIdleTimer = null;
        // Re-checked: the session may have ended, or focus moved, since.
        focusedControl()?.blur();
    }, CONTROLS_IDLE_MS);
}

/** Returns false when nothing is playing to enlarge. */
export function enterFullscreen(): boolean {
    if (isTvFullscreen()) {
        return true;
    }
    if (!document.querySelector(PLAYBACK_SURFACE_SELECTOR)) {
        return false;
    }

    document.documentElement.setAttribute(TV_FULLSCREEN_ATTRIBUTE, '');
    return true;
}

/** True while fullscreen is the only layout that can show the picture. */
export function isTvFullscreenLocked(): boolean {
    return document.documentElement.hasAttribute(
        TV_FULLSCREEN_LOCKED_ATTRIBUTE
    );
}

/**
 * Returns false when there was nothing to exit — and also when exiting is not
 * allowed, so BACK falls through to its history branch and closes the player
 * rather than uncovering a stage with invisible video playing behind it. See
 * {@link TV_FULLSCREEN_LOCKED_ATTRIBUTE}.
 */
export function exitFullscreen(): boolean {
    cancelPendingCatchupFullscreen?.();
    if (!isTvFullscreen() || isTvFullscreenLocked()) {
        return false;
    }
    document.documentElement.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
    return true;
}

/**
 * Zap over fullscreen video: UP is the previous channel, DOWN the next — the
 * remote's natural direction. The list orders channels by ascending number,
 * so "next" is the row below the active one.
 *
 * Works on the rows already rendered behind the fullscreen element. When the
 * active row is not among them (virtual scrolling dropped it), the press does
 * nothing rather than jumping somewhere arbitrary.
 */
export function zapAdjacent(direction: TvDirection): boolean {
    const target = adjacentChannel(direction);
    if (!target) {
        return false;
    }

    target.click();
    return true;
}

function adjacentChannel(direction: TvDirection): HTMLElement | null {
    if (direction !== 'up' && direction !== 'down') {
        return null;
    }

    const rows = Array.from(
        document.querySelectorAll<HTMLElement>(CHANNEL_ROW_SELECTOR)
    );
    const activeIndex = rows.findIndex((row) =>
        row.classList.contains(ACTIVE_ROW_CLASS)
    );
    if (activeIndex < 0) {
        return null;
    }

    const target = rows[activeIndex + (direction === 'up' ? -1 : 1)];
    if (!target) {
        return null;
    }
    return target;
}

/**
 * Let UP/DOWN zap while the expanded channel list owns focus. The same
 * channel click contract is used as in fullscreen; the panel remains open so
 * the viewer can see the newly tuned row and press OK when ready to enlarge
 * the picture.
 */
export function handleChannelListDirection(
    direction: TvDirection,
    focused: Element | null,
    focusTarget?: (target: HTMLElement) => void
): boolean {
    if (
        isTvFullscreen() ||
        (direction !== 'up' && direction !== 'down') ||
        !focused?.closest(CHANNEL_ROW_SELECTOR)
    ) {
        return false;
    }

    // Nothing to zap from: a freshly opened category, or one that doesn't
    // contain the channel actually playing, has no `.active` row at all.
    // `adjacentChannel` and a real list boundary both return null the same
    // way, so without this check every press below was swallowed here and the
    // remote could never move off wherever focus first landed — regardless of
    // reason. Falling through lets ordinary geometric movement walk the rows.
    if (!document.querySelector(ACTIVE_CHANNEL_ROW_SELECTOR)) {
        return false;
    }

    const target = adjacentChannel(direction);
    if (target) {
        // Move focus before the click can trigger Angular change detection and
        // recycle the old virtual-scroll row. The navigation layer also
        // remembers this node so it can recover the newly rendered active row
        // if the focused instance is replaced immediately afterwards.
        focusTarget?.(target);
        target.click();
    }
    // Keep the D-pad in the channel-list zap mode at the ends too; falling
    // through to geometric focus movement would make UP/DOWN appear to change
    // selection without tuning a channel.
    return true;
}

/**
 * All fullscreen key handling in one place, called before any geometric move.
 * Returns true when the key was resolved here — including RIGHT, which does
 * nothing but must still be swallowed, or the WebView would act on it.
 */
export function handleFullscreenDirection(direction: TvDirection): boolean {
    if (!isTvFullscreen()) {
        return false;
    }

    // Two cases hand the keys to the ordinary spatial search instead.
    //
    // A locked fullscreen is on-demand playback: there is no channel list to
    // zap through and no list layout to return to, so claiming the keys left
    // the remote completely inert — every direction consumed, nothing moved.
    //
    // And whenever focus is already on a transport control, the directions
    // belong to that row: zapping out from under a half-used control panel
    // would be the wrong gesture in live too. Focus returns to nothing after
    // the idle timeout, which is what gives the zap its keys back.
    if (
        isTvFullscreenLocked() ||
        isInsidePlayerControls(document.activeElement)
    ) {
        return false;
    }

    if (direction === 'up' || direction === 'down') {
        zapAdjacent(direction);
        return true;
    }

    // LEFT/RIGHT never leave the current panel. BACK is the explicit gesture
    // that exits fullscreen and reveals the channel list.
    return true;
}
