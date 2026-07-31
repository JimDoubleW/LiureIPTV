import {
    findBestCandidate,
    scoreCandidate,
    type FocusCandidate,
    type FocusRect,
} from './spatial-geometry';

function rect(
    left: number,
    top: number,
    width: number,
    height: number
): FocusRect {
    return { left, top, right: left + width, bottom: top + height };
}

function candidate(
    name: string,
    left: number,
    top: number,
    width = 100,
    height = 40
): FocusCandidate<string> {
    return { target: name, rect: rect(left, top, width, height) };
}

describe('spatial geometry', () => {
    describe('scoreCandidate', () => {
        it('rejects candidates behind the origin', () => {
            const origin = rect(100, 100, 100, 40);

            expect(scoreCandidate(origin, rect(0, 100, 100, 40), 'right')).toBeNull();
            expect(scoreCandidate(origin, rect(300, 100, 100, 40), 'left')).toBeNull();
            expect(scoreCandidate(origin, rect(100, 0, 100, 40), 'down')).toBeNull();
            expect(scoreCandidate(origin, rect(100, 300, 100, 40), 'up')).toBeNull();
        });

        it('accepts a candidate sharing the origin edge, despite rounding', () => {
            const origin = rect(0, 0, 100, 40);

            // Adjacent list rows commonly share an edge to the pixel; a strict
            // comparison would discard the row directly below.
            expect(scoreCandidate(origin, rect(0, 40, 100, 40), 'down')).not.toBeNull();
            expect(
                scoreCandidate(origin, rect(0, 39, 100, 40), 'down')
            ).not.toBeNull();
        });
    });

    describe('findBestCandidate', () => {
        it('picks the nearest element in the pressed direction', () => {
            const origin = rect(0, 0, 100, 40);
            const found = findBestCandidate(
                origin,
                [candidate('far', 400, 0), candidate('near', 120, 0)],
                'right'
            );

            expect(found).toBe('near');
        });

        it('prefers the aligned neighbour over a closer misaligned one', () => {
            const origin = rect(0, 100, 100, 40);

            // "aligned" is further down the screen but shares the origin's
            // columns; "drifted" is marginally nearer yet sits three columns
            // across. Pressing down must not wander sideways.
            const found = findBestCandidate(
                origin,
                [candidate('drifted', 600, 145), candidate('aligned', 0, 160)],
                'down'
            );

            expect(found).toBe('aligned');
        });

        it('returns null rather than wrapping when nothing lies that way', () => {
            const origin = rect(0, 0, 100, 40);
            const found = findBestCandidate(origin, [candidate('above', 0, -80)], 'down');

            expect(found).toBeNull();
        });

        it('moves one row at a time down a uniform list', () => {
            const rows = [
                candidate('row0', 0, 0),
                candidate('row1', 0, 40),
                candidate('row2', 0, 80),
                candidate('row3', 0, 120),
            ];

            expect(findBestCandidate(rect(0, 0, 100, 40), rows, 'down')).toBe('row1');
            expect(findBestCandidate(rect(0, 40, 100, 40), rows, 'down')).toBe('row2');
            expect(findBestCandidate(rect(0, 80, 100, 40), rows, 'up')).toBe('row1');
        });

        it('crosses from a list into the panel beside it', () => {
            // A channel row on the left, EPG cells on the right: pressing right
            // must land on the vertically-overlapping cell, not the first one.
            const origin = rect(0, 200, 300, 40);
            const found = findBestCandidate(
                origin,
                [
                    candidate('cell-top', 320, 0, 200),
                    candidate('cell-aligned', 320, 200, 200),
                    candidate('cell-bottom', 320, 400, 200),
                ],
                'right'
            );

            expect(found).toBe('cell-aligned');
        });
    });
});
