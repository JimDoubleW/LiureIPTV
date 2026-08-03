import { ZoneMemory } from './focus-zones';
import { expandContext, getLastContextFocus } from './panel-region';
import { collectCandidates } from './spatial-candidates';
import type { TvDirection } from './spatial-geometry';

type ApplyFocus = (element: HTMLElement) => void;

const EPG_ROW_SELECTOR = 'app-epg-list-view-row';
const EPG_ROW_ACTION_SELECTOR = '[data-tv-row-action]';

/**
 * Local panel gestures and the explicit OK/BACK hierarchy. Keeping this out of
 * the spatial engine makes it clear which transitions are semantic actions
 * rather than geometric neighbours.
 */
export class TvPanelNavigation {
    private lastChannelFocus: HTMLElement | null = null;

    constructor(
        private readonly applyFocus: ApplyFocus,
        private readonly memory: ZoneMemory
    ) {}

    rememberChannel(channel: HTMLElement): void {
        this.lastChannelFocus = channel;
    }

    collapseChannelList(): boolean {
        const sidebar = this.channelSidebar();
        if (!sidebar || sidebar.classList.contains('sidebar-collapsed')) {
            return false;
        }

        const toggle = sidebar.querySelector<HTMLButtonElement>(
            'button[aria-pressed="false"]'
        );
        if (!toggle) {
            return false;
        }

        toggle.click();
        sidebar.setAttribute('inert', '');
        return true;
    }

    isChannelListCollapsed(): boolean {
        return (
            this.channelSidebar()?.classList.contains('sidebar-collapsed') ??
            false
        );
    }

    reopenChannelList(): boolean {
        const sidebar = this.channelSidebar();
        if (!sidebar?.classList.contains('sidebar-collapsed')) {
            return false;
        }

        const restore = document.querySelector<HTMLButtonElement>(
            '.content-container > button.sidebar-restore[aria-pressed="true"]'
        );
        if (!restore) {
            return false;
        }

        restore.click();
        sidebar.removeAttribute('inert');
        const remembered =
            this.lastChannelFocus?.isConnected === true
                ? this.lastChannelFocus
                : sidebar.querySelector<HTMLElement>('.channel-list-item');
        if (remembered) {
            this.applyFocus(remembered);
        }
        return true;
    }

    moveWithinActionCard(origin: HTMLElement, direction: TvDirection): boolean {
        const card = origin.closest<HTMLElement>('[data-tv-action-card]');
        const actionRow = card?.querySelector<HTMLElement>(
            '[data-tv-action-row]'
        );
        if (!card || !actionRow) {
            return false;
        }

        const actions = Array.from(
            actionRow.querySelectorAll<HTMLButtonElement>(
                'button:not([disabled])'
            )
        );
        if (actions.length === 0) {
            return false;
        }

        if (origin === card && direction === 'right') {
            this.applyFocus(actions[0]);
            return true;
        }

        const actionIndex = actions.indexOf(origin as HTMLButtonElement);
        if (actionIndex < 0) {
            return false;
        }
        if (direction === 'right' && actionIndex < actions.length - 1) {
            this.applyFocus(actions[actionIndex + 1]);
            return true;
        }
        if (direction === 'right' && actionIndex === actions.length - 1) {
            return true;
        }
        if (direction === 'left' && actionIndex > 0) {
            this.applyFocus(actions[actionIndex - 1]);
            return true;
        }
        if (
            direction === 'left' &&
            actionIndex === 0 &&
            card.hasAttribute('tabindex')
        ) {
            this.applyFocus(card);
            return true;
        }
        return false;
    }

    moveWithinEpgRow(origin: HTMLElement, direction: TvDirection): boolean {
        const row = origin.closest<HTMLElement>(EPG_ROW_SELECTOR);
        if (!row) {
            return false;
        }

        const actions = Array.from(
            row.querySelectorAll<HTMLElement>(EPG_ROW_ACTION_SELECTOR)
        );
        const actionIndex = actions.indexOf(origin);
        if (origin === row && direction === 'right' && actions[0]) {
            this.applyFocus(actions[0]);
            return true;
        }
        if (actionIndex < 0) {
            return false;
        }
        if (direction === 'right' && actionIndex < actions.length - 1) {
            this.applyFocus(actions[actionIndex + 1]);
            return true;
        }
        if (direction === 'left' && actionIndex > 0) {
            this.applyFocus(actions[actionIndex - 1]);
            return true;
        }
        if (direction === 'left' && actionIndex === 0) {
            this.applyFocus(row);
            return true;
        }
        return false;
    }

    focusFirstCandidate(): boolean {
        const candidates = collectCandidates();
        if (candidates.length === 0) {
            return false;
        }
        const first = candidates.reduce((best, candidate) =>
            candidate.rect.top < best.rect.top ||
            (candidate.rect.top === best.rect.top &&
                candidate.rect.left < best.rect.left)
                ? candidate
                : best
        );
        this.applyFocus(first.target);
        return true;
    }

    focusFirstChannelAfterCategorySelection(
        category: HTMLElement,
        currentElement: () => HTMLElement | null,
        attempt = 0
    ): void {
        const current = currentElement();
        if (current !== category && current !== null) {
            return;
        }

        const channel =
            document.querySelector<HTMLElement>('.channel-list-item');
        if (channel) {
            this.applyFocus(channel);
            return;
        }
        if (attempt < 20) {
            window.setTimeout(
                () =>
                    this.focusFirstChannelAfterCategorySelection(
                        category,
                        currentElement,
                        attempt + 1
                    ),
                50
            );
        }
    }

    reopenContextPanel(): boolean {
        const panel = expandContext();
        if (!panel) {
            return false;
        }

        const remembered = getLastContextFocus();
        if (remembered) {
            this.applyFocus(remembered);
            return true;
        }
        const candidates = collectCandidates(panel);
        if (candidates.length === 0) {
            return false;
        }
        this.applyFocus(candidates[0].target);
        return true;
    }

    focusTray(): boolean {
        const tray = document.querySelector<HTMLElement>('aside.app-rail');
        if (!tray) {
            return false;
        }

        const remembered = this.memory.recall(tray);
        if (remembered) {
            this.applyFocus(remembered);
            return true;
        }
        const candidate = collectCandidates(tray)[0]?.target;
        const fallback = tray.querySelector<HTMLElement>(
            'a, button, [tabindex]:not([tabindex="-1"])'
        );
        const target = candidate ?? fallback;
        if (!target) {
            return false;
        }
        this.applyFocus(target);
        return true;
    }

    private channelSidebar(): HTMLElement | null {
        return document.querySelector<HTMLElement>('.sidebar');
    }
}
