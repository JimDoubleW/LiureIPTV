/**
 * Which region of the workspace currently holds focus.
 *
 * Drives progressive panel collapse: screen width is the scarce resource on a
 * TV, and a panel should only pay for its full width while it is being used.
 * The benchmark sheds the panel behind you at every step right; here the
 * category column narrows once focus reaches the content.
 *
 * Regions are read from semantic landmarks (`nav`, `aside`, `main`) rather than
 * from the app's class names, so upstream restyling does not silently break the
 * behaviour. The worst case if the markup changes is that nothing collapses.
 */

/** The navigation rail, which is an `<aside>` as well. */
const RAIL_SELECTOR = 'aside.app-rail';

/**
 * Marks the rail as one zone for `resolveZone` (focus-zones.ts), which
 * otherwise fragments it: its sections are separate `<nav>` islands, and two
 * links belong to none of them (the brand link, the settings footer),
 * aliasing to a shared slot that let their memories overwrite each other and
 * made "Open settings" unreachable whenever the brand link was the more
 * recently remembered one.
 */
const ZONE_ATTRIBUTE = 'data-tv-zone';
const RAIL_ZONE_ID = 'android-rail';

export type TvRegion = 'rail' | 'context' | 'content';

/** Set on the document element; the stylesheet keys off it. */
export const REGION_ATTRIBUTE = 'data-tv-region';

/**
 * The region `element` belongs to.
 *
 * Order matters twice over.
 *
 * `main` first: the content area must win when landmarks nest, since collapsing
 * a panel that contains the focus would pull the ground out from under the user.
 *
 * The rail is matched by class before any `<aside>` test, because it is itself
 * an `<aside>`. Matching on `<nav>` alone was not enough: the brand link at the
 * top of the rail sits outside the `<nav>`, so landing on it reported the
 * context region and the rail refused to expand.
 */
export function resolveRegion(element: Element): TvRegion {
    if (element.closest('main')) {
        return 'content';
    }
    if (element.closest(RAIL_SELECTOR) || element.closest('nav')) {
        return 'rail';
    }
    if (element.closest('aside')) {
        return 'context';
    }

    // Toolbars and dialogs are neither, and must not collapse anything —
    // treating them as content would hide the category column behind a dialog.
    return 'context';
}

/**
 * The category column. Named explicitly because the rail is an `<aside>` too,
 * so a bare `aside` selector would collapse the navigation rail as well.
 */
const CONTEXT_PANEL_SELECTOR = 'aside.context-panel';


export function getContextPanel(): HTMLElement | null {
    return document.querySelector<HTMLElement>(CONTEXT_PANEL_SELECTOR);
}

/**
 * Publishes the region and takes the collapsed column out of the focus order.
 *
 * `inert` is what makes a full-width collapse safe. Narrowing the panel alone
 * does not shrink its children: they keep their layout box and simply overflow
 * the clipped container, so they stay perfectly focusable while being invisible
 * on screen — measured at `max-width: 1px`, ten items still reported a 28 px
 * width. Focus would disappear into a panel nobody can see, which is more
 * disorienting than a hard stop. `inert` removes them from focus outright, and
 * `collectCandidates` already skips anything inside `[inert]`.
 */
/**
 * Whether a move in `direction` may go from `origin` to `target`.
 *
 * Vertical movement never crosses the rail boundary, in either direction. The
 * rail is a narrow column spanning the full screen height, which makes it the
 * spatial neighbour of everything: pressing down on a movie detail's back
 * button scored a rail link (x=8, nearly aligned) above the Play button
 * (x=390, penalised on the cross axis), so the rail kept capturing focus that
 * belonged to the content. Entering and leaving the rail is what left/right
 * are for.
 */
export function isRegionCrossingAllowed(
    origin: Element,
    target: Element,
    direction: 'up' | 'down' | 'left' | 'right'
): boolean {
    if (direction === 'left' || direction === 'right') {
        return true;
    }

    return (resolveRegion(origin) === 'rail') === (resolveRegion(target) === 'rail');
}

/**
 * A category row in the context column (Live, Movies and Series all render
 * their categories through the same `button.category-item`).
 *
 * These follow focus instead of waiting for OK: the column is a master list
 * whose detail pane should track it, as on the benchmark. Scoped tightly on
 * purpose — the panel header holds search/sort/refine buttons, and the rail
 * holds section links, where activating on focus would fire searches and
 * navigations merely because the focus passed by.
 */
export function isContextCategoryItem(element: Element): boolean {
    return (
        element.matches('button.category-item') &&
        element.closest(CONTEXT_PANEL_SELECTOR) !== null
    );
}

/** Whether this category is already the active one — re-clicking it reloads. */
export function isAlreadySelectedCategory(element: Element): boolean {
    return element.getAttribute('aria-current') === 'true';
}

export function applyRegion(element: Element): void {
    tagRailZone();

    const region = resolveRegion(element);
    document.documentElement.setAttribute(REGION_ATTRIBUTE, region);

    const panel = getContextPanel();
    if (!panel) {
        return;
    }

    if (region === 'content') {
        panel.setAttribute('inert', '');
    } else {
        panel.removeAttribute('inert');
    }
}

/**
 * Brings the category column back and makes it focusable again.
 *
 * Returns the panel so the caller can move focus into it; a collapsed panel is
 * unreachable by geometry alone, so the navigation engine has to ask for this
 * explicitly when the user presses left with nowhere to go.
 */
/**
 * The last element focused inside the category column.
 *
 * The column holds several focus zones — a search affordance in its header, the
 * category list below — and each keeps its own selection mark. Picking the
 * first mark in DOM order therefore lands on the header rather than on the row
 * the user actually left, so the last position is tracked explicitly.
 */
let lastContextFocus: HTMLElement | null = null;

export function noteContextFocus(element: HTMLElement): void {
    if (getContextPanel()?.contains(element)) {
        lastContextFocus = element;
    }
}

export function getLastContextFocus(): HTMLElement | null {
    if (lastContextFocus && !lastContextFocus.isConnected) {
        lastContextFocus = null;
    }
    return lastContextFocus;
}

/**
 * Idempotent: cheap enough to call on every focus move, which is what handles
 * the rail being re-rendered by Angular after this module last ran.
 */
function tagRailZone(): void {
    const rail = document.querySelector(RAIL_SELECTOR);
    if (rail && rail.getAttribute(ZONE_ATTRIBUTE) !== RAIL_ZONE_ID) {
        rail.setAttribute(ZONE_ATTRIBUTE, RAIL_ZONE_ID);
    }
}

export function expandContext(): HTMLElement | null {
    const panel = getContextPanel();
    if (!panel) {
        return null;
    }

    document.documentElement.setAttribute(REGION_ATTRIBUTE, 'context');
    panel.removeAttribute('inert');

    // Force layout so the caller measures the expanded panel, not the old one.
    panel.getBoundingClientRect();
    return panel;
}
