import type { ZoneMemory } from './focus-zones';

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
 * The category column that browses Live/VOD/Series content.
 *
 * `aside.context-panel` is a shared workspace-shell wrapper, not something
 * unique to that browsing screen: the Settings page's own category list
 * (General/Playback/EPG/...) renders inside the exact same wrapper class. An
 * earlier version of this selector collapsed and `inert`-ed whichever
 * `aside.context-panel` happened to be on screen, which took the Settings
 * category list down with it — down to a literal 0×0 rect, unreachable by any
 * key — the moment focus had last resolved to the 'content' region (which
 * happens almost immediately on most pages). `:has(.category-item)` scopes
 * this to the one screen where collapsing is actually the intended,
 * reference-player-derived behaviour: `.category-item` is the class the Live/VOD/
 * Series category rows render with (`workspace-context-category-view`),
 * which Settings does not use.
 */
const CONTEXT_PANEL_SELECTOR = 'aside.context-panel:has(.category-item)';

/**
 * The Android TV live layout is made of four focus scopes. Spatial geometry
 * must not jump between them: a header control can be very close to the top
 * row of Channels or the video, but changing panels is an explicit OK/BACK
 * action. The selectors are deliberately limited to the live shell so other
 * Android pages keep their normal spatial navigation.
 */
const TV_PANEL_SELECTORS = {
    rail: 'aside.app-rail',
    header: 'app-workspace-shell-header',
    categories: CONTEXT_PANEL_SELECTOR,
    channels: '.sidebar',
    playback: '.content-container',
} as const;

type TvPanelScope = keyof typeof TV_PANEL_SELECTORS;

function resolveTvPanelScope(element: Element): TvPanelScope | null {
    // The most specific scopes must win when a test fixture or a future shell
    // nests landmarks differently.
    if (element.closest(TV_PANEL_SELECTORS.channels)) return 'channels';
    if (element.closest(TV_PANEL_SELECTORS.playback)) return 'playback';
    if (element.closest(TV_PANEL_SELECTORS.categories)) return 'categories';
    if (element.closest(TV_PANEL_SELECTORS.header)) return 'header';
    if (element.closest(TV_PANEL_SELECTORS.rail)) return 'rail';
    return null;
}

/**
 * Prevent generic spatial navigation from crossing Android TV live panels.
 * Internal movement inside a panel is still allowed in every direction;
 * panel transitions are handled by the semantic OK/BACK hierarchy.
 */
export function isTvPanelCrossingAllowed(
    origin: Element,
    target: Element
): boolean {
    const originScope = resolveTvPanelScope(origin);
    const targetScope = resolveTvPanelScope(target);
    return (
        originScope === null ||
        targetScope === null ||
        originScope === targetScope
    );
}

/**
 * Whether focus may move from `origin` to `target` at all.
 *
 * Both boundary rules in one place, because they have to be applied to every
 * element the engine is about to focus — not only to the geometric candidate.
 * A panel-memory recall that skips them re-opens the boundary from the other
 * side: the destination is then chosen by what was focused last rather than by
 * where the user pointed, and lands in a panel the direction never asked for.
 */
export function isPanelTransitionAllowed(
    origin: Element,
    target: Element,
    direction: 'up' | 'down' | 'left' | 'right'
): boolean {
    return (
        isRegionCrossingAllowed(origin, target, direction) &&
        isTvPanelCrossingAllowed(origin, target)
    );
}

/**
 * The remembered selection of the panel geometry pointed at, or null when that
 * memory must not be honoured.
 *
 * Two things can go wrong with a plain `memory.recall`, and both surface as
 * focus landing in a panel the pressed direction never asked for.
 *
 * `document.body` is not a panel. `resolveZone` falls back to it for anything
 * with no landmark ancestor and no scroll container of its own, which on the
 * live screen is the player control bar, the channel list's header buttons and
 * the workspace header all at once. Recalling from that one shared slot hands
 * the remote to whichever of them was focused last, in whichever panel that
 * happened to be.
 *
 * And a recall replaces the target *after* the crossing guards ran, so even a
 * genuine per-panel memory can point across a boundary the geometric candidate
 * was not allowed to cross. Re-checking the destination is what keeps OK/BACK
 * the only way between live-TV panels.
 */
export function recallPanelSelection(
    memory: ZoneMemory,
    origin: Element,
    zone: Element,
    direction: 'up' | 'down' | 'left' | 'right'
): HTMLElement | null {
    if (zone === document.body) {
        return null;
    }

    const remembered = memory.recall(zone);
    if (!remembered) {
        return null;
    }

    return isPanelTransitionAllowed(origin, remembered, direction)
        ? remembered
        : null;
}

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

    return (
        (resolveRegion(origin) === 'rail') ===
        (resolveRegion(target) === 'rail')
    );
}

/**
 * A category row in the context column (Live, Movies and Series all render
 * their categories through the same `button.category-item`).
 *
 * These are explicit OK targets: moving focus across the category list must
 * not reload a potentially large channel collection. Scoped tightly on
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
    // The shared live-sidebar service can leave this class on the panel after
    // a previous TV session. BACK/OK is an explicit UI transition, so remove
    // the stale class immediately; the route-entry effect owns persistence for
    // the next Live TV visit.
    panel.classList.remove('context-panel--collapsed');

    // Force layout so the caller measures the expanded panel, not the old one.
    panel.getBoundingClientRect();
    return panel;
}

/**
 * Explicitly folds the live/VOD/series category column after the viewer
 * confirms a category. Unlike `applyRegion`, this is an action: focus may
 * still be on the category button, so the panel is made inert immediately
 * and the caller moves focus into the content list afterwards.
 */
export function collapseContext(): HTMLElement | null {
    const panel = getContextPanel();
    if (!panel) {
        return null;
    }

    document.documentElement.setAttribute(REGION_ATTRIBUTE, 'content');
    panel.setAttribute('inert', '');
    return panel;
}

/** Whether the live category column is currently folded. */
export function isContextCollapsed(): boolean {
    const panel = getContextPanel();
    return (
        panel !== null &&
        (panel.hasAttribute('inert') ||
            document.documentElement.getAttribute(REGION_ATTRIBUTE) ===
                'content')
    );
}
