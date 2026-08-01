/**
 * Per-panel focus memory.
 *
 * The single rule taken from the TiviMate benchmark: every panel keeps its own
 * selection marked, and only the focused panel promotes that selection to the
 * bright pill. Returning to a panel returns you where you were.
 *
 * "Three visual states" and "position memory" are the same mechanism, not two
 * features — see docs/android-port/tv-navigation-reference.md.
 *
 * Zones are inferred from the DOM so that no existing component has to be
 * annotated: a panel is either an explicit `[data-tv-zone]`, an independently
 * scrolling container, or a structural landmark. Keeping this inference here
 * means the port adds files instead of editing shared components.
 */

/** Set on the remembered element of every zone; CSS renders the subtle fill. */
export const SELECTED_ATTRIBUTE = 'data-tv-selected';

const ZONE_ATTRIBUTE = 'data-tv-zone';

const LANDMARK_SELECTOR =
    '[data-tv-zone], nav, aside, mat-sidenav, mat-nav-list, mat-toolbar,' +
    ' [role="navigation"], [role="toolbar"], [role="listbox"], [role="tablist"]';

const zoneIds = new WeakMap<Element, string>();
let nextZoneId = 0;

function zoneIdFor(element: Element): string {
    const explicit = element.getAttribute(ZONE_ATTRIBUTE);
    if (explicit) {
        return explicit;
    }

    let id = zoneIds.get(element);
    if (!id) {
        id = `zone-${nextZoneId++}`;
        zoneIds.set(element, id);
    }
    return id;
}

function isScrollContainer(element: Element): boolean {
    const style = getComputedStyle(element);
    const overflow = `${style.overflowY} ${style.overflowX}`;
    if (!overflow.includes('auto') && !overflow.includes('scroll')) {
        return false;
    }

    return (
        element.scrollHeight > element.clientHeight ||
        element.scrollWidth > element.clientWidth
    );
}

/**
 * The panel `element` belongs to. Walks up to the first explicit zone, scroll
 * container or landmark; falls back to `document.body` so every element always
 * has exactly one zone.
 */
export function resolveZone(element: Element): Element {
    // An explicit tag wins over any landmark, even one nested inside it. This
    // is what makes the whole rail one zone: it is tagged `data-tv-zone`, but
    // its content is broken into several small `<nav>` islands (one per
    // section grouping), and `<nav>` matches the landmark selector too. Without
    // checking the explicit tag first, each inner `<nav>` would still win the
    // walk before reaching the tagged ancestor, fragmenting one list into
    // several independent memory slots. Two links sit outside every island (the
    // brand link, the settings footer) and both fell back to the same outer
    // `<aside>` as their only landmark — aliasing them to one shared slot, so
    // whichever was focused more recently silently ate the other's memory.
    let explicit: Element | null = element.parentElement;
    while (explicit && explicit !== document.body) {
        if (explicit.hasAttribute(ZONE_ATTRIBUTE)) {
            return explicit;
        }
        explicit = explicit.parentElement;
    }

    let current: Element | null = element.parentElement;

    while (current && current !== document.body) {
        if (current.matches(LANDMARK_SELECTOR) || isScrollContainer(current)) {
            return current;
        }
        current = current.parentElement;
    }

    return document.body;
}

export class ZoneMemory {
    private readonly selection = new Map<string, HTMLElement>();

    /** Records `element` as its zone's selection and marks it for styling. */
    remember(element: HTMLElement): void {
        const zone = resolveZone(element);
        const id = zoneIdFor(zone);

        const previous = this.selection.get(id);
        if (previous && previous !== element) {
            previous.removeAttribute(SELECTED_ATTRIBUTE);
        }

        element.setAttribute(SELECTED_ATTRIBUTE, '');
        this.selection.set(id, element);
    }

    /**
     * The element to focus when entering `zone`, or null when this zone has no
     * usable memory — a remembered node may have been detached by virtual
     * scrolling or a route change, in which case the caller should fall back to
     * plain geometry.
     */
    recall(zone: Element): HTMLElement | null {
        const remembered = this.selection.get(zoneIdFor(zone));
        if (!remembered) {
            return null;
        }

        if (!remembered.isConnected) {
            this.selection.delete(zoneIdFor(zone));
            remembered.removeAttribute(SELECTED_ATTRIBUTE);
            return null;
        }

        const rect = remembered.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return null;
        }

        // Attached and correctly sized is not the same as "still what's on
        // screen": one zone can be a single large scroll container shared by
        // several unrelated sections (Settings' content pane holds all eight
        // of its category sections — General, Playback, EPG, ... — in one
        // `scrollHeight: 5496 / clientHeight: 484` column). Clicking a
        // different category anchor-scrolls that SAME zone to a completely
        // different section without detaching or resizing anything, so the
        // remembered element from whatever section was visited last would
        // otherwise still pass every check above while sitting far outside
        // the viewport. Confirmed on the reference device: selecting Metadaten
        // then pressing right recalled a button from the EPG section instead
        // of landing on Metadaten's own content, because both belong to this
        // one zone. Requiring the remembered element to still intersect the
        // viewport is what tells "same panel, still showing" apart from "same
        // zone, but scrolled to entirely different content since".
        const onScreen =
            rect.bottom > 0 &&
            rect.top < window.innerHeight &&
            rect.right > 0 &&
            rect.left < window.innerWidth;

        return onScreen ? remembered : null;
    }
}
