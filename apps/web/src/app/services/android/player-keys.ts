import {
    TV_FULLSCREEN_ATTRIBUTE,
    TV_FULLSCREEN_LOCKED_ATTRIBUTE,
} from '@iptvnator/shared/interfaces';
import type { TvDirection } from './spatial-geometry';

/**
 * The playback side of the reference-player key contract.
 *
 * The benchmark's OK is a two-step gesture: the first press on a channel tunes
 * it while the list survives, the second — on the now-playing channel —
 * commits to fullscreen. UP/DOWN over fullscreen video zap to the next and
 * previous channel with no surface open at all, and LEFT reveals the channel
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
 * Everything works off one DOM contract the app already maintains:
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
    if (!isTvFullscreen() || isTvFullscreenLocked()) {
        return false;
    }
    document.documentElement.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
    return true;
}

/**
 * Zap over fullscreen video: UP is the next channel, DOWN the previous — the
 * convention the user confirmed against the benchmark. The list orders
 * channels by ascending number, so "next" is the row below the active one.
 *
 * Works on the rows already rendered behind the fullscreen element. When the
 * active row is not among them (virtual scrolling dropped it), the press does
 * nothing rather than jumping somewhere arbitrary.
 */
export function zapAdjacent(direction: TvDirection): boolean {
    if (direction !== 'up' && direction !== 'down') {
        return false;
    }

    const rows = Array.from(
        document.querySelectorAll<HTMLElement>(CHANNEL_ROW_SELECTOR)
    );
    const activeIndex = rows.findIndex((row) =>
        row.classList.contains(ACTIVE_ROW_CLASS)
    );
    if (activeIndex < 0) {
        return false;
    }

    const target = rows[activeIndex + (direction === 'up' ? 1 : -1)];
    if (!target) {
        return false;
    }

    target.click();
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

    // A locked fullscreen is on-demand playback: there is no channel list to
    // zap through and no list layout to return to, so swallowing the keys here
    // left the remote completely inert — every direction consumed, nothing
    // moved. Hand them to the ordinary spatial search instead. The shell is
    // blanked while fullscreen, so the only candidates left are the player's
    // own controls, and focusing one is what makes the bar appear.
    if (isTvFullscreenLocked()) {
        return false;
    }

    if (direction === 'up' || direction === 'down') {
        zapAdjacent(direction);
        return true;
    }

    if (direction === 'left') {
        // The benchmark's LEFT reveals the channel list over the video; the
        // closest structural equivalent is returning to the list layout. When
        // fullscreen is locked there is no list to return to — the key is
        // still swallowed so the WebView cannot act on it.
        exitFullscreen();
        return true;
    }

    return true;
}
