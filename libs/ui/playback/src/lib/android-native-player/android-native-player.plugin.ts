import { InjectionToken } from '@angular/core';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type {
    AndroidNativePlayerBounds,
    AndroidNativePlayerSnapshot,
} from '@iptvnator/shared/interfaces';

export interface AndroidNativePlayerCreateOptions {
    bounds: AndroidNativePlayerBounds;
    devicePixelRatio: number;
    title: string;
    volume: number;
}

export interface AndroidNativePlayerLoadOptions {
    id: string;
    url: string;
    mimeType?: string;
    isLive?: boolean;
    startSeconds?: number;
    headers?: Record<string, string>;
    userAgent?: string;
}

export interface AndroidNativePlayerBoundsOptions {
    id: string;
    bounds: AndroidNativePlayerBounds;
    devicePixelRatio: number;
}

export interface AndroidNativePlayerIdOptions {
    id: string;
}

export interface AndroidNativePlayerVolumeOptions {
    id: string;
    volume: number;
}

export interface AndroidNativePlayerAudioTrackOptions {
    id: string;
    trackId: number;
}

export interface AndroidNativePlayerSeekOptions {
    id: string;
    positionSeconds: number;
}

/**
 * The native counterpart is `AndroidNativePlayerPlugin.java`
 * (`android/app/src/main/java/com/liureiptv/tv/`). See its doc comment for
 * the full lifecycle and why the app needs this at all (the WebView plays
 * 4K IPTV streams with audio only — this talks to the platform decoder
 * directly instead).
 */
export interface AndroidNativePlayerPlugin {
    create(
        options: AndroidNativePlayerCreateOptions
    ): Promise<{ id: string }>;
    load(options: AndroidNativePlayerLoadOptions): Promise<void>;
    play(options: AndroidNativePlayerIdOptions): Promise<void>;
    pause(options: AndroidNativePlayerIdOptions): Promise<void>;
    seek(options: AndroidNativePlayerSeekOptions): Promise<void>;
    setVolume(options: AndroidNativePlayerVolumeOptions): Promise<void>;
    setBounds(options: AndroidNativePlayerBoundsOptions): Promise<void>;
    setAudioTrack(options: AndroidNativePlayerAudioTrackOptions): Promise<void>;
    dispose(options: AndroidNativePlayerIdOptions): Promise<void>;
    /** Stop and release whichever native session is currently active. */
    stop?(): Promise<void>;
    addListener(
        eventName: 'nativePlayerStatus',
        listenerFunc: (snapshot: AndroidNativePlayerSnapshot) => void
    ): Promise<PluginListenerHandle>;
}

/**
 * Isolated behind a token so tests can substitute a fake without exercising
 * Capacitor's real plugin-resolution proxy, which rejects any method call
 * when no native/web implementation is registered — there is no 'web'
 * implementation here, this plugin is Android-only. Same pattern as
 * `BACKUP_IMPORT_PLUGIN` in
 * `apps/web/src/app/services/android/android-backup-import.service.ts`.
 *
 * Lives in this lib (not `apps/web`) so `AndroidNativeSessionController` can
 * inject it directly — libs must not import from `apps/web`.
 */
export const ANDROID_NATIVE_PLAYER_PLUGIN =
    new InjectionToken<AndroidNativePlayerPlugin>(
        'ANDROID_NATIVE_PLAYER_PLUGIN',
        {
            factory: () =>
                registerPlugin<AndroidNativePlayerPlugin>(
                    'AndroidNativePlayer'
                ),
        }
    );
