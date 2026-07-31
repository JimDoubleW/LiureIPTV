import type {
    ElectronBridgeApi,
    ElectronBridgeEpgMapping,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { isAndroidRuntime } from './android-runtime';
import { EpgStore } from './epg/epg-store';

/**
 * A partial `window.electron` for the Android shell, covering the EPG surface.
 *
 * Every EPG capability in the app is duck-typed: `RuntimeCapabilitiesService`
 * asks "is `window.electron.fetchEpg` a function?", never "is this Electron?".
 * That design is what makes this bridge possible — installing an object that
 * implements exactly the EPG methods lights up the EPG paths and nothing else,
 * because every other capability probes for methods this bridge does not have.
 *
 * Why it matters: the Xtream EPG's *primary* source is the portal API
 * (`get_short_epg` through `DataService`, which already rides the native HTTP
 * transport). The locally-imported XMLTV is only a fallback. But the UI gates
 * the whole path behind `supportsEpg`, so without this bridge the app refused
 * to fetch EPG it was perfectly able to get.
 *
 * Backed by SQLite in the WebView (`epg/`), the route chosen by measurement:
 * a million rows imported with the JS heap flat at 20 MB against a 497 MB
 * ceiling. Channel mappings stay in localStorage — they are a handful of
 * per-user overrides, not guide data.
 */

const MAPPINGS_STORAGE_KEY = 'iptvnator:android-epg-mappings';

type StoredMappings = Record<
    string,
    { epgChannelId: string; playlistId: string | null }
>;

function readMappings(): StoredMappings {
    try {
        const raw = localStorage.getItem(MAPPINGS_STORAGE_KEY);
        return raw ? (JSON.parse(raw) as StoredMappings) : {};
    } catch {
        return {};
    }
}

function writeMappings(mappings: StoredMappings): void {
    try {
        localStorage.setItem(MAPPINGS_STORAGE_KEY, JSON.stringify(mappings));
    } catch {
        // Quota or privacy-mode failure: mappings degrade to session-only.
    }
}

/** Stable synthetic id: the interface wants a number, the store is keyed. */
function mappingId(channelKey: string): number {
    let hash = 0;
    for (let i = 0; i < channelKey.length; i++) {
        hash = (hash * 31 + channelKey.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * `{ id: null }` for every requested id.
 *
 * A plain loop rather than `Object.fromEntries`: the web tsconfig's `lib`
 * predates it, and it compiles under Jest while failing the production build —
 * the same trap as iterating a NodeList directly.
 */
function nullsFor<T>(ids: readonly string[]): Record<string, T | null> {
    const result: Record<string, T | null> = {};
    for (const id of ids) {
        result[id] = null;
    }
    return result;
}

export type AndroidEpgBridge = Pick<
    ElectronBridgeApi,
    | 'fetchEpg'
    | 'forceFetchEpg'
    | 'clearEpgData'
    | 'clearEpgDataForSource'
    | 'checkEpgFreshness'
    | 'getChannelPrograms'
    | 'getCurrentProgramsBatch'
    | 'getEpgChannelMetadata'
    | 'getEpgChannelsByRange'
    | 'searchEpgPrograms'
    | 'searchEpgChannels'
    | 'getEpgMapping'
    | 'getEpgMappingsBatch'
    | 'setEpgMapping'
    | 'deleteEpgMapping'
    | 'onEpgProgress'
>;

export function createAndroidEpgBridge(
    store: EpgStore = new EpgStore()
): AndroidEpgBridge {
    return {
        // ---- XMLTV import. Only stale sources are fetched: an import is
        // minutes of work, and re-running it for a guide already on disk would
        // burn the device for nothing.
        fetchEpg: async (urls) => {
            const { staleUrls, freshUrls } = await store.freshness(urls, 12);
            const failed: string[] = [];

            for (const url of staleUrls) {
                try {
                    await store.importSource(url);
                } catch {
                    failed.push(url);
                }
            }

            return {
                success: failed.length < staleUrls.length || staleUrls.length === 0,
                skipped: [...freshUrls, ...failed],
            };
        },
        forceFetchEpg: async (url) => {
            try {
                await store.importSource(url);
                return { success: true };
            } catch (error) {
                return {
                    success: false,
                    message:
                        error instanceof Error ? error.message : String(error),
                    skipped: [url],
                };
            }
        },
        clearEpgData: async () => {
            await store.clear();
            return { success: true };
        },
        clearEpgDataForSource: async (sourceUrl) => {
            await store.clearSource(sourceUrl);
            return { success: true };
        },

        checkEpgFreshness: (urls, maxAgeHours) =>
            store.freshness(urls, maxAgeHours ?? 12),

        // ---- Lookups. Failures answer empty rather than rejecting: a guide
        // that cannot be read must degrade to "no programme information", never
        // break the channel list around it.
        getChannelPrograms: (channelId) =>
            store.channelPrograms(channelId).catch(() => []),
        getCurrentProgramsBatch: (channelIds) =>
            store
                .currentPrograms(channelIds)
                .catch(() => nullsFor<EpgProgram>(channelIds)),
        getEpgChannelMetadata: (channelIds) =>
            store
                .channelMetadata(channelIds)
                .catch(() => nullsFor<EpgChannelMetadata>(channelIds)),
        getEpgChannelsByRange: async (skip, limit) => {
            const channels = await store.channelsByRange(skip, limit).catch(() => []);
            return channels.map((channel) => ({
                id: channel.id,
                displayName: channel.displayName,
                iconUrl: channel.iconUrl,
                // The browser lists channels; programmes are loaded per channel
                // on demand, because pulling them all is what costs.
                programs: [],
            }));
        },
        searchEpgPrograms: (searchTerm, limit) =>
            store.searchPrograms(searchTerm, limit).catch(() => []),
        searchEpgChannels: (searchTerm, limit) =>
            store.searchChannels(searchTerm, limit).catch(() => []),

        // ---- Manual channel mappings: real and persistent.
        getEpgMapping: (channelKey) => {
            const entry = readMappings()[channelKey];
            if (!entry) {
                return Promise.resolve(null);
            }
            const mapping: ElectronBridgeEpgMapping = {
                id: mappingId(channelKey),
                channelKey,
                epgChannelId: entry.epgChannelId,
                playlistId: entry.playlistId,
            };
            return Promise.resolve(mapping);
        },
        getEpgMappingsBatch: (channelKeys) => {
            const mappings = readMappings();
            const result: Record<string, string> = {};
            for (const key of channelKeys) {
                const entry = mappings[key];
                if (entry) {
                    result[key] = entry.epgChannelId;
                }
            }
            return Promise.resolve(result);
        },
        setEpgMapping: (channelKey, epgChannelId, playlistId) => {
            const mappings = readMappings();
            mappings[channelKey] = {
                epgChannelId,
                playlistId: playlistId ?? null,
            };
            writeMappings(mappings);
            return Promise.resolve({ success: true });
        },
        deleteEpgMapping: (channelKey) => {
            const mappings = readMappings();
            delete mappings[channelKey];
            writeMappings(mappings);
            return Promise.resolve({ success: true });
        },

        onEpgProgress: (callback) => {
            store.onProgress(callback);
        },
    };
}

/**
 * Installs the bridge before Angular bootstraps, so `DataFactory()` and the
 * capability probes see a consistent world from the first injection.
 *
 * `DataFactory()` and `RuntimeCapabilitiesService.isElectron` both carry an
 * explicit Android exception — a truthy `window.electron` would otherwise
 * select `ElectronService` and relabel the whole environment.
 */
export function installAndroidEpgBridge(): void {
    if (!isAndroidRuntime() || window.electron) {
        return;
    }

    (window as { electron?: unknown }).electron = createAndroidEpgBridge();
}
