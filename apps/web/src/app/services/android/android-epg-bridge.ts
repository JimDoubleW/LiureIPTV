import type {
    ElectronBridgeApi,
    ElectronBridgeEpgMapping,
} from '@iptvnator/shared/interfaces';
import { isAndroidRuntime } from './android-runtime';

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
 * Two layers with different honesty levels:
 *
 * - **Channel mappings are real**, backed by localStorage — small, per-user
 *   data that must survive restarts.
 * - **The XMLTV store is empty by design.** Lookups return no rows, imports
 *   report themselves as skipped. The measured route for stage 2 is SQLite in
 *   the WebView (see androidtv/main's epg-storage-load-test.md: 1M rows, JS
 *   heap flat at 20 MB); until then, claiming success would corrupt the
 *   freshness bookkeeping.
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

export function createAndroidEpgBridge(): AndroidEpgBridge {
    return {
        // ---- XMLTV imports: nothing is stored yet, and that is reported
        // truthfully. `skipped` carries every URL so the caller knows no data
        // arrived; success:true because declining is not an error.
        fetchEpg: (urls) =>
            Promise.resolve({
                success: true,
                message: 'XMLTV import is not available on Android yet',
                skipped: [...urls],
            }),
        forceFetchEpg: (url) =>
            Promise.resolve({
                success: true,
                message: 'XMLTV import is not available on Android yet',
                skipped: [url],
            }),
        clearEpgData: () => Promise.resolve({ success: true }),
        clearEpgDataForSource: () => Promise.resolve({ success: true }),

        // Everything is permanently stale: there is no local store to be
        // fresh. Callers respond by attempting a fetch, which reports skipped.
        checkEpgFreshness: (urls) =>
            Promise.resolve({ staleUrls: [...urls], freshUrls: [] }),

        // ---- XMLTV lookups: an empty store answers with empty results, which
        // sends the EPG queue to its primary source — the portal API.
        getChannelPrograms: () => Promise.resolve([]),
        getCurrentProgramsBatch: (channelIds) =>
            Promise.resolve(nullsFor(channelIds)),
        getEpgChannelMetadata: (channelIds) =>
            Promise.resolve(nullsFor(channelIds)),
        getEpgChannelsByRange: () => Promise.resolve([]),
        searchEpgPrograms: () => Promise.resolve([]),
        searchEpgChannels: () => Promise.resolve([]),

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

        // No imports run yet, so there is no progress to report; the callback
        // is accepted so stage 2 can start emitting without an interface change.
        onEpgProgress: () => undefined,
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
