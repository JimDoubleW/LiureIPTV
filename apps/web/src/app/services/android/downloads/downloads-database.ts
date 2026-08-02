import {
    CapacitorSQLite,
    SQLiteConnection,
    type SQLiteDBConnection,
} from '@capacitor-community/sqlite';

/**
 * Metadata for one download: everything the desktop build keeps in its
 * `downloads` SQLite table (see `libs/shared/database`'s schema), minus the
 * columns a byte-range resumable engine needs and this one does not. `userAgent`/
 * `referer`/`origin` are kept specifically so retry/resume — which re-enqueue
 * from scratch on this engine, see `android-downloads-bridge.ts` — can rebuild
 * the exact request a portal's anti-hotlinking check requires, without going
 * back to the caller for them.
 */
export interface DownloadRow {
    id: number;
    playlistId: string;
    xtreamId: number;
    contentType: 'vod' | 'episode';
    seriesXtreamId: number | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    title: string;
    url: string;
    fileName: string | null;
    filePath: string | null;
    posterUrl: string | null;
    status: string;
    bytesDownloaded: number | null;
    totalBytes: number | null;
    errorMessage: string | null;
    nativeId: string | null;
    userAgent: string | null;
    referer: string | null;
    origin: string | null;
    createdAt: string;
    updatedAt: string;
}

export type NewDownloadRow = Omit<
    DownloadRow,
    'id' | 'createdAt' | 'updatedAt'
>;

export type DownloadRowPatch = Partial<
    Omit<DownloadRow, 'id' | 'playlistId' | 'xtreamId' | 'createdAt'>
>;

const DATABASE_NAME = 'liureiptv-downloads';

const CREATE_TABLE = `
    CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id TEXT NOT NULL,
        xtream_id INTEGER NOT NULL,
        content_type TEXT NOT NULL,
        series_xtream_id INTEGER,
        season_number INTEGER,
        episode_number INTEGER,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        file_name TEXT,
        file_path TEXT,
        poster_url TEXT,
        status TEXT NOT NULL,
        bytes_downloaded INTEGER,
        total_bytes INTEGER,
        error_message TEXT,
        native_id TEXT,
        user_agent TEXT,
        referer TEXT,
        origin TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`;

type SqlValue = string | number | null;
type SqlRow = Record<string, SqlValue>;

/** camelCase field → snake_case column, for the patch columns `update()` allows. */
const PATCH_COLUMNS: Record<keyof DownloadRowPatch, string> = {
    contentType: 'content_type',
    seriesXtreamId: 'series_xtream_id',
    seasonNumber: 'season_number',
    episodeNumber: 'episode_number',
    title: 'title',
    url: 'url',
    fileName: 'file_name',
    filePath: 'file_path',
    posterUrl: 'poster_url',
    status: 'status',
    bytesDownloaded: 'bytes_downloaded',
    totalBytes: 'total_bytes',
    errorMessage: 'error_message',
    nativeId: 'native_id',
    userAgent: 'user_agent',
    referer: 'referer',
    origin: 'origin',
    updatedAt: 'updated_at',
};

function rowToDownload(row: SqlRow): DownloadRow {
    return {
        id: Number(row['id']),
        playlistId: String(row['playlist_id']),
        xtreamId: Number(row['xtream_id']),
        contentType: row['content_type'] as 'vod' | 'episode',
        seriesXtreamId:
            row['series_xtream_id'] == null
                ? null
                : Number(row['series_xtream_id']),
        seasonNumber:
            row['season_number'] == null ? null : Number(row['season_number']),
        episodeNumber:
            row['episode_number'] == null
                ? null
                : Number(row['episode_number']),
        title: String(row['title']),
        url: String(row['url']),
        fileName: (row['file_name'] as string | null) ?? null,
        filePath: (row['file_path'] as string | null) ?? null,
        posterUrl: (row['poster_url'] as string | null) ?? null,
        status: String(row['status']),
        bytesDownloaded:
            row['bytes_downloaded'] == null
                ? null
                : Number(row['bytes_downloaded']),
        totalBytes:
            row['total_bytes'] == null ? null : Number(row['total_bytes']),
        errorMessage: (row['error_message'] as string | null) ?? null,
        nativeId: (row['native_id'] as string | null) ?? null,
        userAgent: (row['user_agent'] as string | null) ?? null,
        referer: (row['referer'] as string | null) ?? null,
        origin: (row['origin'] as string | null) ?? null,
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
    };
}

