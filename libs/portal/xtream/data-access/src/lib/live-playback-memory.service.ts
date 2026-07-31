import { Injectable, signal } from '@angular/core';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

/**
 * Remembers what the live view was playing, across route changes.
 *
 * The live layout is a routed component, so its playback signal died with it:
 * leaving Live TV for Movies and coming back left an empty player and no way to
 * get the channel back short of finding it in the list again. Holding the
 * signal in a root-provided service instead lets the layout pick up where it
 * left off, which is what a TV remote user expects — and what makes the
 * navigation feel like it kept your place rather than resetting.
 *
 * The playlist id is stored alongside, because the same component serves every
 * Xtream portal: resuming a stream from a different provider would at best play
 * the wrong channel and at worst hit a dead URL.
 */
@Injectable({ providedIn: 'root' })
export class LivePlaybackMemoryService {
    /**
     * Exposed as the writable signal the layout already used, so the component
     * keeps calling `.set()` exactly as before.
     */
    readonly playback = signal<ResolvedPortalPlayback | null>(null);

    private playlistId: string | null = null;

    /** Records which portal the remembered playback belongs to. */
    remember(playlistId: string | null | undefined): void {
        this.playlistId = playlistId ?? null;
    }

    /**
     * Drops the memory when the portal has changed, so a stale stream is never
     * resumed against the wrong provider.
     */
    forgetIfOtherPlaylist(playlistId: string | null | undefined): void {
        if ((playlistId ?? null) !== this.playlistId) {
            this.playback.set(null);
            this.playlistId = playlistId ?? null;
        }
    }
}
