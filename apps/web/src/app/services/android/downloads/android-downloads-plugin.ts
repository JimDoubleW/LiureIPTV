import { registerPlugin } from '@capacitor/core';

export interface AndroidDownloadsEnqueueOptions {
    url: string;
    fileName: string;
    title?: string;
    mimeType?: string;
    userAgent?: string;
    referer?: string;
    origin?: string;
}

export interface AndroidDownloadsEnqueueResult {
    /** DownloadManager's own row id, as a string — see the plugin's doc comment. */
    id: string;
}

export type AndroidDownloadsNativeStatus =
    | 'pending'
    | 'running'
    | 'paused'
    | 'successful'
    | 'failed'
    | 'unknown';

export interface AndroidDownloadsStatusItem {
    id: string;
    status: AndroidDownloadsNativeStatus;
    /** Android's own `DownloadManager.COLUMN_REASON` code. */
    reason: number;
    bytesDownloaded: number;
    totalBytes: number | null;
    /** `file://…` (occasionally `content://…`) once known; null otherwise. */
    localUri: string | null;
}

export interface AndroidDownloadsQueryResult {
    items: AndroidDownloadsStatusItem[];
}

/**
 * Native counterpart: `AndroidDownloadsPlugin.java`. See its doc comment for
 * why this wraps `DownloadManager` instead of a custom resumable engine.
 */
export interface AndroidDownloadsPlugin {
    enqueue(
        options: AndroidDownloadsEnqueueOptions
    ): Promise<AndroidDownloadsEnqueueResult>;
    queryStatuses(options: {
        ids: string[];
    }): Promise<AndroidDownloadsQueryResult>;
    remove(options: { ids: string[] }): Promise<void>;
}

export const ANDROID_DOWNLOADS_PLUGIN = registerPlugin<AndroidDownloadsPlugin>(
    'AndroidDownloads'
);
