/**
 * Focus for text fields that does not hand them to the browser.
 *
 * Android raises the soft keyboard the instant a text input takes DOM focus,
 * and a keyboard that appears merely because focus crossed a search box covers
 * half a TV screen. Suppressing it with `inputmode="none"` looked like the fix
 * and is a dead end: with the keyboard suppressed the system swallows the OK
 * key outright, so the page never receives the event that would restore it —
 * the field becomes impossible to type in at all.
 *
 * So text fields are never given real focus while navigating. They are marked
 * as *virtually* focused: styled like any other focused element, reachable and
 * leavable, with DOM focus left on the body so the D-pad keeps working.
 * Pressing OK grants real focus, and the keyboard then opens on its own.
 */

/** Styled exactly like `:focus`; see tv-focus.styles.ts. */
export const VIRTUAL_FOCUS_ATTRIBUTE = 'data-tv-virtual-focus';

let current: HTMLElement | null = null;

/** Marks `element` as focused without letting the browser focus it. */
export function setVirtualFocus(element: HTMLElement): void {
    clearVirtualFocus();

    // DOM focus must not stay on a previously focused control, or two things
    // look focused at once.
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    element.setAttribute(VIRTUAL_FOCUS_ATTRIBUTE, '');
    current = element;
}

export function clearVirtualFocus(): void {
    current?.removeAttribute(VIRTUAL_FOCUS_ATTRIBUTE);
    current = null;
}

/**
 * The virtually focused element, or null. Detached nodes are dropped: a route
 * change or virtual scrolling can remove one while it still holds the mark.
 */
export function getVirtualFocus(): HTMLElement | null {
    if (current && !current.isConnected) {
        current = null;
    }
    return current;
}

/**
 * Hands real focus to the virtually focused field, which is what raises the
 * keyboard. Returns false when there was nothing to promote.
 */
export function promoteVirtualFocus(): boolean {
    const field = getVirtualFocus();
    if (!field) {
        return false;
    }

    clearVirtualFocus();
    field.focus({ preventScroll: true });
    return true;
}
