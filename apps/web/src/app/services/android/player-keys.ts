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

/** Set while the player owns the whole screen; the stylesheet keys off it. */
export const TV_FULLSCREEN_ATTRIBUTE = 'data-tv-fullscreen';

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

export function exitFullscreen(): boolean {
    if (!isTvFullscreen()) {
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

    if (direction === 'up' || direction === 'down') {
        zapAdjacent(direction);
        return true;
    }

    if (direction === 'left') {
        // The benchmark's LEFT reveals the channel list over the video; the
        // closest structural equivalent is returning to the list layout.
        exitFullscreen();
        return true;
    }

    return true;
}
