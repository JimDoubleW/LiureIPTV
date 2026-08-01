import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { of } from 'rxjs';
import { DatabaseService, PlaylistsService } from '@iptvnator/services';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';
import { withRecentItems } from './with-recent-items';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const TestRecentItemsStore = signalStore(withRecentItems());

describe('withRecentItems', () => {
    const originalElectron = window.electron;
    let store: InstanceType<typeof TestRecentItemsStore>;
    let databaseService: {
        clearGlobalRecentlyViewed: jest.Mock;
        clearPlaylistRecentItems: jest.Mock;
        getContentByXtreamId: jest.Mock;
        getRecentItems: jest.Mock;
        removeRecentItem: jest.Mock;
        setContentBackdropIfMissing: jest.Mock;
    };
    let dataSource: {
        addRecentItem: jest.Mock;
        clearRecentItems: jest.Mock;
        getContentByXtreamId: jest.Mock;
        getRecentItems: jest.Mock;
        removeRecentItem: jest.Mock;
        setContentBackdropIfMissing: jest.Mock;
    };
    let playlistsService: {
        clearPlaylistRecentlyViewed: jest.Mock;
        getAllPlaylists: jest.Mock;
    };

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            value: {} as Window['electron'],
            configurable: true,
        });

        databaseService = {
            clearGlobalRecentlyViewed: jest.fn().mockResolvedValue(undefined),
            clearPlaylistRecentItems: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn(),
            getRecentItems: jest.fn().mockResolvedValue([
                {
                    id: 3941697,
                    title: 'Krypton',
                    type: 'series',
                    poster_url: 'https://example.com/krypton.png',
                    backdrop_url: 'https://example.com/krypton-backdrop.png',
                    viewed_at: '2026-04-21T20:42:27.000Z',
                    xtream_id: 290,
                    category_id: 17,
                },
            ]),
            removeRecentItem: jest.fn().mockResolvedValue(undefined),
            setContentBackdropIfMissing: jest.fn().mockResolvedValue(undefined),
        };
        dataSource = {
            addRecentItem: jest.fn().mockResolvedValue(undefined),
            clearRecentItems: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn(),
            getRecentItems: jest.fn().mockResolvedValue([
                {
                    id: 3941697,
                    title: 'Krypton',
                    type: 'series',
                    poster_url: 'https://example.com/krypton.png',
                    backdrop_url: 'https://example.com/krypton-backdrop.png',
                    viewed_at: '2026-04-21T20:42:27.000Z',
                    xtream_id: 290,
                    category_id: 17,
                },
            ]),
            removeRecentItem: jest.fn().mockResolvedValue(undefined),
            setContentBackdropIfMissing: jest.fn().mockResolvedValue(undefined),
        };
        playlistsService = {
            clearPlaylistRecentlyViewed: jest
                .fn()
                .mockReturnValue(of(undefined)),
            getAllPlaylists: jest.fn().mockReturnValue(of([])),
        };

        TestBed.configureTestingModule({
            providers: [
                TestRecentItemsStore,
                {
                    provide: DatabaseService,
                    useValue: databaseService,
                },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: dataSource,
                },
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
            ],
        });

        store = TestBed.inject(TestRecentItemsStore);
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    it('looks recent items up with the requested content type before saving one', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            undefined
        );
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
                type: 'series',
                xtream_id: 290,
                backdrop_url: 'https://example.com/krypton-backdrop.png',
            }),
        ]);
    });

    it('uses the Xtream ID as the PWA recent key when cached content is cold', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        store.addRecentItem({
            xtreamId: 1767451,
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            undefined
        );
        expect(databaseService.getRecentItems).not.toHaveBeenCalled();
    });

    it('normalizes route-param Xtream IDs before using the PWA recent fallback', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        dataSource.getContentByXtreamId.mockResolvedValue(null);

        store.addRecentItem({
            xtreamId: '1767451',
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            'movie'
        );
        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            undefined
        );
    });

    it('forwards backdrop urls on recent-item saves', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        store.addRecentItem({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            backdropUrl: 'https://example.com/krypton-backdrop.png',
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            'https://example.com/krypton-backdrop.png'
        );
    });

    it('backfills a backdrop without rewriting recent ordering', async () => {
        dataSource.getContentByXtreamId.mockResolvedValue({
            id: 3941697,
            title: 'Krypton',
            type: 'series',
            xtream_id: 290,
        });

        await store.backfillContentBackdrop({
            xtreamId: 290,
            contentType: 'series',
            playlist: signal({ id: 'playlist-1' }),
            backdropUrl: ' https://example.com/krypton-backdrop.png ',
        });

        expect(dataSource.getContentByXtreamId).toHaveBeenCalledWith(
            290,
            'playlist-1',
            'series'
        );
        expect(dataSource.setContentBackdropIfMissing).toHaveBeenCalledWith(
            3941697,
            'playlist-1',
            'https://example.com/krypton-backdrop.png'
        );
        expect(dataSource.addRecentItem).not.toHaveBeenCalled();
        expect(databaseService.getContentByXtreamId).not.toHaveBeenCalled();
        expect(
            databaseService.setContentBackdropIfMissing
        ).not.toHaveBeenCalled();
    });

    it('clears recent items through the active data source in PWA', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });

        store.clearRecentItems({ id: 'playlist-1' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.clearRecentItems).toHaveBeenCalledWith('playlist-1');
        expect(databaseService.clearPlaylistRecentItems).not.toHaveBeenCalled();
        expect(store.recentItems()).toEqual([]);
    });

    it('clears Xtream recent items during global PWA clear', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });
        playlistsService.getAllPlaylists.mockReturnValue(
            of([
                {
                    _id: 'xtream-1',
                    serverUrl: 'https://xtream.example.com',
                },
                {
                    _id: 'm3u-1',
                },
                {
                    _id: 'stalker-1',
                    serverUrl: 'https://stalker.example.com',
                    macAddress: '00:11:22:33:44:55',
                },
            ])
        );

        await store.clearGlobalRecentlyViewed();

        expect(
            databaseService.clearGlobalRecentlyViewed
        ).not.toHaveBeenCalled();
        expect(dataSource.clearRecentItems).toHaveBeenCalledWith('xtream-1');
        expect(
            playlistsService.clearPlaylistRecentlyViewed
        ).toHaveBeenCalledWith('m3u-1');
        expect(
            playlistsService.clearPlaylistRecentlyViewed
        ).toHaveBeenCalledWith('stalker-1');
        expect(
            playlistsService.clearPlaylistRecentlyViewed
        ).not.toHaveBeenCalledWith('xtream-1');
        expect(store.recentItems()).toEqual([]);
    });

    it('removes recent items through the active data source in PWA', async () => {
        Object.defineProperty(window, 'electron', {
            value: undefined,
            configurable: true,
        });

        store.removeRecentItem({ itemId: 3941697, playlistId: 'playlist-1' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.removeRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1'
        );
        expect(databaseService.removeRecentItem).not.toHaveBeenCalled();
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
            }),
        ]);
    });

    it('removes recent items through the active data source in Electron mode', async () => {
        store.removeRecentItem({ itemId: 3941697, playlistId: 'playlist-1' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.removeRecentItem).toHaveBeenCalledWith(
            3941697,
            'playlist-1'
        );
        expect(databaseService.removeRecentItem).not.toHaveBeenCalled();
        expect(store.recentItems()).toEqual([
            expect.objectContaining({
                id: 3941697,
                title: 'Krypton',
            }),
        ]);
    });
});

