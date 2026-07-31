import {
    ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES,
    type ElectronBridgeEpgProgress,
    type EpgChannelMetadata,
    type EpgProgram,
} from '@iptvnator/shared/interfaces';
import { EpgDatabase } from './epg-database';
import {
    channelMetadataQuery,
    channelProgramsQuery,
    channelsByRangeQuery,
    currentProgramsQuery,
    deleteSourceStatements,
    pruneOldProgramsStatement,
    searchChannelsQuery,
    searchProgramsQuery,
    staleSourcesQuery,
} from './epg-queries';
import {
    insertChannelsStatement,
    insertProgramsStatement,
    toChannelMetadata,
    toEpgProgram,
} from './epg-rows';
import { XmltvStreamParser } from './xmltv-parser';

/**
 * XMLTV import and lookup for the Android shell.
 *
 * Import is deliberately background work: the measured throughput is ~2 200
 * rows/s, so a week of guide for 6 000 channels takes minutes. It must never
 * block the UI, and it reports progress so the user knows why the guide is
 * still filling in.
 */

/** Programmes older than this are dropped; they only slow every later scan. */
const RETENTION_HOURS = 24;

type ProgressListener = (progress: ElectronBridgeEpgProgress) => void;

export class EpgStore {
    private readonly db = new EpgDatabase();
    private readonly listeners = new Set<ProgressListener>();
    /** One import at a time: concurrent bulk writes would thrash the device. */
    private importing: Promise<void> | null = null;

