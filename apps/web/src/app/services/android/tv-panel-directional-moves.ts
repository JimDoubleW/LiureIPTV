import { focusFromEpgBoundary } from './tv-playback-focus';
import type { TvDirection } from './spatial-geometry';

type ApplyFocus = (element: HTMLElement) => void;

const EPG_ROW_SELECTOR = 'app-epg-list-view-row';
const EPG_ROW_ACTION_SELECTOR = '[data-tv-row-action]';
const EPG_LIST_SELECTOR = 'app-epg-list-view';

function epgRows(root: ParentNode = document): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(EPG_ROW_SELECTOR));
}

/** LEFT/RIGHT walks a card's own action row instead of leaving it. */
export function moveWithinActionCard(
    origin: HTMLElement,
    direction: TvDirection,
    applyFocus: ApplyFocus
): boolean {
    const card = origin.closest<HTMLElement>('[data-tv-action-card]');
    const actionRow = card?.querySelector<HTMLElement>('[data-tv-action-row]');
    if (!card || !actionRow) {
        return false;
    }

    const actions = Array.from(
        actionRow.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    );
    if (actions.length === 0) {
        return false;
    }

    if (origin === card && direction === 'right') {
        applyFocus(actions[0]);
        return true;
    }

    const actionIndex = actions.indexOf(origin as HTMLButtonElement);
    if (actionIndex < 0) {
        return false;
    }
    if (direction === 'right' && actionIndex < actions.length - 1) {
        applyFocus(actions[actionIndex + 1]);
        return true;
    }
    if (direction === 'right' && actionIndex === actions.length - 1) {
        return true;
    }
    if (direction === 'left' && actionIndex > 0) {
        applyFocus(actions[actionIndex - 1]);
        return true;
    }
    if (
        direction === 'left' &&
        actionIndex === 0 &&
        card.hasAttribute('tabindex')
    ) {
        applyFocus(card);
        return true;
    }
    return false;
}

/**
 * UP/DOWN walks EPG rows semantically rather than geometrically; LEFT/RIGHT
 * walks a row's own action buttons. See `focusFromEpgBoundary` for why UP at
 * the first row returns to the video instead of being consumed like DOWN at
 * the last one.
 */
export function moveWithinEpgRow(
    origin: HTMLElement,
    direction: TvDirection,
    applyFocus: ApplyFocus
): boolean {
    const row = origin.closest<HTMLElement>(EPG_ROW_SELECTOR);
    if (!row) {
        return false;
    }

    if (direction === 'up' || direction === 'down') {
        const epg = row.closest<HTMLElement>(EPG_LIST_SELECTOR);
        const rows = epgRows(epg ?? document);
        const rowIndex = rows.indexOf(row);
        const target = rows[rowIndex + (direction === 'up' ? -1 : 1)];

        // EPG traversal is semantic, not geometric. At either boundary the
        // key remains consumed so Android/WebView cannot escape to the
        // vertical tray when there is no preceding/following programme.
        if (target) {
            applyFocus(target);
            return true;
        }

        // UP with no earlier programme returns to the video instead of being
        // swallowed — the panel sits directly above the guide. DOWN has no
        // symmetric target: nothing below the guide belongs to this screen,
        // so it stays consumed rather than escaping the panel.
        if (direction === 'up') {
            const player = focusFromEpgBoundary();
            if (player) {
                applyFocus(player);
            }
        }
        return true;
    }

    const actions = Array.from(
        row.querySelectorAll<HTMLElement>(EPG_ROW_ACTION_SELECTOR)
    );
    const actionIndex = actions.indexOf(origin);
    if (origin === row && direction === 'right' && actions[0]) {
        applyFocus(actions[0]);
        return true;
    }
    if (actionIndex < 0) {
        return false;
    }
    if (direction === 'right' && actionIndex < actions.length - 1) {
        applyFocus(actions[actionIndex + 1]);
        return true;
    }
    if (direction === 'left' && actionIndex > 0) {
        applyFocus(actions[actionIndex - 1]);
        return true;
    }
    if (direction === 'left' && actionIndex === 0) {
        applyFocus(row);
        return true;
    }
    return false;
}
