import type {
    ElectronBridgeApi,
    ElectronBridgeDownloadStartPayload,
    ElectronDownloadItem,
} from '@iptvnator/shared/interfaces';
import { isAndroidRuntime } from '../android-runtime';
import {
    ANDROID_DOWNLOADS_PLUGIN,
    type AndroidDownloadsPlugin,
    type AndroidDownloadsStatusItem,
} from './android-downloads-plugin';
import {
    DownloadsDatabase,
    type DownloadRow,
    type DownloadRowPatch,
    type NewDownloadRow,
} from './downloads-database';

type AndroidDownloadsBridge = Pick<
    ElectronBridgeApi,
    | 'downloadsStart'
    | 'downloadsCancel'
    | 'downloadsPause'
    | 'downloadsResume'
    | 'downloadsRetry'
    | 'downloadsRemove'
    | 'downloadsGetList'
    | 'downloadsGet'
    | 'downloadsGetDefaultFolder'
    | 'downloadsSelectFolder'
    | 'downloadsRevealFile'
    | 'downloadsPlayFile'
    | 'downloadsClearCompleted'
    | 'onDownloadsUpdate'
>;

const ACTIVE_STATUSES = new Set(['queued', 'downloading']);
const CLEARABLE_STATUSES = new Set(['completed', 'failed', 'canceled']);
const DOWNLOAD_FOLDER_LABEL = 'Android app downloads';
const POLL_INTERVAL_MS = 1000;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function extensionFromUrl(url: string): string {
    try {
        const path = new URL(url).pathname;
        const match = path.match(/\.([a-z0-9]{1,8})$/i);
        return match ? `.${match[1].toLowerCase()}` : '.mp4';
    } catch {
        return '.mp4';
    }
}

function safeFileName(data: ElectronBridgeDownloadStartPayload): string {
    const title = data.title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w.-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96);
    const episode =
        data.contentType === 'episode'
            ? `_S${String(data.seasonNumber ?? 0).padStart(2, '0')}E${String(
                  data.episodeNumber ?? 0
              ).padStart(2, '0')}`
            : '';
    return `${title || `download-${data.xtreamId}`}${episode}${extensionFromUrl(
        data.url
    )}`;
}

