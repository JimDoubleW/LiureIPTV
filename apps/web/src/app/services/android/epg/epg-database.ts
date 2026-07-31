import {
    CapacitorSQLite,
    SQLiteConnection,
    type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import {
    CREATE_INDEXES,
    CREATE_TABLES,
    DROP_INDEXES,
    type SqlStatement,
} from './epg-queries';

/**
 * SQLite connection for the EPG store, held in the WebView.
 *
 * The route was chosen by measurement rather than preference: a million rows
 * went in with the JS heap flat at 20 MB against a 497 MB ceiling, which is the
 * finding that ruled out both an IndexedDB port and a native rewrite. See
 * `git show androidtv/main:docs/android-port/epg-storage-load-test.md`.
 */

const DATABASE_NAME = 'iptvandor-epg';

export type SqlRow = Record<string, string | number | null>;

export class EpgDatabase {
    private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
    private connection: SQLiteDBConnection | null = null;
    private opening: Promise<SQLiteDBConnection> | null = null;

    /**
     * Opened once and shared. Concurrent callers await the same promise: the
     * plugin rejects a second `createConnection` for the same database, so two
     * simultaneous first-calls would otherwise make one of them fail.
     */
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
        // A connection can survive a WebView reload while the plugin keeps its
        // own registry, so an existing one is adopted rather than duplicated.
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
        await this.executeOn(connection, CREATE_TABLES);

        this.connection = connection;
        return connection;
    }

    async query(statement: SqlStatement): Promise<SqlRow[]> {
        const connection = await this.open();
        const result = await connection.query(
            statement.statement,
            statement.values
        );
        return (result.values ?? []) as SqlRow[];
    }

    async run(statements: SqlStatement[]): Promise<void> {
        if (statements.length === 0) {
            return;
        }

        const connection = await this.open();
        await connection.executeSet(
            statements.map((statement) => ({
                statement: statement.statement,
                values: statement.values,
            }))
        );
    }

    async execute(sql: string[]): Promise<void> {
        if (sql.length === 0) {
            return;
        }
        await this.executeOn(await this.open(), sql);
    }

    /**
     * One statement per call, never a semicolon-joined batch.
     *
     * The plugin splits multi-statement SQL itself, and its splitter does not
     * survive statements spanning several lines: joining three CREATE TABLEs
     * created only the first, and the failure was silent — the missing tables
     * only surfaced later as "no such table" from an unrelated query.
     */
    private async executeOn(
        connection: SQLiteDBConnection,
        statements: string[]
    ): Promise<void> {
        for (const statement of statements) {
            await connection.execute(statement);
        }
    }

    /**
     * Indexes are dropped for the duration of a bulk import and rebuilt after.
     * Maintaining them per row costs far more than the measured 14 s to rebuild
     * all of them over a million rows.
     */
    dropIndexes(): Promise<void> {
        return this.execute(DROP_INDEXES);
    }

    createIndexes(): Promise<void> {
        return this.execute(CREATE_INDEXES);
    }

    async close(): Promise<void> {
        if (!this.connection) {
            return;
        }
        await this.connection.close();
        await this.sqlite.closeConnection(DATABASE_NAME, false);
        this.connection = null;
        this.opening = null;
    }
}
