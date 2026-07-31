import { parseXmltvDate } from './xmltv-date';

describe('parseXmltvDate', () => {
    it('reads a UTC timestamp', () => {
        expect(parseXmltvDate('20260415053700 +0000')).toBe(
            '2026-04-15T05:37:00.000Z'
        );
    });

    it('normalises a positive offset to UTC', () => {
        // Storing the offset verbatim would break `start <= ?`, which compares
        // these strings character by character.
        expect(parseXmltvDate('20260415053700 +0200')).toBe(
            '2026-04-15T03:37:00.000Z'
        );
    });

    it('normalises a negative offset to UTC', () => {
        expect(parseXmltvDate('20260415053700 -0530')).toBe(
            '2026-04-15T11:07:00.000Z'
        );
    });

    it('keeps the minutes of a half-hour offset', () => {
        // Deriving the sign from the hours would drop these minutes entirely.
        expect(parseXmltvDate('20260415053700 +0030')).toBe(
            '2026-04-15T05:07:00.000Z'
        );
    });

    it('treats a missing offset as UTC', () => {
        expect(parseXmltvDate('20260415053700')).toBe('2026-04-15T05:37:00Z');
    });

    it('passes through anything it cannot read', () => {
        expect(parseXmltvDate('not-a-date')).toBe('not-a-date');
        expect(parseXmltvDate('')).toBe('');
    });
});
