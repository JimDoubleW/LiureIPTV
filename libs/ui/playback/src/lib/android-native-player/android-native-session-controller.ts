import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
    AndroidNativePlayerBounds,
    AndroidNativePlayerSnapshot,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { measureBounds } from './android-native-bounds.utils';
import { AndroidNativeCommandRunner } from './android-native-command-runner';
import { ANDROID_NATIVE_PLAYER_PLUGIN } from './android-native-player.plugin';
import {
    createErrorSnapshot,
    createLoadingSnapshot,
} from './android-native-session-factory';

export type AndroidNativePlayerBoundsProvider = (
    host: HTMLElement
) => AndroidNativePlayerBounds;

/**
 * Owns the ExoPlayer session lifecycle (create/load/dispose) and the
 * bounds-sync loop that keeps the native SurfaceView positioned under the
 * host element. Mirrors `EmbeddedMpvSessionController` — same bounds-sync
 * machinery (rAF-coalesced ResizeObserver + resize + scroll + a re-armed
 * `matchMedia` DPR watch), same "subscribe once in the constructor, manage
 * sessions repeatedly via startSession()" shape.
 *
 * The native surface is composited behind the WebView, so it is only visible
 * where the DOM paints nothing — `AndroidNativePlayerComponent` owns that
 * half. See `NativePlayerSurface.java`'s doc comment.
 */
@Injectable()
export class AndroidNativeSessionController {
    private readonly plugin = inject(ANDROID_NATIVE_PLAYER_PLUGIN);
    private readonly destroyRef = inject(DestroyRef);

    readonly snapshot = signal<AndroidNativePlayerSnapshot | null>(null);
    readonly sessionId = signal<string | null>(null);

    private readonly commands = new AndroidNativeCommandRunner(this.plugin, {
        sessionId: this.sessionId,
        snapshot: this.snapshot,
    });

    private boundsProvider: AndroidNativePlayerBoundsProvider = (host) =>
        measureBounds(host);
    private activeBoundsSync: (() => void) | null = null;
    private boundsAnimationFrame: number | null = null;
    private unsubscribeStatus: (() => void) | null = null;

    constructor() {
        void this.plugin
            .addListener('nativePlayerStatus', (update) => {
                if (update.id !== this.sessionId()) {
                    return;
                }
                this.snapshot.set(update);
            })
            .then((handle) => {
                this.unsubscribeStatus = () => void handle.remove();
            });

        this.destroyRef.onDestroy(() => {
            this.unsubscribeStatus?.();
            if (this.boundsAnimationFrame !== null) {
                cancelAnimationFrame(this.boundsAnimationFrame);
                this.boundsAnimationFrame = null;
            }
        });
    }

    setBoundsProvider(provider: AndroidNativePlayerBoundsProvider): void {
        this.boundsProvider = provider;
    }

    triggerBoundsSync(): void {
        this.activeBoundsSync?.();
    }

    // Transport commands delegate to the command runner. Bound fields keep
    // the public API stable regardless of the runner's own construction.
    readonly togglePaused = (): Promise<void> => this.commands.togglePaused();
    readonly seekTo = (seconds: number): Promise<void> =>
        this.commands.seekTo(seconds);
    readonly seekBy = (deltaSeconds: number): Promise<boolean> =>
        this.commands.seekBy(deltaSeconds);
    readonly applyVolume = (value: number): Promise<void> =>
        this.commands.applyVolume(value);
    readonly setAudioTrack = (trackId: number): Promise<void> =>
        this.commands.setAudioTrack(trackId);

