/**
 * Phase 1 of the native Android video engine (ExoPlayer/Media3 behind a
 * Capacitor plugin, `AndroidNativePlayerPlugin.java`). Deliberately smaller
 * than `EmbeddedMpvSession` — no audio/subtitle tracks, no recording, no
 * speed/aspect override — those are phase 2+. See
 * `libs/ui/playback/src/lib/android-native-player/` for the JS-side
 * consumer and `docs/architecture` for the full contract once phase 1 lands.
 */

export type AndroidNativePlayerStatus =
    | 'idle'
    | 'loading'
    | 'playing'
    | 'paused'
    | 'ended'
    | 'error';

export interface AndroidNativePlayerBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface AndroidNativePlayerSupport {
    supported: boolean;
    reason?: string;
}

export interface AndroidNativePlayerSnapshot {
    id: string;
    status: AndroidNativePlayerStatus;
    positionSeconds: number;
    durationSeconds: number | null;
    volume: number;
    isLive: boolean;
    /** Epoch milliseconds (`System.currentTimeMillis()` on the native side). */
    updatedAt: number;
    error?: string;
}
