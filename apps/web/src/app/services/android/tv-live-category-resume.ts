const CONTEXT_PANEL_SELECTOR = 'aside.context-panel:has(.category-item)';
const CATEGORY_SELECTOR = 'button.category-item:not([disabled])';
const RESUME_MARKER_SELECTOR = '[data-tv-resume-category-id]';
// Rendered by `live-stream-layout.component.html` regardless of whether it
// carries a resume id — used to tell "the live route has not mounted at all
// yet" apart from "it mounted and genuinely has nothing to resume", which the
// resume marker alone cannot: Angular omits `[attr.x]` entirely for a null
// value, so an absent marker looks identical in both cases.
const RESUME_HOST_SELECTOR = '.content-container';

export type TrayCategoryTarget =
    | { readonly kind: 'pending' }
    | { readonly kind: 'resume'; readonly category: HTMLElement }
    | { readonly kind: 'first'; readonly category: HTMLElement }
    | { readonly kind: 'none' };

/**
 * Decides what OK on a tray navigation should focus in the Live/VOD/Series
 * category panel.
 *
 * Live TV is the one section with a channel that can already be playing
 * behind that panel. `setSelectedContentType` resets the selected category on
 * every content-type switch — expected for a mouse user, one click from
 * reselecting it — but for a remote it meant landing on whichever category
 * happens to sort first, then hunting back through the whole list to find the
 * one actually playing. `[data-tv-resume-category-id]`, written by
 * `live-stream-layout.component.html` from `LivePlaybackMemoryService`, names
 * that category; when present, this resolves it directly instead of the
 * alphabetically first one.
 *
 * `'pending'` means keep waiting: a resume id is known but its category
 * button has not rendered yet, and settling for the first category instead
 * would abandon a real resume target that is only a beat away.
 */
export function resolveTrayCategoryTarget(
    options: { readonly awaitResume?: boolean } = {}
): TrayCategoryTarget {
    const panel = document.querySelector<HTMLElement>(CONTEXT_PANEL_SELECTOR);
    if (!panel) {
        return { kind: 'pending' };
    }

    const awaitResume = options.awaitResume ?? true;
    if (awaitResume) {
        const resumeId = document.querySelector<HTMLElement>(
            RESUME_MARKER_SELECTOR
        )?.dataset['tvResumeCategoryId'];
        if (resumeId) {
            const resumeCategory = panel.querySelector<HTMLElement>(
                `button.category-item[data-category-id="${resumeId}"]:not([disabled])`
            );
            return resumeCategory
                ? { kind: 'resume', category: resumeCategory }
                : { kind: 'pending' };
        }
        if (!document.querySelector(RESUME_HOST_SELECTOR)) {
            return { kind: 'pending' };
        }
        // The route has mounted and genuinely has nothing to resume: fall
        // through to the first-category default below.
    }

    const category = panel.querySelector<HTMLElement>(CATEGORY_SELECTOR);
    return category ? { kind: 'first', category } : { kind: 'pending' };
}

/**
 * `document.activeElement` defaults to `<body>` when nothing is focused, not
 * `null` — the DOM has no concept of "no active element". A caller that
 * treats a `currentElement` result as "did focus move to something real"
 * needs body folded into `null`, matching `tv-navigation.ts`'s own
 * `currentElement`. Load-bearing here: confirming the resume category marks
 * its now-collapsing panel `inert`, which forcibly blurs the button just
 * clicked to `<body>` before the caller's next check runs.
 */
export function currentFocusedElement(): HTMLElement | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && active !== document.body
        ? active
        : null;
}
