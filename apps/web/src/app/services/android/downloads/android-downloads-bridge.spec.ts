import type { ElectronBridgeDownloadStartPayload } from '@iptvnator/shared/interfaces';
import type { AndroidDownloadsPlugin } from './android-downloads-plugin';
import {
    AndroidDownloadsBridgeController,
} from './android-downloads-bridge';
import type {
    DownloadRow,
    DownloadRowPatch,
    DownloadsDatabase,
    NewDownloadRow,
} from './downloads-database';

class FakeDownloadsDatabase {
    private nextId = 1;
    readonly rows = new Map<number, DownloadRow>();

    async insert(row: NewDownloadRow): Promise<number> {
        const id = this.nextId++;
        const now = '2026-08-02T00:00:00.000Z';
        this.rows.set(id, { ...row, id, createdAt: now, updatedAt: now });
        return id;
    }

    async update(id: number, patch: DownloadRowPatch): Promise<void> {
        const row = this.rows.get(id);
        if (row) this.rows.set(id, { ...row, ...patch });
    }

    async getAll(playlistId?: string): Promise<DownloadRow[]> {
        return [...this.rows.values()].filter(
            (row) => !playlistId || row.playlistId === playlistId
        );
    }

    async getById(id: number): Promise<DownloadRow | null> {
        return this.rows.get(id) ?? null;
    }

    async delete(ids: number[]): Promise<void> {
        for (const id of ids) this.rows.delete(id);
    }
}

const payload: ElectronBridgeDownloadStartPayload = {
    playlistId: 'playlist-1',
    xtreamId: 42,
    contentType: 'vod',
    title: 'Film: édition spéciale',
    url: 'https://provider.example/movie/42.mkv?token=redacted',
    posterUrl: 'https://provider.example/poster.jpg',
    downloadFolder: 'ignored-on-android',
    headers: {
        userAgent: 'IPTV client',
        referer: 'https://provider.example/',
    },
};

describe('AndroidDownloadsBridgeController', () => {
    let database: FakeDownloadsDatabase;
    let plugin: jest.Mocked<AndroidDownloadsPlugin>;
    let bridge: AndroidDownloadsBridgeController['bridge'];

    beforeEach(() => {
        database = new FakeDownloadsDatabase();
        plugin = {
            enqueue: jest.fn().mockResolvedValue({ id: 'native-7' }),
            queryStatuses: jest.fn().mockResolvedValue({ items: [] }),
            remove: jest.fn().mockResolvedValue(undefined),
        };
        bridge = new AndroidDownloadsBridgeController(
            database as unknown as DownloadsDatabase,
            plugin
        ).bridge;
    });

    it('persists metadata and starts DownloadManager with safe request data', async () => {
        await expect(bridge.downloadsStart(payload)).resolves.toEqual({
            success: true,
            id: 1,
        });

        expect(plugin.enqueue).toHaveBeenCalledWith({
            url: payload.url,
            fileName: 'Film_edition_speciale.mkv',
            title: payload.title,
            userAgent: 'IPTV client',
            referer: 'https://provider.example/',
            origin: undefined,
        });
        expect(database.rows.get(1)).toMatchObject({
            playlistId: 'playlist-1',
            xtreamId: 42,
            fileName: 'Film_edition_speciale.mkv',
            nativeId: 'native-7',
            status: 'downloading',
        });
    });

    it('surfaces enqueue failures while retaining a retryable row', async () => {
        plugin.enqueue.mockRejectedValueOnce(new Error('network unavailable'));

        await expect(bridge.downloadsStart(payload)).resolves.toEqual({
            success: false,
            id: 1,
            error: 'network unavailable',
        });
        expect(database.rows.get(1)).toMatchObject({
            status: 'failed',
            errorMessage: 'network unavailable',
            nativeId: null,
        });
    });

    it('maps DownloadManager completion into the shared download contract', async () => {
        await bridge.downloadsStart(payload);
        plugin.queryStatuses.mockResolvedValueOnce({
            items: [
                {
                    id: 'native-7',
                    status: 'successful',
                    reason: 0,
                    bytesDownloaded: 2048,
                    totalBytes: 2048,
                    localUri: 'file:///downloads/Film_edition_speciale.mkv',
                },
            ],
        });

        await expect(bridge.downloadsGetList()).resolves.toEqual([
            expect.objectContaining({
                id: 1,
                status: 'completed',
                bytesDownloaded: 2048,
                totalBytes: 2048,
                filePath: 'file:///downloads/Film_edition_speciale.mkv',
            }),
        ]);
    });

    it('implements manual pause by removing the native request and restarts cleanly', async () => {
        await bridge.downloadsStart(payload);

        await expect(bridge.downloadsPause(1)).resolves.toEqual({
            success: true,
        });
        expect(plugin.remove).toHaveBeenCalledWith({ ids: ['native-7'] });
        expect(database.rows.get(1)).toMatchObject({
            status: 'paused',
            nativeId: null,
            bytesDownloaded: 0,
            totalBytes: null,
        });

        plugin.enqueue.mockResolvedValueOnce({ id: 'native-8' });
        await expect(
            bridge.downloadsResume(1, 'ignored-on-android')
        ).resolves.toEqual({ success: true });
        expect(database.rows.get(1)).toMatchObject({
            status: 'downloading',
            nativeId: 'native-8',
        });
    });

    it('clears only terminal rows in the requested playlist', async () => {
        await bridge.downloadsStart(payload);
        await bridge.downloadsCancel(1);
        await bridge.downloadsStart({
            ...payload,
            playlistId: 'playlist-2',
            xtreamId: 43,
        });

        await expect(
            bridge.downloadsClearCompleted('playlist-1')
        ).resolves.toEqual({ success: true });
        expect(database.rows.has(1)).toBe(false);
        expect(database.rows.has(2)).toBe(true);
    });
});
