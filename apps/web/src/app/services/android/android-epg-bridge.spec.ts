import {
    createAndroidEpgBridge,
    installAndroidEpgBridge,
} from './android-epg-bridge';
import type { EpgStore } from './epg/epg-store';

function fakeStore(overrides: Partial<EpgStore> = {}): EpgStore {
    return {
        freshness: async (urls: string[]) => ({
            staleUrls: [...urls],
            freshUrls: [],
        }),
        importSource: async () => ({ channels: 0, programs: 0 }),
        currentPrograms: async () => ({}),
        channelPrograms: async () => [],
        channelMetadata: async () => ({}),
        channelsByRange: async () => [],
        searchChannels: async () => [],
        searchPrograms: async () => [],
        clear: async () => undefined,
        clearSource: async () => undefined,
        onProgress: () => () => undefined,
        ...overrides,
    } as unknown as EpgStore;
}

describe('android EPG bridge', () => {
    afterEach(() => {
        localStorage.clear();
        delete (window as { electron?: unknown }).electron;
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    describe('XMLTV import', () => {
        it('imports only the stale sources', async () => {
            // An import is minutes of device work; re-running it for a guide
            // already on disk would burn the box for nothing.
            const imported: string[] = [];
            const bridge = createAndroidEpgBridge(
                fakeStore({
                    freshness: async () => ({
                        staleUrls: ['http://stale'],
                        freshUrls: ['http://fresh'],
                    }),
                    importSource: async (url: string) => {
                        imported.push(url);
                        return { channels: 1, programs: 2 };
                    },
                })
            );

            const result = await bridge.fetchEpg([
                'http://stale',
                'http://fresh',
            ]);

            expect(imported).toEqual(['http://stale']);
            expect(result.skipped).toContain('http://fresh');
        });

        it('reports a failed source as skipped instead of throwing', async () => {
            const bridge = createAndroidEpgBridge(
                fakeStore({
                    importSource: async () => {
                        throw new Error('network down');
                    },
                })
            );

            const result = await bridge.fetchEpg(['http://broken']);

            expect(result.skipped).toContain('http://broken');
        });

        it('surfaces the reason when a forced import fails', async () => {
            const bridge = createAndroidEpgBridge(
                fakeStore({
                    importSource: async () => {
                        throw new Error('HTTP 404');
                    },
                })
            );

            const result = await bridge.forceFetchEpg('http://gone');

            expect(result.success).toBe(false);
            expect(result.message).toBe('HTTP 404');
        });
    });

    describe('lookups degrade rather than break', () => {
        it('answers empty when the store fails', async () => {
            // A guide that cannot be read must show "no programme information",
            // never take the channel list down with it.
            const bridge = createAndroidEpgBridge(
                fakeStore({
                    currentPrograms: async () => {
                        throw new Error('database locked');
                    },
                    channelPrograms: async () => {
                        throw new Error('database locked');
                    },
                })
            );

            expect(await bridge.getCurrentProgramsBatch(['c1', 'c2'])).toEqual({
                c1: null,
                c2: null,
            });
            expect(await bridge.getChannelPrograms('c1')).toEqual([]);
        });
    });

    describe('channel mappings (real, persistent)', () => {
        it('round-trips a mapping through localStorage', async () => {
            const bridge = createAndroidEpgBridge(fakeStore());
            await bridge.setEpgMapping('key-1', 'epg-channel-9', 'playlist-a');

            const mapping = await bridge.getEpgMapping('key-1');

            expect(mapping?.epgChannelId).toBe('epg-channel-9');
            expect(mapping?.playlistId).toBe('playlist-a');
        });

        it('survives a bridge re-creation, as an app restart would', async () => {
            await createAndroidEpgBridge(fakeStore()).setEpgMapping('key-1', 'epg-9');

            const mapping = await createAndroidEpgBridge(fakeStore()).getEpgMapping('key-1');

            expect(mapping?.epgChannelId).toBe('epg-9');
        });

        it('returns only the requested keys in a batch', async () => {
            const bridge = createAndroidEpgBridge(fakeStore());
            await bridge.setEpgMapping('key-1', 'epg-1');
            await bridge.setEpgMapping('key-2', 'epg-2');

            const batch = await bridge.getEpgMappingsBatch(['key-2', 'absent']);

            expect(batch).toEqual({ 'key-2': 'epg-2' });
        });

        it('deletes a mapping for good', async () => {
            const bridge = createAndroidEpgBridge(fakeStore());
            await bridge.setEpgMapping('key-1', 'epg-1');
            await bridge.deleteEpgMapping('key-1');

            expect(await bridge.getEpgMapping('key-1')).toBeNull();
        });
    });

    describe('installation', () => {
        it('does nothing off the Capacitor shell', () => {
            installAndroidEpgBridge();

            expect(window.electron).toBeUndefined();
        });

        it('never overwrites a real Electron bridge', () => {
            // Belt and braces: if this code ever ran inside Electron, replacing
            // the full bridge with the EPG subset would break everything else.
            const realBridge = { marker: true };
            (window as { electron?: unknown }).electron = realBridge;
            (window as { Capacitor?: unknown }).Capacitor = {
                getPlatform: () => 'android',
            };

            installAndroidEpgBridge();

            expect(window.electron).toBe(realBridge);
        });

        it('installs the EPG surface inside the shell', () => {
            (window as { Capacitor?: unknown }).Capacitor = {
                getPlatform: () => 'android',
            };

            installAndroidEpgBridge();

            expect(typeof window.electron?.fetchEpg).toBe('function');
            expect(typeof window.electron?.getChannelPrograms).toBe('function');
            // And nothing beyond the EPG surface, or capability probes would
            // light up features the shell cannot back.
            expect(window.electron?.dbGetAppPlaylists).toBeUndefined();
        });
    });
});
