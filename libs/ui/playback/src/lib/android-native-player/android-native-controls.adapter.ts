import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { AndroidNativePlayerSnapshot, ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from '../player-controls/player-controls-defaults';
import {
    PlayerController,
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerTrack,
} from '../player-controls/player-controls.model';
import { readStoredVolume } from './android-native-bounds.utils';
import { isLivePlayback } from './is-live-playback.util';
import { AndroidNativeSessionController } from './android-native-session-controller';

export interface AndroidNativeControlsContext {
    readonly playback: Signal<ResolvedPortalPlayback>;
}

/**
 * Phase 1 `PlayerController` for the native Android engine. Far smaller than
 * `EmbeddedMpvControlsAdapter` — no tracks, no recording, no speed/aspect —
 * those flags stay false until later phases add the matching Media3 API
 * surface. See `player-controls.model.ts`'s own contract note: "a control
 * renders only when its flag is true, so an engine may legitimately support
 * a subset."
 */
@Injectable()
export class AndroidNativeControlsAdapter implements PlayerController {
    private readonly controller = inject(AndroidNativeSessionController);
    private readonly translate = inject(TranslateService);

    private readonly configuredContext =
        signal<AndroidNativeControlsContext | null>(null);

    readonly capabilities = computed<PlayerControlsCapabilities>(() => {
        const context = this.configuredContext();
        if (!context) {
            return DEFAULT_PLAYER_CAPABILITIES;
        }

        return {
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: !isLivePlayback(context.playback()),
            volume: true,
            fullscreen: true,
            // One track is not a choice, and the list is empty until the
            // first samples are read — reporting the capability before then
            // would render a menu button that opens onto nothing.
            audioTracks: this.audioTracks().length > 1,
        };
    });

    private readonly audioTracks = computed<PlayerTrack[]>(() => {
        const snapshot = this.controller.snapshot();
        return (snapshot?.audioTracks ?? []).map((track) => ({
            id: track.id,
            label: track.label,
            selected: track.selected,
        }));
    });

    readonly state = computed<PlayerControlsState>(() => {
        const context = this.configuredContext();
        if (!context) {
            return createEmptyControlsState();
        }

        const snapshot = this.controller.snapshot();
        const isLive = isLivePlayback(context.playback());
        const durationSeconds = isLive
            ? null
            : (snapshot?.durationSeconds ?? null);

        return {
            ...createEmptyControlsState(),
            status: snapshot?.status ?? 'loading',
            statusMessage: this.resolveStatusMessage(snapshot),
            positionSeconds: Math.max(0, snapshot?.positionSeconds ?? 0),
            durationSeconds,
            isLive,
            canSeek: !isLive && (durationSeconds ?? 0) > 0,
            volume: snapshot?.volume ?? readStoredVolume(),
            audioTracks: this.audioTracks(),
            selectedAudioTrackId: snapshot?.selectedAudioTrackId ?? null,
        };
    });

    readonly commands: PlayerControlsCommands = {
        togglePlay: () => void this.controller.togglePaused(),
        seekTo: (seconds) => void this.controller.seekTo(seconds),
        seekBy: (deltaSeconds) => void this.controller.seekBy(deltaSeconds),
        setVolume: (value) => void this.controller.applyVolume(value),
        setAudioTrack: (id) => void this.controller.setAudioTrack(id),
        // Phase 2+: subtitle tracks, playback speed, aspect override,
        // recording, and picture-in-picture all need real new Media3 API
        // surface (MediaDrm, a text renderer). Capabilities above already
        // report each as unsupported, so the shared controls never render a
        // button that reaches these no-ops.
        setSubtitleTrack: () => undefined,
        setPlaybackSpeed: () => undefined,
        setAspectRatio: () => undefined,
        toggleRecording: () => undefined,
        togglePictureInPicture: () => undefined,
    };

    configure(context: AndroidNativeControlsContext): void {
        this.configuredContext.set(context);
    }

    private resolveStatusMessage(
        snapshot: AndroidNativePlayerSnapshot | null
    ): string {
        if (!snapshot || snapshot.status === 'loading') {
            return this.translate.instant(
                'ANDROID_NATIVE_PLAYER.LOADING_STREAM'
            );
        }
        if (snapshot.status === 'error') {
            return (
                snapshot.error ||
                this.translate.instant('ANDROID_NATIVE_PLAYER.PLAYBACK_FAILED')
            );
        }
        return '';
    }
}
