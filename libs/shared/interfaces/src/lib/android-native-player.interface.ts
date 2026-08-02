/**
 * Phase 1 of the native Android video engine (ExoPlayer/Media3 behind a
 * Capacitor plugin, `AndroidNativePlayerPlugin.java`). Deliberately smaller
 * than `EmbeddedMpvSession` — no subtitle tracks, no recording, no
 * speed/aspect override — those are phase 2+. Audio tracks are in, because
 * IPTV VOD is largely multi-language and losing the dub picker would have
 * made the native engine a downgrade from the WebView it replaces. See
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

export interface AndroidNativePlayerTrack {
    /**
     * Position in the player's flattened audio-track list, not a container
     * track id: ExoPlayer addresses a track by (group, index within group),
     * which does not fit the shared controls' single-number contract. Stable
     * for a given media item — the flattening follows container order.
     */
    id: number;
    /** Display-ready; the native side resolves language codes to names. */
    label: string;
    selected: boolean;
}

export interface AndroidNativePlayerSnapshot {
    id: string;
    status: AndroidNativePlayerStatus;
    positionSeconds: number;
    durationSeconds: number | null;
    volume: number;
    isLive: boolean;
    /** Empty until the first samples are read, then pushed on every change. */
    audioTracks: AndroidNativePlayerTrack[];
    selectedAudioTrackId: number | null;
    /** Epoch milliseconds (`System.currentTimeMillis()` on the native side). */
    updatedAt: number;
    error?: string;
}
