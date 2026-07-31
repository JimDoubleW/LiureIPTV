import type {
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import type { SqlRow } from './epg-database';
import type { XmltvChannel, XmltvProgram } from './xmltv-parser';
import type { SqlStatement } from './epg-queries';

/**
 * Row mapping, both directions.
 *
 * Multi-row `INSERT ... VALUES` is what makes the import bearable: one
 * statement per 500 rows instead of 500 round trips over the bridge, where each
 * crossing is the dominant cost.
 */

export function insertChannelsStatement(
    channels: readonly XmltvChannel[],
    sourceUrl: string
): SqlStatement {
    const tuples = channels.map(() => '(?, ?, ?, ?)').join(', ');
    const values: (string | number)[] = [];
    for (const channel of channels) {
        values.push(channel.id, channel.displayName, channel.iconUrl ?? '', sourceUrl);
    }

    return {
        // A source may list a channel twice; the last one wins rather than
        // aborting an import hours in.
        statement: `INSERT OR REPLACE INTO epg_channels
            (id, display_name, icon_url, source_url) VALUES ${tuples}`,
        values,
    };
}

export function insertProgramsStatement(
    programs: readonly XmltvProgram[],
    sourceUrl: string
): SqlStatement {
    const tuples = programs.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: (string | number)[] = [];
    for (const program of programs) {
        values.push(
            program.channelId,
            program.start,
            program.stop,
            program.title,
            program.description ?? '',
            program.category ?? '',
            program.iconUrl ?? '',
            program.episodeNum ?? '',
            program.rating ?? '',
            sourceUrl
        );
    }

    return {
        statement: `INSERT INTO epg_programs
            (channel_id, start, stop, title, description, category,
             icon_url, episode_num, rating, source_url)
            VALUES ${tuples}`,
        values,
    };
}

function text(value: string | number | null): string | null {
    // Empty strings are how nulls were stored: the plugin's binder is happier
    // with them, and the app expects null for "absent".
    return value === null || value === '' ? null : String(value);
}

export function toEpgProgram(row: SqlRow): EpgProgram {
    const start = String(row['start'] ?? '');
    const stop = String(row['stop'] ?? '');

    return {
        channel: String(row['channel_id'] ?? ''),
        start,
        stop,
        title: String(row['title'] ?? ''),
        desc: text(row['description'] ?? null),
        category: text(row['category'] ?? null),
        iconUrl: text(row['icon_url'] ?? null),
        episodeNum: text(row['episode_num'] ?? null),
        rating: text(row['rating'] ?? null),
        // The UI sorts and measures progress on these; deriving them here keeps
        // every consumer from re-parsing the same strings.
        startTimestamp: start ? Date.parse(start) : null,
        stopTimestamp: stop ? Date.parse(stop) : null,
    };
}

export function toChannelMetadata(row: SqlRow): EpgChannelMetadata {
    return {
        id: String(row['id'] ?? ''),
        displayName: String(row['display_name'] ?? ''),
        iconUrl: text(row['icon_url'] ?? null),
    };
}