/**
 * SQLite-backed metadata store for Android downloads, in the WebView — same
 * connection pattern as `epg-database.ts`, a separate database because the two
 * have nothing to do with each other.
 *
 * `AndroidDownloadsPlugin` (native) owns none of this: it only knows how to
 * enqueue/query/remove a `DownloadManager` request. Title, poster, series/
 * episode linkage, and the request headers a retry needs all live here.
 */
export class DownloadsDatabase {
    private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
    private connection: SQLiteDBConnection | null = null;
    private opening: Promise<SQLiteDBConnection> | null = null;

    private open(): Promise<SQLiteDBConnection> {
        if (this.connection) {
            return Promise.resolve(this.connection);
        }
        if (this.opening) {
            return this.opening;
        }

        this.opening = this.createConnection();
        return this.opening;
    }

    private async createConnection(): Promise<SQLiteDBConnection> {
        const isConsistent = (
            await this.sqlite.checkConnectionsConsistency()
        ).result;
        const exists = (await this.sqlite.isConnection(DATABASE_NAME, false))
            .result;

        const connection =
            isConsistent && exists
                ? await this.sqlite.retrieveConnection(DATABASE_NAME, false)
                : await this.sqlite.createConnection(
                      DATABASE_NAME,
                      false,
                      'no-encryption',
                      1,
                      false
                  );

        await connection.open();
        await connection.execute(CREATE_TABLE);

        this.connection = connection;
        return connection;
    }

    async insert(row: NewDownloadRow): Promise<number> {
        const connection = await this.open();
        const now = new Date().toISOString();
        const result = await connection.run(
            `INSERT INTO downloads (
                playlist_id, xtream_id, content_type, series_xtream_id,
                season_number, episode_number, title, url, file_name,
                file_path, poster_url, status, bytes_downloaded, total_bytes,
                error_message, native_id, user_agent, referer, origin,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                row.playlistId,
                row.xtreamId,
                row.contentType,
                row.seriesXtreamId,
                row.seasonNumber,
                row.episodeNumber,
                row.title,
                row.url,
                row.fileName,
                row.filePath,
                row.posterUrl,
                row.status,
                row.bytesDownloaded,
                row.totalBytes,
                row.errorMessage,
                row.nativeId,
                row.userAgent,
                row.referer,
                row.origin,
                now,
                now,
            ]
        );
        const id = result.changes?.lastId;
        if (!id || id <= 0) {
            throw new Error('Insert did not return a row id');
        }
        return id;
    }

    async update(id: number, patch: DownloadRowPatch): Promise<void> {
        const entries = Object.entries(patch) as [
            keyof DownloadRowPatch,
            SqlValue,
        ][];
        if (entries.length === 0) {
            return;
        }

        const connection = await this.open();
        const setClause = entries
            .map(([key]) => `${PATCH_COLUMNS[key]} = ?`)
            .join(', ');
        const values = entries.map(([, value]) => value);

        await connection.run(`UPDATE downloads SET ${setClause} WHERE id = ?`, [
            ...values,
            id,
        ]);
    }

    async getAll(playlistId?: string): Promise<DownloadRow[]> {
        const connection = await this.open();
        const result = playlistId
            ? await connection.query(
                  'SELECT * FROM downloads WHERE playlist_id = ? ORDER BY created_at DESC',
                  [playlistId]
              )
            : await connection.query(
                  'SELECT * FROM downloads ORDER BY created_at DESC'
              );
        return ((result.values ?? []) as SqlRow[]).map(rowToDownload);
    }

    async getById(id: number): Promise<DownloadRow | null> {
        const connection = await this.open();
        const result = await connection.query(
            'SELECT * FROM downloads WHERE id = ?',
            [id]
        );
        const row = (result.values ?? [])[0] as SqlRow | undefined;
        return row ? rowToDownload(row) : null;
    }

    async delete(ids: number[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }
        const connection = await this.open();
        const placeholders = ids.map(() => '?').join(', ');
        await connection.run(
            `DELETE FROM downloads WHERE id IN (${placeholders})`,
            ids
        );
    }
}
