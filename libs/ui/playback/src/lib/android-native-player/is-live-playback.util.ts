import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';

/**
 * Live or on-demand, for a playback request that may not say so outright.
 *
 * `contentInfo` is the fallback signal because it identifies a catalog item —
 * a movie or an episode. A live channel has no catalog identity, so its
 * absence means live. Both the controls adapter (which hides the scrubber) and
 * the host (which sends on-demand playback straight to fullscreen) must agree,
 * or the two would disagree about the same session.
 */
export function isLivePlayback(playback: ResolvedPortalPlayback): boolean {
    if (typeof playback.isLive === 'boolean') {
        return playback.isLive;
    }
    return !playback.contentInfo;
}
