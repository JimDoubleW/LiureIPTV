import {
    createAndroidEpgBridge,
    installAndroidEpgBridge,
} from './android-epg-bridge';

describe('android EPG bridge', () => {
    afterEach(() => {
        localStorage.clear();
        delete (window as { electron?: unknown }).electron;
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    describe('XMLTV surface (empty by design)', () => {
        it('reports every import as skipped rather than claiming success', async () => {
            // Claiming an import happened would corrupt the freshness
            // bookkeeping: the app would believe data exists locally.
            const result = await createAndroidEpgBridge().fetchEpg([
                'http://example.com/guide.xml',
            ]);

            expect(result.success).toBe(true);
            expect(result.skipped).toEqual(['http://example.com/guide.xml']);
        });

        it('declares every source stale, since there is no store to be fresh', async () => {
            const result = await createAndroidEpgBridge().checkEpgFreshness([
                'http://a.example',
                'http://b.example',
            ]);

            expect(result.staleUrls).toHaveLength(2);
            expect(result.freshUrls).toHaveLength(0);
        });

        it('answers the current-programs batch with explicit nulls', async () => {
            // The EPG queue uses these nulls to fall through to its primary
            // source, the portal API.
            const result = await createAndroidEpgBridge().getCurrentProgramsBatch(
                ['c1', 'c2']
            );

            expect(result).toEqual({ c1: null, c2: null });
        });
    });

    describe('channel mappings (real, persistent)', () => {
        it('round-trips a mapping through localStorage', async () => {
            const bridge = createAndroidEpgBridge();
            await bridge.setEpgMapping('key-1', 'epg-channel-9', 'playlist-a');

            const mapping = await bridge.getEpgMapping('key-1');

            expect(mapping?.epgChannelId).toBe('epg-channel-9');
            expect(mapping?.playlistId).toBe('playlist-a');
        });

        it('survives a bridge re-creation, as an app restart would', async () => {
            await createAndroidEpgBridge().setEpgMapping('key-1', 'epg-9');

            const mapping = await createAndroidEpgBridge().getEpgMapping('key-1');

            expect(mapping?.epgChannelId).toBe('epg-9');
        });

        it('returns only the requested keys in a batch', async () => {
            const bridge = createAndroidEpgBridge();
            await bridge.setEpgMapping('key-1', 'epg-1');
            await bridge.setEpgMapping('key-2', 'epg-2');

            const batch = await bridge.getEpgMappingsBatch(['key-2', 'absent']);

            expect(batch).toEqual({ 'key-2': 'epg-2' });
        });

        it('deletes a mapping for good', async () => {
            const bridge = createAndroidEpgBridge();
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
