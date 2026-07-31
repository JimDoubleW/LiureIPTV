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
    appId: 'com.iptvandor.tv',
    appName: 'IPTVandor',
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
};

export default config;