    onProgress(listener: ProgressListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private emit(progress: ElectronBridgeEpgProgress): void {
        for (const listener of this.listeners) {
            listener(progress);
        }
    }

    /**
     * Fetches and stores one XMLTV source, replacing whatever it had before.
     *
     * Serialised behind `importing` rather than run in parallel: two imports
     * writing at once on an in-order A55 would leave both slower than either
     * alone, and they contend for the same tables.
     */
    async importSource(url: string): Promise<{ channels: number; programs: number }> {
        while (this.importing) {
            await this.importing;
        }

        let resolveDone: () => void = () => undefined;
        this.importing = new Promise<void>((resolve) => (resolveDone = resolve));

        try {
            return await this.runImport(url);
        } finally {
            this.importing = null;
            resolveDone();
        }
    }

    private async runImport(
        url: string
    ): Promise<{ channels: number; programs: number }> {
        this.emit({ url, status: ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES.Loading });

        let channels = 0;
        let programs = 0;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this.emit({
                url,
                status: ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES.Loading,
            });
            await this.db.run(deleteSourceStatements(url));
            await this.db.dropIndexes();

            const parser = new XmltvStreamParser({
                onChannels: async (batch) => {
                    await this.db.run([insertChannelsStatement(batch, url)]);
                    channels += batch.length;
                },
                onPrograms: async (batch) => {
                    await this.db.run([insertProgramsStatement(batch, url)]);
                    programs += batch.length;
                    this.emit({
                        url,
                        status: ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES.Loading,
                        stats: { totalChannels: channels, totalPrograms: programs },
                    });
                },
            });

            await this.streamInto(parser, response);
            await parser.finish();

            // Indexes last, and pruning before them so the build covers fewer
            // rows.
            await this.prune();
            await this.db.createIndexes();
            await this.markFetched(url);

            this.emit({
                url,
                status: ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES.Complete,
                stats: { totalChannels: channels, totalPrograms: programs },
            });
            return { channels, programs };
        } catch (error) {
            // Indexes are restored even on failure: leaving them dropped would
            // make every later query scan the whole table.
            await this.db.createIndexes().catch(() => undefined);
            this.emit({
                url,
                status: ELECTRON_BRIDGE_EPG_PROGRESS_STATUSES.Error,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Feeds the response to the parser as it arrives.
     *
     * A guide file runs to tens of megabytes; `response.text()` would hold the
     * whole document as one string before parsing even starts, which is exactly
     * the peak the streaming design exists to avoid.
     */
    private async streamInto(
        parser: XmltvStreamParser,
        response: Response
    ): Promise<void> {
        const body = response.body;
        if (!body) {
            parser.write(await response.text());
            return;
        }

        const reader = body.getReader();
        const decoder = new TextDecoder();

        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            parser.write(decoder.decode(value, { stream: true }));
        }
    }

    private prune(): Promise<void> {
        const cutoff = new Date(
            Date.now() - RETENTION_HOURS * 3600_000
        ).toISOString();
        return this.db.run([pruneOldProgramsStatement(cutoff)]);
    }

    private markFetched(url: string): Promise<void> {
        return this.db.run([
            {
                statement: `INSERT OR REPLACE INTO epg_sources (url, fetched_at)
                    VALUES (?, ?)`,
                values: [url, new Date().toISOString()],
            },
        ]);
    }

    async freshness(
        urls: readonly string[],
        maxAgeHours: number
    ): Promise<{ staleUrls: string[]; freshUrls: string[] }> {
        if (urls.length === 0) {
            return { staleUrls: [], freshUrls: [] };
        }

        const cutoff = new Date(
            Date.now() - maxAgeHours * 3600_000
        ).toISOString();
        const rows = await this.db.query(staleSourcesQuery(cutoff));
        const fresh = new Set(rows.map((row) => String(row['url'])));

        return {
            freshUrls: urls.filter((url) => fresh.has(url)),
            staleUrls: urls.filter((url) => !fresh.has(url)),
        };
    }

    async currentPrograms(
        channelIds: readonly string[]
    ): Promise<Record<string, EpgProgram | null>> {
        const result: Record<string, EpgProgram | null> = {};
        for (const id of channelIds) {
            result[id] = null;
        }
        if (channelIds.length === 0) {
            return result;
        }

        const rows = await this.db.query(
            currentProgramsQuery(channelIds, new Date().toISOString())
        );
        for (const row of rows) {
            const program = toEpgProgram(row);
            // Earliest match wins: overlapping entries are common in provider
            // guides and the first is the one actually airing.
            result[program.channel] ??= program;
        }
        return result;
    }

    async channelPrograms(channelId: string, limit = 200): Promise<EpgProgram[]> {
        const rows = await this.db.query(
            channelProgramsQuery(channelId, new Date().toISOString(), limit)
        );
        return rows.map(toEpgProgram);
    }

    async channelMetadata(
        channelIds: readonly string[]
    ): Promise<Record<string, EpgChannelMetadata | null>> {
        const result: Record<string, EpgChannelMetadata | null> = {};
        for (const id of channelIds) {
            result[id] = null;
        }
        if (channelIds.length === 0) {
            return result;
        }

        const rows = await this.db.query(channelMetadataQuery(channelIds));
        for (const row of rows) {
            const metadata = toChannelMetadata(row);
            result[metadata.id] = metadata;
        }
        return result;
    }

    async channelsByRange(
        skip: number,
        limit: number
    ): Promise<{ id: string; displayName: string; iconUrl: string | null }[]> {
        const rows = await this.db.query(channelsByRangeQuery(skip, limit));
        return rows.map(toChannelMetadata);
    }

    async searchChannels(term: string, limit = 50) {
        const rows = await this.db.query(searchChannelsQuery(term, limit));
        return rows.map(toChannelMetadata);
    }

    async searchPrograms(term: string, limit = 50): Promise<EpgProgram[]> {
        const rows = await this.db.query(
            searchProgramsQuery(term, new Date().toISOString(), limit)
        );
        return rows.map(toEpgProgram);
    }

    async clear(): Promise<void> {
        await this.db.execute([
            'DELETE FROM epg_programs',
            'DELETE FROM epg_channels',
            'DELETE FROM epg_sources',
        ]);
    }

    async clearSource(url: string): Promise<void> {
        await this.db.run([
            ...deleteSourceStatements(url),
            { statement: 'DELETE FROM epg_sources WHERE url = ?', values: [url] },
        ]);
    }
}
