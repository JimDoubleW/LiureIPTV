/**
 * DOM markers the Android TV port sets on `<html>`. They are plain strings
 * rather than component state because the code that sets them (the player, in
 * `libs/`) and the code that reacts to them (the TV navigation engine and its
 * stylesheet, in `apps/web`) cannot import each other.
 */

/**
 * Marks the document while an Android native player session is active.
 *
 * The native video is a `SurfaceView` composited BEHIND the WebView, so it is
 * only visible through pixels the DOM leaves fully transparent. Anything that
 * paints an opaque background across the player's rect hides the picture
 * completely while every native-side signal — decoder, buffers, SurfaceFlinger
 * composition — still looks healthy, which is why this cost a long debugging
 * session once already (see `CLAUDE.android.md`).
 *
 * Three consumers key off this class and must stay in agreement:
 *
 * 1. `AndroidNativePlayerComponent` adds it to `<html>` for the session.
 * 2. `workspace-shell.component.scss` drops the shell's three backgrounds.
 *    SCSS cannot import this constant — that file repeats the literal and
 *    says so.
 * 3. `tv-focus.styles.ts` suppresses the TV-fullscreen black backdrop, which
 *    would otherwise cover the surface the moment the player goes fullscreen.
 *
 * It lives in this lib rather than beside the player because consumer 3 is
 * reached from `main.ts`: importing it through `@iptvnator/ui/playback`'s
 * barrel pulled every player engine into the initial bundle and blew the 5 MB
 * budget by 267 kB. This lib is already in that bundle.
 */
export const NATIVE_VIDEO_PUNCH_THROUGH_CLASS = 'native-video-punchthrough';

/**
 * Set while the player owns the whole screen. Layout, not the Fullscreen API:
 * key presses arrive through the native layer's `evaluateJavascript`, which
 * carries no user activation, and `requestFullscreen` rejects without one.
 */
export const TV_FULLSCREEN_ATTRIBUTE = 'data-tv-fullscreen';

/**
 * Set alongside {@link TV_FULLSCREEN_ATTRIBUTE} when fullscreen is not the
 * user's choice but the only layout that can show the picture at all.
 *
 * Movies and series play inside the detail page's "theater stage", which
 * stacks four opaque layers over the player's rect — the stage's own black, the
 * ambient poster blur, the shell card, and the detail page background. Every
 * one of them hides a surface composited behind the WebView, so on Android the
 * native engine goes fullscreen immediately, where the shell is blanked and
 * nothing paints over the video.
 *
 * Leaving that state would reveal a stage with invisible video still playing
 * behind it, so `exitFullscreen()` refuses while this is set and BACK falls
 * through to ordinary history handling, which closes the player instead.
 */
export const TV_FULLSCREEN_LOCKED_ATTRIBUTE = 'data-tv-fullscreen-locked';
