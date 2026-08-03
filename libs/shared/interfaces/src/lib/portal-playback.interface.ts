import { ChannelDrm } from './channel-drm.interface';
import { PlaybackPositionData } from './playback-position.interface';

export interface PlayerContentInfo extends Omit<
    PlaybackPositionData,
    'positionSeconds' | 'durationSeconds' | 'updatedAt'
> {
    playlistId: string;
}

export interface ResolvedPortalPlayback {
    streamUrl: string;
    title: string;
    thumbnail?: string | null;
    isLive?: boolean;
    /**
     * Optional host-layout hint. Catch-up is seekable (`isLive=false`) but
     * still belongs in the Live TV layout beside its EPG.
     */
    presentation?: 'inline' | 'fullscreen';
    startTime?: number;
    contentInfo?: PlayerContentInfo;
    headers?: Record<string, string>;
    userAgent?: string;
    referer?: string;
    origin?: string;
    drm?: ChannelDrm;
}
