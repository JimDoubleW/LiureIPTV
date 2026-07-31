import {
    insertChannelsStatement,
    insertProgramsStatement,
    toChannelMetadata,
    toEpgProgram,
} from './epg-rows';

describe('EPG row mapping', () => {
    describe('bulk inserts', () => {
        it('emits one statement for the whole batch', () => {
            // One statement per 500 rows instead of 500 bridge crossings is
            // what makes a million-row import finish.
            const { statement, values } = insertChannelsStatement(
                [
                    { id: 'a', displayName: 'A', iconUrl: null },
                    { id: 'b', displayName: 'B', iconUrl: 'http://i/b.png' },
                ],
                'http://src'
            );

            expect(statement).toContain('VALUES (?, ?, ?, ?), (?, ?, ?, ?)');
            expect(values).toEqual([
                'a', 'A', '', 'http://src',
                'b', 'B', 'http://i/b.png', 'http://src',
            ]);
        });

        it('replaces a channel a source lists twice', () => {
            // Aborting an import hours in over a duplicate id would be absurd.
            expect(
                insertChannelsStatement([{ id: 'a', displayName: 'A', iconUrl: null }], 's')
                    .statement
            ).toContain('INSERT OR REPLACE');
        });

        it('binds every programme column in order', () => {
            const { values } = insertProgramsStatement(
                [
                    {
                        channelId: 'c',
                        start: '2026-04-15T05:00:00Z',
                        stop: '2026-04-15T06:00:00Z',
                        title: 'T',
                        description: 'D',
                        category: null,
                        iconUrl: null,
                        episodeNum: null,
                        rating: null,
                    },
                ],
                'http://src'
            );

            expect(values).toEqual([
                'c', '2026-04-15T05:00:00Z', '2026-04-15T06:00:00Z',
                'T', 'D', '', '', '', '', 'http://src',
            ]);
        });
    });

    describe('reading rows back', () => {
        it('derives the timestamps the UI sorts and measures on', () => {
            const program = toEpgProgram({
                channel_id: 'c',
                start: '2026-04-15T05:00:00.000Z',
                stop: '2026-04-15T06:00:00.000Z',
                title: 'T',
                description: null,
                category: null,
            });

            expect(program.startTimestamp).toBe(Date.parse('2026-04-15T05:00:00.000Z'));
            expect(program.stopTimestamp).toBe(Date.parse('2026-04-15T06:00:00.000Z'));
        });

        it('turns the stored empty strings back into nulls', () => {
            // Absent fields are written as '' and must not surface as empty
            // descriptions in the UI.
            const program = toEpgProgram({
                channel_id: 'c',
                start: '', stop: '', title: 'T',
                description: '', category: '', icon_url: '',
            });

            expect(program.desc).toBeNull();
            expect(program.category).toBeNull();
            expect(program.iconUrl).toBeNull();
            expect(program.startTimestamp).toBeNull();
        });

        it('maps channel metadata', () => {
            expect(
                toChannelMetadata({ id: 'c', display_name: 'C', icon_url: '' })
            ).toEqual({ id: 'c', displayName: 'C', iconUrl: null });
        });
    });
});
