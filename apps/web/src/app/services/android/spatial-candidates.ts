import type { FocusCandidate, FocusRect } from './spatial-geometry';

/**
 * Discovery of what the D-pad may land on.
 *
 * Two constraints shape this file:
 *
 * - Much of the app is clickable `div`s (channel tiles, category rows) that no
 *   native selector finds. Those must be reachable or whole screens are dead
 *   ends on a remote.
 * - Scanning every element on a 6 000-row screen once per key press is not
 *   affordable on an in-order A55, so discovery is bounded by a selector and
 *   by the viewport.
 */

/** Natively focusable, minus text entry — see `isTextEntry`. */
const NATIVE_FOCUSABLE =
    'a[href], button, select, [tabindex]:not([tabindex="-1"])';

/** Elements nearly off-screen still count, so focus can pull the list along. */
const VIEWPORT_MARGIN_PX = 120;

/**
 * Focusing a text field opens the Android IME, which halves the viewport and
 * swallows the remote's key events before the WebView ever sees them — the
 * remote goes dead until the user finds "back". Text entry is therefore never
 * an arrow-key destination; search has to be a destination screen instead.
 * See docs/android-port/tv-navigation-reference.md.
 */
export function isTextEntry(element: Element): boolean {
    const tag = element.tagName;
    if (tag === 'TEXTAREA') {
        return true;
    }
    if (tag !== 'INPUT') {
        // The attribute covers explicit markup; `isContentEditable` also
        // catches editability inherited from an ancestor, but is not
        // implemented by jsdom, so neither check is sufficient alone.
        const attribute = element.getAttribute('contenteditable');
        return (
            attribute === '' ||
            attribute === 'true' ||
            (element as HTMLElement).isContentEditable === true
        );
    }

    const type = (element as HTMLInputElement).type;
    return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio';
}

function isDisabled(element: Element): boolean {
    return (
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.closest('[aria-hidden="true"], [inert]') !== null
    );
}

function isNativelyFocusable(element: Element): boolean {
    return element.matches(NATIVE_FOCUSABLE);
}

function isVisible(element: HTMLElement, rect: DOMRect): boolean {
    if (rect.width <= 0 || rect.height <= 0) {
        return false;
    }

    const style = getComputedStyle(element);
    return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
    );
}

function isWithinViewport(rect: DOMRect, width: number, height: number): boolean {
    return (
        rect.bottom > -VIEWPORT_MARGIN_PX &&
        rect.right > -VIEWPORT_MARGIN_PX &&
        rect.top < height + VIEWPORT_MARGIN_PX &&
        rect.left < width + VIEWPORT_MARGIN_PX
    );
}

function toFocusRect(rect: DOMRect): FocusRect {
    return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    };
}

/**
 * Every element the D-pad may move to right now.
 *
 * `cursor: pointer` is the tie-breaker for elements matched only by
 * `CLICKABLE_HINT`: it is how the app already tells the user "this reacts to a
 * click", so it is the most reliable signal available without annotating every
 * component. `getComputedStyle` is why the candidate set is bounded first.
 */
export function collectCandidates(
    root: ParentNode = document
): FocusCandidate<HTMLElement>[] {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Array.from rather than iterating the NodeList directly: the web tsconfig
    // enables neither `downlevelIteration` nor `DOM.Iterable`, and a for...of
    // here compiles under Jest but fails the production build.
    const all = Array.from(root.querySelectorAll<HTMLElement>('*'));

    const matched: { element: HTMLElement; rect: DOMRect }[] = [];

    for (const element of all) {
        if (isDisabled(element) || isTextEntry(element)) {
            continue;
        }

        // Cheap geometric rejection first: this is what keeps a whole-tree scan
        // affordable. Measured on the reference device, the rect filter plus
        // getComputedStyle over an 89-element viewport costs ~5.5 ms.
        const rect = element.getBoundingClientRect();
        if (!isWithinViewport(rect, viewportWidth, viewportHeight)) {
            continue;
        }
        if (!isVisible(element, rect)) {
            continue;
        }
        if (
            !isNativelyFocusable(element) &&
            getComputedStyle(element).cursor !== 'pointer'
        ) {
            continue;
        }

        matched.push({ element, rect });
    }

    // Keep the innermost match only. A clickable card and the clickable row
    // inside it both qualify, and focusing the outer one makes everything it
    // wraps unreachable.
    return matched
        .filter(
            ({ element }) =>
                !matched.some(
                    (other) =>
                        other.element !== element && element.contains(other.element)
                )
        )
        .map(({ element, rect }) => ({
            target: element,
            rect: toFocusRect(rect),
        }));
}

/**
 * Makes `element` focusable if it is not already. Clickable `div`s have no
 * tabindex, and `focus()` is a no-op without one.
 */
export function ensureFocusable(element: HTMLElement): void {
    if (!element.hasAttribute('tabindex') && !isNativelyFocusable(element)) {
        element.setAttribute('tabindex', '-1');
    }
}
