import { App } from '@capacitor/app';

const TRAY_DOUBLE_BACK_WINDOW_MS = 650;

interface AndroidLifecyclePlugins {
    readonly App?: {
        exitApp?: () => Promise<void>;
        minimizeApp?: () => Promise<void>;
    };
    readonly AndroidNativePlayer?: {
        stop?: () => Promise<void>;
    };
}

let lastTrayBackAt = 0;
let trayBackResetTimer: ReturnType<typeof setTimeout> | null = null;

function plugins(): AndroidLifecyclePlugins | undefined {
    return (
        globalThis.window as Window & {
            Capacitor?: { Plugins?: AndroidLifecyclePlugins };
        }
    ).Capacitor?.Plugins;
}

export function resetTrayBackSequence(): void {
    lastTrayBackAt = 0;
    if (trayBackResetTimer !== null) {
        clearTimeout(trayBackResetTimer);
        trayBackResetTimer = null;
    }
}

function stopNativePlayerAndExit(): void {
    const currentPlugins = plugins();
    const app = currentPlugins?.App;
    const nativePlayer = currentPlugins?.AndroidNativePlayer;

    // Stop/release ExoPlayer first. Activity.onDestroy() is a fallback, but
    // waiting for this bridge call prevents native audio surviving WebView
    // teardown while Android finishes the Activity.
    let stopPromise: Promise<void>;
    try {
        stopPromise = nativePlayer?.stop?.() ?? Promise.resolve();
    } catch {
        stopPromise = Promise.resolve();
    }

    void stopPromise
        .catch(() => undefined)
        .then(() => {
            try {
                // Importing App registers the official Capacitor proxy even
                // when no other web code has needed the lifecycle plugin yet.
                return (
                    app?.exitApp?.() ?? app?.minimizeApp?.() ?? App.exitApp()
                );
            } catch {
                return undefined;
            }
        })
        .catch(() => undefined);
}

export function handleTrayBack(): void {
    const now = Date.now();
    if (now - lastTrayBackAt <= TRAY_DOUBLE_BACK_WINDOW_MS) {
        resetTrayBackSequence();
        stopNativePlayerAndExit();
        return;
    }

    lastTrayBackAt = now;
    if (trayBackResetTimer !== null) {
        clearTimeout(trayBackResetTimer);
    }
    trayBackResetTimer = setTimeout(() => {
        trayBackResetTimer = null;
        lastTrayBackAt = 0;
    }, TRAY_DOUBLE_BACK_WINDOW_MS);
}
