/**
 * Geometric D-pad focus movement.
 *
 * The WebView's built-in directional focus is a document-order heuristic: it
 * regularly jumps across the screen because two elements are adjacent in the
 * DOM, not on screen. On a TV that reads as the focus teleporting. We pick the
 * candidate that is actually nearest in the pressed direction instead.
 *
 * Pure functions only — no DOM lookups, so this file is unit-testable.
 */

export type TvDirection = 'up' | 'down' | 'left' | 'right';

export interface FocusRect {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export interface FocusCandidate<T> {
    readonly target: T;
    readonly rect: FocusRect;
}

/**
 * How much a candidate is punished for being off to the side. Distance along
 * the direction of travel is what should decide, so cross-axis error is
 * weighted well above 1 — otherwise pressing "down" over a wide grid drifts
 * diagonally towards whichever cell happens to be marginally closer.
 */
const CROSS_AXIS_PENALTY = 4;

/**
 * Candidates that start slightly "behind" the origin edge still count. Rows in
 * a list share pixel-identical edges, and sub-pixel layout rounding would
 * otherwise drop the neighbour you obviously meant.
 */
const DIRECTION_TOLERANCE = 2;

function centre(rect: FocusRect): { x: number; y: number } {
    return {
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
    };
}

/** Distance travelled along the pressed direction; negative means "behind us". */
function forwardDistance(
    origin: FocusRect,
    candidate: FocusRect,
    direction: TvDirection
): number {
    switch (direction) {
        case 'right':
            return candidate.left - origin.right;
        case 'left':
            return origin.left - candidate.right;
        case 'down':
            return candidate.top - origin.bottom;
        case 'up':
            return origin.top - candidate.bottom;
    }
}

/**
 * Gap between the two rects on the axis perpendicular to travel. Zero when they
 * overlap at all, which is what makes "the row directly below" win over "the
 * row below and three columns across".
 */
function crossAxisGap(
    origin: FocusRect,
    candidate: FocusRect,
    direction: TvDirection
): number {
    const horizontal = direction === 'up' || direction === 'down';

    const originStart = horizontal ? origin.left : origin.top;
    const originEnd = horizontal ? origin.right : origin.bottom;
    const candidateStart = horizontal ? candidate.left : candidate.top;
    const candidateEnd = horizontal ? candidate.right : candidate.bottom;

    if (candidateEnd < originStart) {
        return originStart - candidateEnd;
    }
    if (candidateStart > originEnd) {
        return candidateStart - originEnd;
    }
    return 0;
}

export function scoreCandidate(
    origin: FocusRect,
    candidate: FocusRect,
    direction: TvDirection
): number | null {
    const forward = forwardDistance(origin, candidate, direction);
    if (forward < -DIRECTION_TOLERANCE) {
        return null;
    }

    const gap = crossAxisGap(origin, candidate, direction);

    // Fully overlapping rects (a candidate nested inside the origin, say) score
    // 0 on both axes; fall back to centre distance so ties stay deterministic.
    const originCentre = centre(origin);
    const candidateCentre = centre(candidate);
    const centreDrift =
        Math.abs(originCentre.x - candidateCentre.x) +
        Math.abs(originCentre.y - candidateCentre.y);

    return (
        Math.max(forward, 0) + gap * CROSS_AXIS_PENALTY + centreDrift / 1000
    );
}

/**
 * Best candidate in `direction`, or null when there is nothing that way — in
 * which case the caller should leave focus alone rather than wrap around.
 * Wrapping is disorienting on a TV: the user cannot see where focus went.
 */
export function findBestCandidate<T>(
    origin: FocusRect,
    candidates: readonly FocusCandidate<T>[],
    direction: TvDirection
): T | null {
    let best: T | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const score = scoreCandidate(origin, candidate.rect, direction);
        if (score === null || score >= bestScore) {
            continue;
        }
        best = candidate.target;
        bestScore = score;
    }

    return best;
}
