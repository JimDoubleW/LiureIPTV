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
 * `nav` before `aside`, because the rail is itself an `<aside>` wrapping its
 * `<nav>` links. Testing `aside` first put every rail item in the context
 * region and collapsed the rail instead of the category column.
 */
export function resolveRegion(element: Element): TvRegion {
    if (element.closest('main')) {
        return 'content';
    }
    if (element.closest('nav')) {
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
export function applyRegion(element: Element): void {
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