function toElectronItem(row: DownloadRow): ElectronDownloadItem {
    return {
        id: row.id,
        playlistId: row.playlistId,
        xtreamId: row.xtreamId,
        contentType: row.contentType,
        ...(row.seriesXtreamId == null
            ? {}
            : { seriesXtreamId: row.seriesXtreamId }),
        ...(row.seasonNumber == null
            ? {}
            : { seasonNumber: row.seasonNumber }),
        ...(row.episodeNumber == null
            ? {}
            : { episodeNumber: row.episodeNumber }),
        title: row.title,
        url: row.url,
        ...(row.fileName ? { fileName: row.fileName } : {}),
        ...(row.filePath ? { filePath: row.filePath } : {}),
        ...(row.posterUrl ? { posterUrl: row.posterUrl } : {}),
        status: row.status as ElectronDownloadItem['status'],
        ...(row.bytesDownloaded == null
            ? {}
            : { bytesDownloaded: row.bytesDownloaded }),
        ...(row.totalBytes == null ? {} : { totalBytes: row.totalBytes }),
        ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function nativeStatusPatch(item: AndroidDownloadsStatusItem) {
    switch (item.status) {
        case 'pending':
            return { status: 'queued', errorMessage: null };
        case 'running':
            return { status: 'downloading', errorMessage: null };
        case 'paused':
            return {
                status: 'downloading',
                errorMessage: `Android paused the transfer (${item.reason})`,
            };
        case 'exporting':
            return {
                status: 'downloading',
                errorMessage: 'Copying into the selected folder',
            };
        case 'successful':
            return {
                status: 'completed',
                errorMessage: null,
                filePath: item.localUri,
            };
        case 'failed':
            return {
                status: 'failed',
                errorMessage:
                    item.errorMessage ??
                    `Android download failed (${item.reason})`,
            };
        default:
            return {
                status: 'failed',
                errorMessage: 'Android download status is unknown',
            };
    }
}

export class AndroidDownloadsBridgeController {
    private readonly listeners = new Set<() => void>();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private refreshing: Promise<void> | null = null;

    constructor(
        private readonly database: DownloadsDatabase = new DownloadsDatabase(),
        private readonly plugin: AndroidDownloadsPlugin = ANDROID_DOWNLOADS_PLUGIN
    ) {}

    readonly bridge: AndroidDownloadsBridge = {
        downloadsStart: (data) => this.start(data),
        downloadsCancel: (id) => this.stop(id, 'canceled'),
        downloadsPause: (id) => this.stop(id, 'paused'),
        downloadsResume: (id) => this.restart(id),
        downloadsRetry: (id) => this.restart(id),
        downloadsRemove: (id) => this.remove(id),
        downloadsGetList: async (playlistId) => {
            await this.refresh();
            return (await this.database.getAll(playlistId)).map(toElectronItem);
        },
        downloadsGet: async (id) => {
            await this.refresh();
            const row = await this.database.getById(id);
            return row ? toElectronItem(row) : null;
        },
        downloadsGetDefaultFolder: async () => {
            const folder = await this.plugin.getSelectedFolder();
            return folder.label ?? DOWNLOAD_FOLDER_LABEL;
        },
        downloadsSelectFolder: async () => {
            const folder = await this.plugin.selectFolder();
            return folder.uri ? folder.label ?? DOWNLOAD_FOLDER_LABEL : null;
        },
        downloadsRevealFile: () =>
            Promise.resolve({
                success: false,
                error: 'Android TV has no supported file-manager action',
            }),
        downloadsPlayFile: () =>
            Promise.resolve({
                success: false,
                error: 'Open the downloaded title from its library page',
            }),
        downloadsClearCompleted: (playlistId) => this.clear(playlistId),
        onDownloadsUpdate: (callback) => this.subscribe(callback),
    };

    private async start(data: ElectronBridgeDownloadStartPayload) {
        const fileName = safeFileName(data);
        const row: NewDownloadRow = {
            playlistId: data.playlistId,
            xtreamId: data.xtreamId,
            contentType: data.contentType,
            seriesXtreamId: data.seriesXtreamId ?? null,
            seasonNumber: data.seasonNumber ?? null,
            episodeNumber: data.episodeNumber ?? null,
            title: data.title,
            url: data.url,
            fileName,
            filePath: null,
            posterUrl: data.posterUrl ?? null,
            status: 'queued',
            bytesDownloaded: 0,
            totalBytes: null,
            errorMessage: null,
            nativeId: null,
            userAgent: data.headers?.userAgent ?? null,
            referer: data.headers?.referer ?? null,
            origin: data.headers?.origin ?? null,
        };
        const id = await this.database.insert(row);

        try {
            const native = await this.plugin.enqueue({
                url: data.url,
                fileName,
                title: data.title,
                userAgent: data.headers?.userAgent,
                referer: data.headers?.referer,
                origin: data.headers?.origin,
            });
            await this.database.update(id, {
                nativeId: native.id,
                status: 'downloading',
            });
            this.emit();
            return { success: true, id };
        } catch (error) {
            await this.database.update(id, {
                status: 'failed',
                errorMessage: errorMessage(error),
            });
            this.emit();
            return { success: false, id, error: errorMessage(error) };
        }
    }

    private async stop(id: number, status: 'paused' | 'canceled') {
        const row = await this.database.getById(id);
        if (!row) return { success: false, error: 'Download not found' };

        try {
            if (row.nativeId) {
                await this.plugin.remove({ ids: [row.nativeId] });
            }
            await this.database.update(id, {
                status,
                nativeId: null,
                bytesDownloaded: status === 'paused' ? 0 : row.bytesDownloaded,
                totalBytes: status === 'paused' ? null : row.totalBytes,
                errorMessage: null,
            });
            this.emit();
            return { success: true };
        } catch (error) {
            return { success: false, error: errorMessage(error) };
        }
    }

    private async restart(id: number) {
        const row = await this.database.getById(id);
        if (!row) return { success: false, error: 'Download not found' };

        try {
            const native = await this.plugin.enqueue({
                url: row.url,
                fileName: row.fileName ?? safeFileName(toStartPayload(row)),
                title: row.title,
                userAgent: row.userAgent ?? undefined,
                referer: row.referer ?? undefined,
                origin: row.origin ?? undefined,
            });
            await this.database.update(id, {
                nativeId: native.id,
                status: 'downloading',
                bytesDownloaded: 0,
                totalBytes: null,
                filePath: null,
                errorMessage: null,
            });
            this.emit();
            return { success: true };
        } catch (error) {
            await this.database.update(id, {
                status: 'failed',
                errorMessage: errorMessage(error),
            });
            this.emit();
            return { success: false, error: errorMessage(error) };
        }
    }

    private async remove(id: number) {
        const row = await this.database.getById(id);
        if (!row) return { success: true };
        try {
            if (row.nativeId) {
                await this.plugin.remove({ ids: [row.nativeId] });
            }
            await this.database.delete([id]);
            this.emit();
            return { success: true };
        } catch (error) {
            return { success: false, error: errorMessage(error) };
        }
    }

    private async clear(playlistId?: string) {
        const rows = (await this.database.getAll(playlistId)).filter((row) =>
            CLEARABLE_STATUSES.has(row.status)
        );
        const nativeIds = rows
            .map((row) => row.nativeId)
            .filter((id): id is string => !!id);
        try {
            if (nativeIds.length) await this.plugin.remove({ ids: nativeIds });
            await this.database.delete(rows.map((row) => row.id));
            this.emit();
            return { success: true };
        } catch (error) {
            return { success: false, error: errorMessage(error) };
        }
    }

    private async refresh(): Promise<void> {
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.refreshActive().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }

    private async refreshActive(): Promise<void> {
        const rows = (await this.database.getAll()).filter(
            (row) => ACTIVE_STATUSES.has(row.status) && row.nativeId
        );
        if (!rows.length) return;

        const result = await this.plugin.queryStatuses({
            ids: rows.map((row) => row.nativeId as string),
        });
        const byNativeId = new Map(rows.map((row) => [row.nativeId, row]));
        let changed = false;
        for (const item of result.items) {
            const row = byNativeId.get(item.id);
            if (!row) continue;
            const patch: DownloadRowPatch = {
                ...nativeStatusPatch(item),
                bytesDownloaded: item.bytesDownloaded,
                totalBytes: item.totalBytes,
            };
            const rowChanged = Object.entries(patch).some(
                ([key, value]) => row[key as keyof DownloadRow] !== value
            );
            if (!rowChanged) continue;
            await this.database.update(row.id, patch);
            changed = true;
        }
        if (changed) this.emit();
    }

    private subscribe(callback: () => void): () => void {
        this.listeners.add(callback);
        if (!this.pollTimer) {
            this.pollTimer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
        }
        return () => {
            this.listeners.delete(callback);
            if (this.listeners.size === 0 && this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        };
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

function toStartPayload(row: DownloadRow): ElectronBridgeDownloadStartPayload {
    return {
        playlistId: row.playlistId,
        xtreamId: row.xtreamId,
        contentType: row.contentType,
        title: row.title,
        url: row.url,
        downloadFolder: DOWNLOAD_FOLDER_LABEL,
        seasonNumber: row.seasonNumber ?? undefined,
        episodeNumber: row.episodeNumber ?? undefined,
    };
}

export function installAndroidDownloadsBridge(): void {
    if (!isAndroidRuntime()) return;
    const existing = (window.electron ?? {}) as Partial<ElectronBridgeApi>;
    Object.assign(existing, new AndroidDownloadsBridgeController().bridge);
    (window as { electron?: unknown }).electron = existing;
}
