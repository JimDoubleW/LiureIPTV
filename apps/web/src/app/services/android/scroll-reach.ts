import type { TvDirection } from './spatial-geometry';

/**
 * Scrolling to reveal candidates that are off-screen.
 *
 * Candidate collection is bounded to the viewport, which is what keeps a
 * whole-tree scan affordable. That bound creates a deadlock on any page taller
 * than the screen: the play button on a movie detail sits below the fold, so it
 * is not a candidate, so nothing can focus it, so the page never scrolls to
 * reveal it. The content is unreachable by construction rather than by mistake.
 *
 * When a direction yields nothing, the engine scrolls that way and looks again.
 */

/** How much of the visible extent to travel per press. */
const SCROLL_FRACTION = 0.6;

/** Sub-pixel layout noise should not count as "there is more to see". */
const SCROLL_EPSILON = 2;

function isVerticallyScrollable(element: Element): boolean {
    const overflow = getComputedStyle(element).overflowY;
    return overflow === 'auto' || overflow === 'scroll';
}

function isHorizontallyScrollable(element: Element): boolean {
    const overflow = getComputedStyle(element).overflowX;
    return overflow === 'auto' || overflow === 'scroll';
}

export function canScrollFurther(
    element: Element,
    direction: TvDirection
): boolean {
    switch (direction) {
        case 'down':
            return (
                element.scrollTop + element.clientHeight <
                element.scrollHeight - SCROLL_EPSILON
            );
        case 'up':
            return element.scrollTop > SCROLL_EPSILON;
        case 'right':
            return (
                element.scrollLeft + element.clientWidth <
                element.scrollWidth - SCROLL_EPSILON
            );
        case 'left':
            return element.scrollLeft > SCROLL_EPSILON;
    }
}

/**
 * Nearest ancestor that can still travel in `direction`.
 *
 * Walks up rather than assuming the page scrolls: panels here scroll
 * independently, so the element that needs to move is usually a column, not the
 * document.
 */
export function findScrollableAncestor(
    element: Element,
    direction: TvDirection
): Element | null {
    const vertical = direction === 'up' || direction === 'down';
    let current: Element | null = element;

    while (current) {
        const scrollable = vertical
            ? isVerticallyScrollable(current)
            : isHorizontallyScrollable(current);

        if (scrollable && canScrollFurther(current, direction)) {
            return current;
        }
        current = current.parentElement;
    }

    const root = document.scrollingElement;
    return root && canScrollFurther(root, direction) ? root : null;
}

/**
 * Scrolls to bring more candidates into range. Returns false when nothing could
 * move, so the caller knows this really is the edge and should stop rather than
 * pretend the key did something.
 */
export function scrollToReveal(
    element: Element,
    direction: TvDirection
): boolean {
    const container = findScrollableAncestor(element, direction);
    if (!container) {
        return false;
    }

    const step =
        direction === 'up' || direction === 'down'
            ? container.clientHeight * SCROLL_FRACTION
            : container.clientWidth * SCROLL_FRACTION;

    const delta = direction === 'up' || direction === 'left' ? -step : step;

    if (direction === 'up' || direction === 'down') {
        container.scrollTop += delta;
    } else {
        container.scrollLeft += delta;
    }

    return true;
}
