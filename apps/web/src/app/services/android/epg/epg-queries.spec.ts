import {
    channelProgramsQuery,
    currentProgramsQuery,
    MAX_PROGRAM_HOURS,
    searchProgramsQuery,
    windowStart,
} from './epg-queries';

const NOW = '2026-04-15T20:00:00.000Z';

describe('EPG queries', () => {
    describe('index-critical shapes', () => {
        it('never wraps the start column in a function', () => {
            // datetime(start) <= datetime(?) defeats the index: 2 872 ms
            // against 1 012 ms over a million rows.
            const { statement } = currentProgramsQuery(['c1'], NOW);

            expect(statement).not.toMatch(/datetime\s*\(\s*start/i);
            expect(statement).toContain('start <= ?');
        });

        it('bounds the now-window on both sides', () => {
            // Without a lower bound the index only covers half the predicate
            // and the rest scans every earlier programme.
            const { statement } = currentProgramsQuery(['c1'], NOW);

            expect(statement).toContain('start > ?');
            expect(statement).toContain('stop >= ?');
        });

        it('places the lower bound a programme-length before now', () => {
            expect(windowStart(NOW)).toBe('2026-04-15T08:00:00.000Z');
            expect(MAX_PROGRAM_HOURS).toBe(12);
        });
    });

    describe('parameter binding', () => {
        it('emits one placeholder per channel, in order, then the bounds', () => {
            const { statement, values } = currentProgramsQuery(
                ['a', 'b', 'c'],
                NOW
            );

            expect(statement).toContain('IN (?, ?, ?)');
            expect(values).toEqual([
                'a',
                'b',
                'c',
                '2026-04-15T08:00:00.000Z',
                NOW,
                NOW,
            ]);
        });

        it('wraps a search term in wildcards rather than the caller', () => {
            const { values } = searchProgramsQuery('paradis', NOW, 30);

            expect(values[0]).toBe('%paradis%');
        });

        it('always carries a limit, since rows cost ~16 microseconds each', () => {
            expect(channelProgramsQuery('c1', NOW, 25).statement).toContain(
                'LIMIT ?'
            );
            expect(searchProgramsQuery('x', NOW, 30).values).toContain(30);
        });
    });

    it('keeps programme search off the archive', () => {
        // Results pointing at last week are noise, and the bound keeps the scan
        // away from rows nobody will read.
        const { statement, values } = searchProgramsQuery('x', NOW, 30);

        expect(statement).toContain('stop >= ?');
        expect(values).toContain(NOW);
    });
});
