/**
 * XMLTV datetime → ISO 8601 UTC.
 *
 * The UTC normalisation is not cosmetic. Programme times are stored as text and
 * compared lexicographically in SQL (`start <= ?`), which is only correct when
 * every stored value shares one representation. Leaving an offset in place
 * would make "2026-04-15T05:37:00+01:00" sort against an always-UTC `now`
 * string by character, not by instant.
 *
 * Ported from the Electron parser rather than imported: Nx boundaries forbid
 * app-to-app imports, and copying 30 lines beats widening a shared library.
 */

const XMLTV_DATE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/;

export function parseXmltvDate(dateStr: string): string {
    if (!dateStr) {
        return '';
    }

    const match = XMLTV_DATE.exec(dateStr);
    if (!match) {
        return dateStr;
    }

    const [, year, month, day, hour, minute, second, tz] = match;

    if (!tz) {
        return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    }

    // The sign is read from the string, never derived from the hours value:
    // Math.sign(0) would silently discard the minutes of offsets like "+0030".
    const offsetSign = tz.startsWith('-') ? -1 : 1;
    const offsetMinutes =
        offsetSign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3)));

    return new Date(
        Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute) - offsetMinutes,
            Number(second)
        )
    ).toISOString();
}
