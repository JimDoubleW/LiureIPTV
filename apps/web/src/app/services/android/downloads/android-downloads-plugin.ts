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
    | 'exporting'
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
    /** Present when DownloadManager succeeded but export to the SAF folder failed. */
    errorMessage?: string;
}

export interface AndroidDownloadsQueryResult {
    items: AndroidDownloadsStatusItem[];
}

export interface AndroidDownloadsFolderResult {
    /** Persisted SAF document-tree URI, or null for the app-private default. */
    uri: string | null;
    /** Human-readable folder name shown in the Downloads screen. */
    label: string | null;
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
    selectFolder(): Promise<AndroidDownloadsFolderResult>;
    getSelectedFolder(): Promise<AndroidDownloadsFolderResult>;
}

export const ANDROID_DOWNLOADS_PLUGIN = registerPlugin<AndroidDownloadsPlugin>(
    'AndroidDownloads'
);
