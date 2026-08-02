import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    computed,
    effect,
    inject,
    input,
    output,
    viewChild,
} from '@angular/core';
import {
    AndroidNativePlayerSnapshot,
    NATIVE_VIDEO_PUNCH_THROUGH_CLASS,
    ResolvedPortalPlayback,
    TV_FULLSCREEN_ATTRIBUTE,
    TV_FULLSCREEN_LOCKED_ATTRIBUTE,
} from '@iptvnator/shared/interfaces';
import { PlayerControlsComponent } from '../player-controls/player-controls.component';
import type { PlayerMediaTitle } from '../player-controls/player-controls.model';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import { persistVolume, readStoredVolume } from './android-native-bounds.utils';
import { AndroidNativeControlsAdapter } from './android-native-controls.adapter';
import { AndroidNativeSessionController } from './android-native-session-controller';
import { isLivePlayback } from './is-live-playback.util';

/**
 * Host for the native Android video engine (ExoPlayer/Media3 behind
 * `AndroidNativePlayerPlugin.java`). `#surfaceHost` renders nothing of its
 * own — it is a positioning placeholder the native SurfaceView is bounds-
 * synced against (see `NativePlayerSurface.java` and the component's
 * stylesheet). Real video pixels never touch the DOM; only bounds requests
 * and status snapshots cross the bridge.
 *
 * The surface is composited behind the WebView, so this component also owns
 * the DOM half of the punch-through: `.native-video-punchthrough` on
 * `<html>` for the session's lifetime, which stops the workspace shell from
 * painting over the player's rect.
 *
 * `seriesNavigation` is accepted for parity with every other engine's host
 * binding in `web-player-view.component.html`, but unused in phase 1 — the
 * `seriesNavigation` capability stays false until a later phase.
 */
@Component({
    selector: 'app-android-native-player',
    templateUrl: './android-native-player.component.html',
    styleUrl: './android-native-player.component.scss',
    imports: [PlayerControlsComponent],
    providers: [AndroidNativeControlsAdapter, AndroidNativeSessionController],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        class: 'android-native-player-host',
    },
})
export class AndroidNativePlayerComponent {
    readonly playback = input.required<ResolvedPortalPlayback>();
    readonly showControls = input(true);
    readonly mediaTitle = input<PlayerMediaTitle | null>(null);
    readonly seriesNavigation = input<SeriesPlaybackNavigation | null>(null);

    readonly timeUpdate = output<{ currentTime: number; duration: number }>();
    readonly playbackEnded = output<void>();
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    // Named distinctly from the `#surfaceHost` template reference variable
    // it queries — a class field sharing the exact template-ref name
    // resolves to the *template-local* reference inside that template's own
    // expressions (a real Angular gotcha), not this signal.
    private readonly surfaceHostRef =
        viewChild<ElementRef<HTMLDivElement>>('surfaceHost');
    readonly playerSurfaceElement = computed<HTMLElement | null>(
        () => this.surfaceHostRef()?.nativeElement ?? null
    );

    private readonly controller = inject(AndroidNativeSessionController);
    readonly sharedControls = inject(AndroidNativeControlsAdapter);

    private lastEmittedStatus: string | null = null;

    constructor() {
        this.sharedControls.configure({ playback: this.playback });

        effect((onCleanup) => {
            const host = this.surfaceHostRef();
            const playback = this.playback();

            if (!host || !playback.streamUrl) {
                return;
            }

            // Native video is composited BEHIND the WebView, so it only
            // shows through pixels the DOM leaves fully transparent. The
            // workspace shell's three containers otherwise paint over the
            // player's rect — see workspace-shell.component.scss. Scoped to
            // the session because it makes the app's own backgrounds
            // transparent app-wide, revealing the (black) window behind.
            const root = document.documentElement;
            root.classList.add(NATIVE_VIDEO_PUNCH_THROUGH_CLASS);

            // Live plays inline next to its channel list, whose panels carry
            // their own backgrounds. Movies and series play inside the detail
            // page's theater stage, which stacks four opaque layers over the
            // player's rect — nothing composited behind the WebView can show
            // through it — so those go straight to the locked fullscreen
            // layout, where the shell is blanked and nothing paints over the
            // video. See TV_FULLSCREEN_LOCKED_ATTRIBUTE.
            const lockFullscreen = !isLivePlayback(playback);
            if (lockFullscreen) {
                root.setAttribute(TV_FULLSCREEN_ATTRIBUTE, '');
                root.setAttribute(TV_FULLSCREEN_LOCKED_ATTRIBUTE, '');
            }

            const teardown = this.controller.startSession(
                host.nativeElement,
                playback,
                readStoredVolume()
            );
            onCleanup(() => {
                root.classList.remove(NATIVE_VIDEO_PUNCH_THROUGH_CLASS);
                if (lockFullscreen) {
                    root.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
                    root.removeAttribute(TV_FULLSCREEN_LOCKED_ATTRIBUTE);
                }
                teardown();
            });
        });

        effect(() => {
            const snapshot = this.controller.snapshot();
            if (snapshot) {
                this.reactToSnapshot(snapshot);
            }
        });
    }

    private reactToSnapshot(snapshot: AndroidNativePlayerSnapshot): void {
        persistVolume(snapshot.volume);

        this.timeUpdate.emit({
            currentTime: snapshot.positionSeconds,
            duration: snapshot.durationSeconds ?? 0,
        });

        if (
            snapshot.status === 'ended' &&
            this.lastEmittedStatus !== 'ended'
        ) {
            this.playbackEnded.emit();
        }
        this.lastEmittedStatus = snapshot.status;
    }
}