describe('withRecentItems on the Android partial bridge', () => {
    // window.electron is truthy on Android too (android-epg-bridge.ts installs
    // a partial, EPG-only object so duck-typed capability probes light up),
    // but the Xtream data source there is PwaXtreamDataSource, same as a real
    // PWA. addRecentItem/clearRecentItems/clearGlobalRecentlyViewed used to
    // gate their PWA-only branches on `!window.electron`/`window.electron`
    // alone, so on Android they took the Electron branch instead: a cold
    // content cache resolved to a null contentId instead of falling back to
    // the Xtream ID, and clearing recent items called the DB-backed service
    // (which safely no-ops there) instead of the in-memory PWA data source
    // that actually holds Android's recent items.
    const originalElectron = window.electron;
    const originalCapacitor = (
        globalThis as unknown as { Capacitor?: unknown }
    ).Capacitor;
    let store: InstanceType<typeof TestRecentItemsStore>;
    let databaseService: {
        clearGlobalRecentlyViewed: jest.Mock;
        clearPlaylistRecentItems: jest.Mock;
    };
    let dataSource: {
        addRecentItem: jest.Mock;
        clearRecentItems: jest.Mock;
        getContentByXtreamId: jest.Mock;
        getRecentItems: jest.Mock;
    };
    let playlistsService: {
        clearPlaylistRecentlyViewed: jest.Mock;
        getAllPlaylists: jest.Mock;
    };

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: { fetchEpg: jest.fn() } as unknown as Window['electron'],
        });
        (
            globalThis as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };

        databaseService = {
            clearGlobalRecentlyViewed: jest.fn().mockResolvedValue(undefined),
            clearPlaylistRecentItems: jest.fn().mockResolvedValue(undefined),
        };
        dataSource = {
            addRecentItem: jest.fn().mockResolvedValue(undefined),
            clearRecentItems: jest.fn().mockResolvedValue(undefined),
            getContentByXtreamId: jest.fn().mockResolvedValue(null),
            getRecentItems: jest.fn().mockResolvedValue([]),
        };
        playlistsService = {
            clearPlaylistRecentlyViewed: jest
                .fn()
                .mockReturnValue(of(undefined)),
            getAllPlaylists: jest.fn().mockReturnValue(of([])),
        };

        TestBed.configureTestingModule({
            providers: [
                TestRecentItemsStore,
                { provide: DatabaseService, useValue: databaseService },
                { provide: XTREAM_DATA_SOURCE, useValue: dataSource },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });

        store = TestBed.inject(TestRecentItemsStore);
    });

    afterEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
        (globalThis as unknown as { Capacitor?: unknown }).Capacitor =
            originalCapacitor;
    });

    it('falls back to the Xtream ID like PWA when the cached content is cold', async () => {
        store.addRecentItem({
            xtreamId: 1767451,
            contentType: 'movie',
            playlist: signal({ id: 'playlist-1' }),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.addRecentItem).toHaveBeenCalledWith(
            1767451,
            'playlist-1',
            undefined
        );
    });

    it('clears recent items through the PWA data source, not the DB-backed service', async () => {
        store.clearRecentItems({ id: 'playlist-1' });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(dataSource.clearRecentItems).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(databaseService.clearPlaylistRecentItems).not.toHaveBeenCalled();
    });

    it('clears Xtream recent items through the PWA data source during a global clear', async () => {
        playlistsService.getAllPlaylists.mockReturnValue(
            of([
                {
                    _id: 'xtream-1',
                    serverUrl: 'https://xtream.example.com',
                },
            ])
        );

        await store.clearGlobalRecentlyViewed();

        expect(
            databaseService.clearGlobalRecentlyViewed
        ).not.toHaveBeenCalled();
        expect(dataSource.clearRecentItems).toHaveBeenCalledWith('xtream-1');
    });
});
