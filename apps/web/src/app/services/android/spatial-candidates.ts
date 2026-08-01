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

/**
 * How far beyond the viewport an element still counts as reachable.
 *
 * Generous on purpose. A movie detail puts its Play button at y=710 on a 540 px
 * viewport — 170 px below the fold — and a tight margin made it invisible to
 * the search, so nothing could focus it and therefore nothing ever scrolled it
 * into view. Focusing applies `scrollIntoView`, so a candidate just off-screen
 * is brought in rather than focused blindly.
 */
const VIEWPORT_MARGIN_PX = 600;

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

/** Within this many pixels, two rects are treated as "the same spot". */
const OVERLAP_TOLERANCE_PX = 2;

/**
 * True when a natively-focusable descendant fills `element`'s own rect —
 * meaning `element` is not a widget in its own right, just a `cursor: pointer`
 * shell wrapping the real control, and should defer to it rather than compete
 * with it as a second candidate at the same spot.
 *
 * `mat-checkbox` is the confirmed case: its internal `div.mdc-checkbox`
 * carries `cursor: pointer` (qualifying as a pointer-widget-root on its own,
 * `tabindex="-1"` notwithstanding — this engine does not treat that attribute
 * as exclusionary, since `ensureFocusable` stamps the same value onto every
 * clickable div it has ever focused) and exactly overlaps the real, tabbable
 * `<input>` positioned inside it. Document order lists a parent before its
 * children, so this wrapper was always discovered first — and any tie in
 * `findBestCandidate` keeps whichever candidate was found first — so it
 * always won over the input it wraps. Clicking it did not toggle anything:
 * confirmed on the reference device, where the "real button inside a
 * clickable card" case this function's sibling check exists for does not
 * apply here, since the checkbox has no such card — the two elements occupy
 * the identical rect rather than the wrapper being larger than an inner
 * button, which is what still legitimately keeps both reachable elsewhere
 * (e.g. a movie card and its own Play button).
 */
function wrapsFullyOverlappingFocusableDescendant(
    element: HTMLElement,
    rect: DOMRect
): boolean {
    const descendants = Array.from(
        element.querySelectorAll<HTMLElement>(NATIVE_FOCUSABLE)
    );
    return descendants.some((descendant) => {
        const d = descendant.getBoundingClientRect();
        return (
            Math.abs(d.width - rect.width) < OVERLAP_TOLERANCE_PX &&
            Math.abs(d.height - rect.height) < OVERLAP_TOLERANCE_PX &&
            Math.abs(d.top - rect.top) < OVERLAP_TOLERANCE_PX &&
            Math.abs(d.left - rect.left) < OVERLAP_TOLERANCE_PX
        );
    });
}

/**
 * `opacitySensitive` is false for elements the browser already focuses
 * natively (`isNativelyFocusable`). `mat-checkbox`, `mat-radio-button` and
 * `mat-slide-toggle` all render their real, tabbable native `<input>` at
 * `opacity: 0` and paint the visible mark on a sibling — a standard technique
 * for a custom-styled native control, not a sign the control is actually
 * hidden. Confirmed on the reference device: every checkbox across every
 * Settings section had `opacity: 0` on its focusable input, `cursor: auto`
 * (not `pointer`) on the outer `<mat-checkbox>`, and a `display: none` label —
 * so neither element passed the old check, and checkboxes were completely
 * unreachable by the D-pad. A real browser's own Tab order does not exclude
 * `opacity: 0` either — only `display: none`/`visibility: hidden` remove an
 * element from it — so this brings the check in line with that, rather than
 * inventing a stricter rule than the platform itself uses. Layout presence
 * (`rect.width/height`) and `visibility`/`display` still gate every element,
 * native or not, so a genuinely collapsed or detached control stays excluded.
 */
function isVisible(
    element: HTMLElement,
    rect: DOMRect,
    opacitySensitive: boolean
): boolean {
    if (rect.width <= 0 || rect.height <= 0) {
        return false;
    }

    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') {
        return false;
    }

    return !opacitySensitive || style.opacity !== '0';
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
        const nativelyFocusable = isNativelyFocusable(element);
        if (!isVisible(element, rect, !nativelyFocusable)) {
            continue;
        }
        if (
            !nativelyFocusable &&
            (!isPointerWidgetRoot(element) ||
                wrapsFullyOverlappingFocusableDescendant(element, rect))
        ) {
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
