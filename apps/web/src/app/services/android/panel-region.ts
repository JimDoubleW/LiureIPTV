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

export function applyRegion(element: Element): void {
    document.documentElement.setAttribute(
        REGION_ATTRIBUTE,
        resolveRegion(element)
    );
}
