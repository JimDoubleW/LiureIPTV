import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android TV port. See CLAUDE.android.md for the WebView origin contract —
 * the `http` scheme below is deliberate and was verified on device.
 *
 * `androidScheme` MUST stay under `server`. Capacitor reads it from there;
 * placing it under `android` is silently ignored and you get the `https`
 * default with no warning.
 */
const config: CapacitorConfig = {
    appId: 'com.liureiptv.tv',
    appName: 'LiureIPTV',
    webDir: 'dist/apps/web',
    server: {
        // http://localhost is still a secure context (MediaSource, EME,
        // crypto.subtle all present), while https would trigger Chromium's
        // mixed-content autoupgrade and hide every plain-http provider logo.
        androidScheme: 'http',
    },
    android: {
        // Required for fetch/XHR to plain-http provider origins. Pairs with
        // usesCleartextTraffic="true" in AndroidManifest.xml.
        allowMixedContent: true,
    },
    plugins: {
        /*
         * Deliberately NOT enabled.
         *
         * Enabling it patches `fetch` and `XMLHttpRequest` globally, and the
         * native stack reads a response to completion before handing it back.
         * That is fine for a JSON API and fatal for media: a live MPEG-TS
         * stream never completes, so `mpegts.js` waits forever and the player
         * shows a spinner over a black screen.
         *
         * Native HTTP is used explicitly where CORS actually matters — see
         * PortalDirectInterceptor — and the browser stack keeps the streams.
         */
        CapacitorHttp: {
            enabled: false,
        },
    },
};

export default config;