    /**
     * Spin up a native session bound to `host`. Returns a teardown the
     * caller invokes when host/playback changes or the component tears down.
     */
    startSession(
        host: HTMLElement,
        playback: ResolvedPortalPlayback,
        initialVolume: number
    ): () => void {
        let disposed = false;
        let activeSessionId: string | null = null;

        const syncBounds = () => {
            if (!activeSessionId) {
                return;
            }
            void this.plugin
                .setBounds({
                    id: activeSessionId,
                    bounds: this.boundsProvider(host),
                    devicePixelRatio: window.devicePixelRatio || 1,
                })
                .catch(() => undefined);
        };

        const scheduleBoundsSync = () => {
            if (this.boundsAnimationFrame !== null) {
                cancelAnimationFrame(this.boundsAnimationFrame);
            }
            this.boundsAnimationFrame = requestAnimationFrame(() => {
                this.boundsAnimationFrame = null;
                syncBounds();
            });
        };

        this.activeBoundsSync = scheduleBoundsSync;

        const resizeObserver = new ResizeObserver(() => scheduleBoundsSync());
        resizeObserver.observe(host);
        window.addEventListener('resize', scheduleBoundsSync);
        window.addEventListener('scroll', scheduleBoundsSync, true);

        // Page zoom and monitor DPI rescale the CSS→device-pixel mapping the
        // native plugin applies to these bounds. Moving the window to a
        // display with a different scale can keep the CSS layout identical
        // (no resize, no ResizeObserver), so watch devicePixelRatio through
        // a re-armed matchMedia query and re-sync when it changes.
        let detachDprWatch: (() => void) | null = null;
        const watchDevicePixelRatio = () => {
            detachDprWatch?.();
            detachDprWatch = null;
            const query = window.matchMedia?.(
                `(resolution: ${window.devicePixelRatio}dppx)`
            );
            if (!query) {
                return;
            }
            const onChange = () => {
                watchDevicePixelRatio();
                scheduleBoundsSync();
            };
            query.addEventListener('change', onChange);
            detachDprWatch = () =>
                query.removeEventListener('change', onChange);
        };
        watchDevicePixelRatio();

        const create = async () => {
            this.snapshot.set(createLoadingSnapshot(playback, initialVolume));

            const created = await this.plugin.create({
                bounds: this.boundsProvider(host),
                devicePixelRatio: window.devicePixelRatio || 1,
                title: playback.title,
                volume: initialVolume,
            });

            if (disposed) {
                await this.plugin
                    .dispose({ id: created.id })
                    .catch(() => undefined);
                return;
            }

            activeSessionId = created.id;
            this.sessionId.set(created.id);

            await this.plugin.load({
                id: created.id,
                url: playback.streamUrl,
                isLive: playback.isLive,
                startSeconds: playback.startTime,
                headers: playback.headers,
                userAgent: playback.userAgent,
            });

            if (disposed) {
                return;
            }
            scheduleBoundsSync();
        };

        void create().catch((error) => {
            // A rejection can land after teardown (fast channel zapping):
            // writing the error snapshot then would clobber the state of
            // the session that replaced this one and null its sessionId.
            if (disposed) {
                return;
            }
            this.sessionId.set(null);
            this.snapshot.set(
                createErrorSnapshot(playback, initialVolume, error)
            );
        });

        return () => {
            disposed = true;
            resizeObserver.disconnect();
            window.removeEventListener('resize', scheduleBoundsSync);
            window.removeEventListener('scroll', scheduleBoundsSync, true);
            detachDprWatch?.();
            detachDprWatch = null;

            if (this.activeBoundsSync === scheduleBoundsSync) {
                this.activeBoundsSync = null;
            }
            if (this.boundsAnimationFrame !== null) {
                cancelAnimationFrame(this.boundsAnimationFrame);
                this.boundsAnimationFrame = null;
            }

            const id = activeSessionId;
            activeSessionId = null;
            this.sessionId.set(null);
            this.snapshot.set(null);

            if (id) {
                // `ExoPlayer.release()` can block for several seconds while a
                // large content:// source is being torn down. Pause in its
                // own bridge call first so audio stops before that expensive
                // release begins; otherwise the WebView has already returned
                // to the catalogue while the movie remains audible.
                void this.plugin
                    .pause({ id })
                    .catch(() => undefined)
                    .then(() => this.plugin.dispose({ id }))
                    .catch(() => undefined);
            }
        };
    }
}
