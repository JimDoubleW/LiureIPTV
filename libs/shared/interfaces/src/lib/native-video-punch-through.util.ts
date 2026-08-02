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
