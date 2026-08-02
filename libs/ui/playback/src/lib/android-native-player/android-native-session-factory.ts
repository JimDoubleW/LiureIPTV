import {
    AndroidNativePlayerSnapshot,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { isLivePlayback } from './is-live-playback.util';

/**
 * Synthetic (`id: ''`) snapshots for the two windows where no real native
 * session id exists yet: the instant a session starts (before the plugin's
 * `create()` call resolves) and a failed start. Mirrors
 * embedded-mpv-session-factory.ts's createLoadingSession/createErrorSession.
 */

export function createLoadingSnapshot(
    playback: ResolvedPortalPlayback,
    volume: number
): AndroidNativePlayerSnapshot {
    return {
        id: '',
        status: 'loading',
        positionSeconds: 0,
        durationSeconds: null,
        volume,
        isLive: isLivePlayback(playback),
        // Nothing has been demuxed yet, so there is no track list to report.
        audioTracks: [],
        selectedAudioTrackId: null,
        updatedAt: Date.now(),
    };
}

export function createErrorSnapshot(
    playback: ResolvedPortalPlayback,
    volume: number,
    error: unknown
): AndroidNativePlayerSnapshot {
    return {
        id: '',
        status: 'error',
        positionSeconds: 0,
        durationSeconds: null,
        volume,
        isLive: isLivePlayback(playback),
        audioTracks: [],
        selectedAudioTrackId: null,
        updatedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
    };
}
