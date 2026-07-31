/**
 * SQL for the EPG store, kept as pure builders.
 *
 * These shapes are the measured part of the design (see
 * `git show androidtv/main:docs/android-port/epg-storage-load-test.md`), so they
 * are unit-tested rather than trusted:
 *
 * - **Never wrap the column in `datetime()`.** Applying a function to `start`
 *   defeats the index — 2 872 ms against 1 012 ms on a million rows. Values are
 *   stored as UTC ISO text, which sorts correctly as plain text.
 * - **Bound the window on both sides.** `start <= now AND stop >= now` can only
 *   use the index for the first half and scans everything earlier for the
 *   second. A lower bound on `start` — no programme runs longer than a few
 *   hours — took 1 012 ms to 568 ms.
 * - **Fetch what is on screen.** Moving rows over the bridge costs ~16 µs each:
 *   the same query was 149 ms for one row and 503 ms for 6 240.
 */

/** No programme is assumed to run longer than this, which bounds the scan. */
export const MAX_PROGRAM_HOURS = 12;

export interface SqlStatement {
    statement: string;
    values: (string | number)[];
}

export const CREATE_TABLES = [
    `CREATE TABLE IF NOT EXISTS epg_channels (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        icon_url TEXT,
        source_url TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS epg_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        start TEXT NOT NULL,
        stop TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        icon_url TEXT,
        episode_num TEXT,
        rating TEXT,
        source_url TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS epg_sources (
        url TEXT PRIMARY KEY,
        fetched_at TEXT NOT NULL
    )`,
];

/**
 * Built after the bulk insert, never before: writing a million rows into
 * indexed tables costs far more than the 14 s it takes to index them once.
 */
export const CREATE_INDEXES = [
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_channel ON epg_programs(channel_id)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_start ON epg_programs(start)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_programs_source ON epg_programs(source_url)`,
    `CREATE INDEX IF NOT EXISTS idx_epg_channels_source ON epg_channels(source_url)`,
];

export const DROP_INDEXES = [
    `DROP INDEX IF EXISTS idx_epg_programs_channel`,
    `DROP INDEX IF EXISTS idx_epg_programs_start`,
    `DROP INDEX IF EXISTS idx_epg_programs_source`,
];

function placeholders(count: number): string {
    return new Array(count).fill('?').join(', ');
}

/** Lower bound for "on now" scans; see MAX_PROGRAM_HOURS. */
export function windowStart(nowIso: string): string {
    const now = new Date(nowIso).getTime();
    return new Date(now - MAX_PROGRAM_HOURS * 3600_000).toISOString();
}

/**
 * The programme airing now for each of `channelIds`.
 *
 * `LIMIT` is deliberately the caller's business: a guide shows 15–30 channels,
 * and asking for the whole catalogue is what made this query slow.
 */
export function currentProgramsQuery(
    channelIds: readonly string[],
    nowIso: string
): SqlStatement {
    return {
        statement: `SELECT channel_id, start, stop, title, description, category
            FROM epg_programs
            WHERE channel_id IN (${placeholders(channelIds.length)})
              AND start > ? AND start <= ? AND stop >= ?
            ORDER BY start ASC`,
        values: [...channelIds, windowStart(nowIso), nowIso, nowIso],
    };
}

/** Every programme for one channel, optionally from one day onwards. */
export function channelProgramsQuery(
    channelId: string,
    fromIso: string,
    limit: number
): SqlStatement {
    return {
        statement: `SELECT channel_id, start, stop, title, description, category,
                icon_url, episode_num, rating
            FROM epg_programs
            WHERE channel_id = ? AND stop >= ?
            ORDER BY start ASC
            LIMIT ?`,
        values: [channelId, fromIso, limit],
    };
}

export function channelMetadataQuery(
    channelIds: readonly string[]
): SqlStatement {
    return {
        statement: `SELECT id, display_name, icon_url FROM epg_channels
            WHERE id IN (${placeholders(channelIds.length)})`,
        values: [...channelIds],
    };
}

export function channelsByRangeQuery(skip: number, limit: number): SqlStatement {
    return {
        statement: `SELECT id, display_name, icon_url FROM epg_channels
            ORDER BY display_name ASC LIMIT ? OFFSET ?`,
        values: [limit, skip],
    };
}

export function searchChannelsQuery(term: string, limit: number): SqlStatement {
    return {
        statement: `SELECT id, display_name, icon_url FROM epg_channels
            WHERE display_name LIKE ? ORDER BY display_name ASC LIMIT ?`,
        values: [`%${term}%`, limit],
    };
}

/**
 * Programme search, restricted to what is still airing or yet to air: results
 * pointing at last week are noise, and the bound keeps the scan off the archive.
 */
export function searchProgramsQuery(
    term: string,
    nowIso: string,
    limit: number
): SqlStatement {
    return {
        statement: `SELECT channel_id, start, stop, title, description, category
            FROM epg_programs
            WHERE title LIKE ? AND stop >= ?
            ORDER BY start ASC LIMIT ?`,
        values: [`%${term}%`, nowIso, limit],
    };
}

export function deleteSourceStatements(sourceUrl: string): SqlStatement[] {
    return [
        {
            statement: `DELETE FROM epg_programs WHERE source_url = ?`,
            values: [sourceUrl],
        },
        {
            statement: `DELETE FROM epg_channels WHERE source_url = ?`,
            values: [sourceUrl],
        },
    ];
}

/** Rows older than the retention window are dead weight in every scan. */
export function pruneOldProgramsStatement(cutoffIso: string): SqlStatement {
    return {
        statement: `DELETE FROM epg_programs WHERE stop < ?`,
        values: [cutoffIso],
    };
}

export function staleSourcesQuery(maxAgeIso: string): SqlStatement {
    return {
        statement: `SELECT url FROM epg_sources WHERE fetched_at >= ?`,
        values: [maxAgeIso],
    };
}
