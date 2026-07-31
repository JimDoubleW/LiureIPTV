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

/**
 * Everything the browser focuses on its own.
 *
 * Text entry belongs here. It once did not, on the reasoning that the Android
 * IME makes those fields hostile — but omitting them does not tame the IME, it
 * only makes every form in the app impossible to fill from a remote, starting
 * with the portal credentials. They are reached like anything else; what makes
 * them safe is that the engine hands its arrow keys back while one holds focus.
 */
const NATIVE_FOCUSABLE =
    'a[href], button, select, textarea, [contenteditable="true"],' +
    ' input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])';

/** Elements nearly off-screen still count, so focus can pull the list along. */
const VIEWPORT_MARGIN_PX = 120;

/**
 * Text entry needs different handling: focusing it opens the Android IME, which
 * halves the viewport and swallows key events before the WebView sees them.
 *
 * The answer is *not* to make these unreachable. Excluding them from traversal
 * makes forms impossible to fill from a remote — you cannot even enter the
 * portal credentials the app needs to do anything. Instead they stay reachable,
 * and the navigation engine yields its arrow keys whenever one holds focus, so
 * the IME owns them until the user presses back.
 *
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

/**
 * Whether the browser will focus this element on its own. Exported so the
 * regression that text inputs were absent from the selector — which made every
 * form unreachable by remote — stays covered.
 */
export function isNativelyFocusable(element: Element): boolean {
    return element.matches(NATIVE_FOCUSABLE);
}

/**
 * True when `element` is the outermost element of an inherited `cursor: pointer`
 * chain — that is, the clickable widget itself rather than a fragment of it.
 *
 * `cursor` inherits, so every descendant of a clickable card also reports
 * `pointer`. Treating the innermost match as the target therefore lands focus on
 * whichever paragraph sits deepest inside the card, which is both meaningless
 * and visibly wrong: the focus ring wraps a line of description text instead of
 * the card. Taking the top of the chain gives the widget.
 *
 * Natively focusable descendants are handled separately and stay reachable, so
 * a real button inside a clickable card is not lost.
 */
export function isPointerWidgetRoot(element: HTMLElement): boolean {
    if (getComputedStyle(element).cursor !== 'pointer') {
        return false;
    }

    const parent = element.parentElement;
    return !parent || getComputedStyle(parent).cursor !== 'pointer';
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
 * An element qualifies if the browser focuses it natively, or if it is the root
 * of a `cursor: pointer` chain. That second test is how the app's clickable
 * `div`s are found: the pointer cursor is how it already tells the user "this
 * reacts to a click", which makes it the most reliable signal available without
 * annotating every component.
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
        if (isDisabled(element)) {
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
        if (!isNativelyFocusable(element) && !isPointerWidgetRoot(element)) {
            continue;
        }

        matched.push({ element, rect });
    }

    return matched.map(({ element, rect }) => ({
        target: element,
        rect: toFocusRect(rect),
    }));
}

/**
 * True when the browser already activates this element on Enter.
 *
 * Everything else — the clickable `div`s that make up most tiles and rows —
 * receives the key and does nothing, so the remote's OK button would move focus
 * around a UI it can never actually operate.
 */
export function isNativelyActivatable(element: Element): boolean {
    return element.matches('button, a[href], input, select, textarea, summary');
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
