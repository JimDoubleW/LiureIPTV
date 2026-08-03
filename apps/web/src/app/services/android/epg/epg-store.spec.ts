import {
    CATCHUP_HISTORY_HOURS,
    catchupHistoryStartIso,
} from './epg-store';

describe('Android EPG catch-up history', () => {
    it('keeps the preceding 24 hours available to a channel lookup', () => {
        const nowMs = Date.parse('2026-08-03T20:00:00.000Z');

        expect(CATCHUP_HISTORY_HOURS).toBe(24);
        expect(catchupHistoryStartIso(nowMs)).toBe(
            '2026-08-02T20:00:00.000Z'
        );
    });
});
