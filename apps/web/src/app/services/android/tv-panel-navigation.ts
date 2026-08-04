import { ZoneMemory } from './focus-zones';
import {
    collapseContext,
    expandContext,
    getLastContextFocus,
} from './panel-region';
import { collectCandidates } from './spatial-candidates';
import type { TvDirection } from './spatial-geometry';
import {
    moveWithinActionCard as moveWithinActionCardImpl,
    moveWithinEpgRow as moveWithinEpgRowImpl,
} from './tv-panel-directional-moves';
import {
    currentFocusedElement,
    resolveTrayCategoryTarget,
} from './tv-live-category-resume';
import {
    findFirstContentTarget,
    focusPlaybackAfterChannelCollapse,
} from './tv-playback-focus';

type ApplyFocus = (element: HTMLElement) => void;

const EPG_ROW_SELECTOR = 'app-epg-list-view-row';
const EPG_LIST_SELECTOR = 'app-epg-list-view';
// 2 retries (100ms) comfortably covers the ~60ms measured on the reference
// box between the live route's content mounting and `ngOnInit` actually
// running `forgetIfOtherPlaylist` — see the settling comment below.
const MIN_LIVE_SETTLE_ATTEMPTS = 2;

/**
 * Local panel gestures and the explicit OK/BACK hierarchy. Keeping this out of
 * the spatial engine makes it clear which transitions are semantic actions
 * rather than geometric neighbours.
 */
export class TvPanelNavigation {
    private lastChannelFocus: HTMLElement | null = null;
    private lastFocusOwner: 'channels' | 'epg' | null = null;
    private lastEpgFocus: HTMLElement | null = null;
    private lastEpgKey: string | null = null;
    private lastEpgIndex = 0;

    constructor(
        private readonly applyFocus: ApplyFocus,
        private readonly memory: ZoneMemory
    ) {}

    rememberChannel(channel: HTMLElement): void {
        this.lastChannelFocus = channel;
        this.lastFocusOwner = 'channels';
    }

    /** Track the semantic panel and stable programme represented by focus. */
    noteFocus(element: HTMLElement): void {
        const epgRow = element.closest<HTMLElement>(EPG_ROW_SELECTOR);
        if (epgRow) {
            const rows = this.epgRows();
            this.lastFocusOwner = 'epg';
            this.lastEpgFocus = epgRow;
            this.lastEpgKey = epgRow.dataset['tvEpgKey'] ?? null;
            this.lastEpgIndex = Math.max(0, rows.indexOf(epgRow));
            return;
        }

        const channel = element.closest<HTMLElement>('.channel-list-item');
        if (channel) {
            this.rememberChannel(channel);
            return;
        }

        // Moving explicitly into the tray, categories, header, or another
        // page ends recovery ownership for a virtual live-TV list.
        this.lastFocusOwner = null;
    }

    /** Recover the panel that owned focus before its DOM row was recycled. */
    recoverLastPanelFocus(): boolean {
        if (this.lastFocusOwner === 'epg') {
            return this.recoverEpgFocus();
        }
        if (this.lastFocusOwner === 'channels') {
            return this.recoverChannelFocus();
        }
        return false;
    }

    /**
     * Recover a channel-list focus lost when CDK virtual scrolling recycles
     * the focused row. This is intentionally available only after Channels
     * has owned focus at least once; a cold app start must still begin in the
     * active vertical-tray route.
     */
    recoverChannelFocus(attempt = 0): boolean {
        const sidebar = this.channelSidebar();
        if (
            !this.lastChannelFocus ||
            !sidebar ||
            sidebar.classList.contains('sidebar-collapsed')
        ) {
            return false;
        }

        const remembered =
            this.lastChannelFocus.isConnected &&
            sidebar.contains(this.lastChannelFocus)
                ? this.lastChannelFocus
                : null;
        // Confirming a category swaps the whole list: the remembered row belongs
        // to the previous category and no row is active yet, so without the
        // first-row fallback recovery consumes the key and leaves the remote
        // with no owner at all.
        const target =
            sidebar.querySelector<HTMLElement>('.channel-list-item.active') ??
            remembered ??
            sidebar.querySelector<HTMLElement>('.channel-list-item');
        if (target) {
            this.rememberChannel(target);
            this.applyFocus(target);
            return true;
        }

        // A virtual viewport can briefly have no active row while Angular
        // swaps its rendered range. Consume the key and retry instead of
        // letting the generic no-focus fallback jump to the tray.
        if (attempt < 20) {
            window.setTimeout(() => this.recoverChannelFocus(attempt + 1), 50);
        }
        return true;
    }

    /** Restore an EPG row after a programme refresh replaces its DOM node. */
    recoverEpgFocus(attempt = 0): boolean {
        const epg = document.querySelector<HTMLElement>(EPG_LIST_SELECTOR);
        if (!epg) {
            this.lastFocusOwner = null;
            return false;
        }

        const rows = this.epgRows(epg);
        const sameProgramme = this.lastEpgKey
            ? rows.find(
                  (row) => row.dataset['tvEpgKey'] === this.lastEpgKey
              )
            : null;
        const active = rows.find(
            (row) =>
                row.classList.contains('sel') ||
                row.classList.contains('playing')
        );
        const nearest = rows[Math.min(this.lastEpgIndex, rows.length - 1)];
        const remembered =
            this.lastEpgFocus?.isConnected && epg.contains(this.lastEpgFocus)
                ? this.lastEpgFocus
                : null;
        const target = sameProgramme ?? active ?? nearest ?? remembered;
        if (target) {
            this.applyFocus(target);
            return true;
        }

        // During a date/channel refresh the list can briefly be empty. Keep
        // ownership in the EPG and retry rather than invoking startup focus.
        if (attempt < 20) {
            window.setTimeout(() => this.recoverEpgFocus(attempt + 1), 50);
        } else {
            this.lastFocusOwner = null;
        }
        return true;
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
        focusPlaybackAfterChannelCollapse(sidebar, this.applyFocus);
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
        const currentChannel =
            sidebar.querySelector<HTMLElement>('.channel-list-item.active') ??
            remembered;
        if (remembered && currentChannel) {
            this.applyFocus(remembered);
            this.playCurrentChannelIfNeeded(currentChannel);
        }
        return true;
    }

    moveWithinActionCard(origin: HTMLElement, direction: TvDirection): boolean {
        return moveWithinActionCardImpl(origin, direction, this.applyFocus);
    }

    moveWithinEpgRow(origin: HTMLElement, direction: TvDirection): boolean {
        return moveWithinEpgRowImpl(origin, direction, this.applyFocus);
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

    /**
     * Bootstrap remote focus from the vertical tray, whose active route is the
     * semantic root of the Android TV hierarchy. Falling back to the globally
     * top-left candidate selected the playlist switcher in the workspace
     * header and immediately trapped the remote inside that focus scope.
     */
    focusInitialTarget(): boolean {
        return this.focusTray() || this.focusFirstCandidate();
    }

    /**
     * OK on a tray navigation opens the selected workspace panel. Horizontal
     * geometry is intentionally not allowed to cross the tray boundary, so
     * the route action must explicitly land on the first Live/VOD/Series
     * category when that panel is present — or, for Live TV with a channel
     * already playing, resume its category directly. See
     * `resolveTrayCategoryTarget` for why.
     *
     * Root cause, traced on the reference box: the URL updates essentially
     * synchronously with the click, so it cannot tell a stale category panel
     * apart from a ready one — the category panel is a persistent
     * workspace-shell fixture, not destroyed between routes, and right after
     * the click it still shows the *previous* section's own real, clickable
     * first category. `[data-tv-resume-category-id]` is written by the Live
     * TV route itself and genuinely takes a render pass longer to mount, so
     * `resolveTrayCategoryTarget` seeing it absent on the very first check
     * does not mean there is nothing to resume — only that the answer is not
     * in yet. `isLiveTypeTarget`, read from the clicked link's own href
     * before anything renders, is what tells those two apart: only a
     * Live/ITV/Radio destination is worth waiting on.
     *
     * Confirming a resume category also needs one round of stability, not
     * just presence: requiring the same category id to resolve on two
     * consecutive checks, 50ms apart, before acting is cheap insurance
     * against acting on a render that is itself still one tick ahead of the
     * store settling.
     */
    focusFirstContextAfterTraySelection(
        trayLink: HTMLElement | null = null,
        attempt = 0,
        stableResumeId: string | null = null
    ): boolean {
        const isLiveTypeTarget =
            trayLink instanceof HTMLAnchorElement &&
            /\/(live|itv|radio)$/.test(trayLink.pathname);
        const target = resolveTrayCategoryTarget({
            awaitResume: isLiveTypeTarget && attempt < 20,
        });

        // The live route's own content mounting is not proof its data is
        // ready: on the reference box, `.content-container` (RESUME_HOST in
        // the resolver) appeared in the DOM up to ~60ms before `ngOnInit` ran
        // `forgetIfOtherPlaylist` and the resume-marker binding it feeds
        // caught up — the exact "genuinely nothing to resume" signal below,
        // observed while it was still simply not there yet. Requiring one
        // retry before ever trusting that reading is what turns a
        // hard-to-reproduce race into "always waits the extra beat".
        const settledEnoughForFirst = !isLiveTypeTarget || attempt >= MIN_LIVE_SETTLE_ATTEMPTS;

        if (
            target.kind === 'pending' ||
            target.kind === 'none' ||
            (target.kind === 'first' && !settledEnoughForFirst)
        ) {
            if (attempt < 20) {
                window.setTimeout(
                    () =>
                        this.focusFirstContextAfterTraySelection(
                            trayLink,
                            attempt + 1
                        ),
                    50
                );
            }
            return false;
        }

        if (target.kind === 'resume') {
            const resumeId = target.category.dataset['categoryId'] ?? null;
            if (resumeId !== stableResumeId && attempt < 20) {
                window.setTimeout(
                    () =>
                        this.focusFirstContextAfterTraySelection(
                            trayLink,
                            attempt + 1,
                            resumeId
                        ),
                    50
                );
                return false;
            }

            this.applyFocus(target.category);
            target.category.click();
            // Marking the panel inert forcibly blurs the category button it
            // still contains — the browser moves focus to <body> the instant
            // an ancestor goes inert, before this line even returns. Reading
            // that as "nothing focused" (currentFocusedElement, not raw
            // activeElement) is what lets the retry below actually wait for
            // the channel list instead of bailing out on a false "focus moved
            // away" reading.
            collapseContext();
            this.focusFirstContentAfterCategorySelection(
                target.category,
                currentFocusedElement
            );
            return true;
        }

        expandContext();
        this.applyFocus(target.category);
        return true;
    }

    focusFirstContentAfterCategorySelection(
        category: HTMLElement,
        currentElement: () => HTMLElement | null,
        attempt = 0
    ): void {
        const current = currentElement();
        if (current !== category && current !== null) {
            return;
        }

        const target = findFirstContentTarget();
        if (target) {
            const channel = target.closest<HTMLElement>('.channel-list-item');
            if (channel) {
                this.rememberChannel(channel);
                this.playCurrentChannelIfNeeded(channel);
            }
            this.applyFocus(target);
            return;
        }
        if (attempt < 20) {
            window.setTimeout(
                () =>
                    this.focusFirstContentAfterCategorySelection(
                        category,
                        currentElement,
                        attempt + 1
                    ),
                50
            );
            return;
        }

        // An empty category has no content target to own the remote. Restore
        // the confirmed category instead of leaving BODY focused and letting
        // the next key bootstrap from the tray.
        if (category.isConnected) {
            expandContext();
            this.applyFocus(category);
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

        const active = tray.querySelector<HTMLElement>(
            'a[aria-current="page"], .nav-item.is-active, .nav-item.active'
        );
        if (active) {
            this.applyFocus(active);
            return true;
        }
        const remembered = this.memory.recall(tray);
        if (remembered) {
            this.applyFocus(remembered);
            return true;
        }
        const candidate =
            tray.querySelector<HTMLElement>('.portal-rail-link') ??
            collectCandidates(tray)[0]?.target;
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

    private epgRows(root: ParentNode = document): HTMLElement[] {
        return Array.from(root.querySelectorAll<HTMLElement>(EPG_ROW_SELECTOR));
    }

    /**
     * Opening Live TV should have a picture immediately. A native double-click
     * event reaches the existing `playbackRequested` binding and forces start
     * even when the desktop "open on double click" preference is enabled; it
     * is only sent when no player surface is already active, so BACK/reopen
     * never restarts the channel that is already playing.
     */
    private playCurrentChannelIfNeeded(channel: HTMLElement): void {
        if (
            document.querySelector(
                'app-web-player-view video, app-web-player-view app-android-native-player'
            )
        ) {
            return;
        }

        channel.dispatchEvent(
            new MouseEvent('dblclick', { bubbles: true, detail: 2 })
        );
    }
}
