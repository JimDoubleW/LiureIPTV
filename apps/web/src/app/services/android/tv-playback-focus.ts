import { collectCandidates } from './spatial-candidates';

const EPG_ROW_SELECTOR = 'app-epg-list-view-row';
const EPG_LIST_SELECTOR = 'app-epg-list-view';
const PLAYER_BUTTON_SELECTOR =
    'app-player-controls button:not([disabled])';
const FULLSCREEN_TOGGLE_SELECTOR =
    'app-player-controls button[data-tv-fullscreen-toggle]:not([disabled])';
const CONTENT_TARGET_SELECTORS = [
    '.channel-list-item.active',
    '.channel-list-item',
    '[data-tv-content-card]',
    '[data-tv-action-card]',
    '.content-card',
    EPG_ROW_SELECTOR,
    PLAYER_BUTTON_SELECTOR,
] as const;

type ApplyFocus = (element: HTMLElement) => void;

export function findContentActivationOrigin(
    element: HTMLElement,
    insidePlayer: boolean
): HTMLElement | null {
    if (!element.closest('main') || insidePlayer) return null;

    return element.closest(
        '[data-tv-content-card], [data-tv-action-card],' +
            ' .details__similar-card, .details__cast-chip--clickable,' +
            ' .shell__hero, .episode-card, .episode-list-item'
    )
        ? element
        : null;
}

export function isAvailableTvFocusTarget(
    element: HTMLElement,
    requireLayout = false,
    // The transport bar is opacity:0 by design until something inside it is
    // focused or hovered — that fade is exactly how a control most callers
    // must reject (a card mid-transition, a menu item that lost its slot) is
    // told apart from one that is simply not being looked at right now.
    // `focusFromEpgBoundary` is the one caller that wants to focus INTO that
    // fade to reveal it, so it opts out explicitly rather than the check
    // silently starting to accept every faded element.
    allowFaded = false
): boolean {
    if (
        element.matches(':disabled, [aria-disabled="true"]') ||
        element.closest('[inert], [aria-hidden="true"]')
    ) {
        return false;
    }

    const style = getComputedStyle(element);
    if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        (!allowFaded && style.opacity === '0')
    ) {
        return false;
    }

    if (!requireLayout) return true;
    const rect = element.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
    );
}

function findPlaybackTarget(origin: HTMLElement): HTMLElement | null {
    if (
        !origin.closest(
            '.shell__hero, .episode-card, .episode-list-item,' +
                ' [data-tv-playback-origin]'
        )
    ) {
        return null;
    }

    return preferredPlayerFocusTarget();
}

/**
 * Where focus lands the moment playback starts, before the viewer has pressed
 * anything.
 *
 * The fullscreen toggle wins over "the first enabled button" because it is the
 * one control guaranteed usable the instant the player mounts —
 * `canFullscreen()` only checks that the target element exists, unlike
 * play/pause (`canTogglePlay()`), which stays disabled while the stream is
 * still loading. Landing on play/pause was never reliable; landing on
 * whichever button happened to be next in DOM order once play/pause was
 * skipped was worse; it was volume on the reference box, so the visible focus
 * ring sat on mute rather than on "make this bigger" — the actual gesture
 * `activate()` performs for OK anywhere inside the player before fullscreen.
 */
function preferredPlayerFocusTarget(allowFaded = false): HTMLElement | null {
    const fullscreenToggle = document.querySelector<HTMLElement>(
        FULLSCREEN_TOGGLE_SELECTOR
    );
    if (
        fullscreenToggle &&
        isAvailableTvFocusTarget(fullscreenToggle, true, allowFaded)
    ) {
        return fullscreenToggle;
    }

    return (
        Array.from(
            document.querySelectorAll<HTMLElement>(PLAYER_BUTTON_SELECTOR)
        ).find((candidate) =>
            isAvailableTvFocusTarget(candidate, true, allowFaded)
        ) ?? null
    );
}

/**
 * UP at the first programme in the EPG leaves the guide and returns to the
 * video: the transport bar sits directly above it, so this is the natural
 * continuation once there is no earlier programme to select.
 *
 * The bar is faded (`opacity: 0`) the moment focus has been away from it for a
 * few seconds — the common case by the time a viewer has scrolled to the top
 * of the guide — so this looks past that fade rather than treating it as
 * "nothing to focus". Focusing a `<button>` works regardless of its opacity;
 * the bar's own `focusin` handler is what reveals it once focus lands.
 */
export function focusFromEpgBoundary(): HTMLElement | null {
    return preferredPlayerFocusTarget(true);
}

function contentRoot(): ParentNode {
    return document.querySelector('main') ?? document;
}

/** Find the first real item in the workspace, never a tray or header item. */
export function findFirstContentTarget(
    excluded?: HTMLElement | null
): HTMLElement | null {
    const root = contentRoot();
    for (const selector of CONTENT_TARGET_SELECTORS) {
        const target = Array.from(
            root.querySelectorAll<HTMLElement>(selector)
        ).find(
            (candidate) =>
                candidate !== excluded &&
                !excluded?.contains(candidate) &&
                isAvailableTvFocusTarget(candidate)
        );
        if (target) return target;
    }

    const spatialTarget = collectCandidates(root).find(
        (candidate) =>
            candidate.target !== excluded &&
            !excluded?.contains(candidate.target)
    )?.target;
    if (spatialTarget) return spatialTarget;

    return Array.from(
        root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([type="hidden"]),' +
                ' select:not([disabled]), textarea:not([disabled]),' +
                ' [tabindex]:not([tabindex="-1"])'
        )
    ).find(
        (candidate) =>
            candidate !== excluded &&
            !excluded?.contains(candidate) &&
            isAvailableTvFocusTarget(candidate)
    ) ?? null;
}

/**
 * A content card can disappear while its route/detail view is rendered. Keep
 * focus in the workspace instead of letting the next D-pad press bootstrap
 * from the vertical tray.
 */
export function focusAfterContentActivation(
    origin: HTMLElement,
    applyFocus: ApplyFocus,
    recoverWorkspace?: () => boolean,
    attempt = 0
): void {
    // Claims this transition against `guardFocusSurvival`, which would
    // otherwise treat the activated card's removal as a lost remote. Ownership
    // passes to the next attempt on every retry, so the claim is released
    // exactly once, wherever this chain ends.
    if (attempt === 0) {
        contentActivations += 1;
    }
    let settled = false;
    const settle = () => {
        if (settled) return;
        settled = true;
        contentActivations = Math.max(0, contentActivations - 1);
    };
    const retry = () => {
        settled = true;
        focusAfterContentActivation(
            origin,
            applyFocus,
            recoverWorkspace,
            attempt + 1
        );
    };

    window.setTimeout(() => {
        const active = document.activeElement;
        const activeOverlay = active instanceof HTMLElement
            ? active.closest('.cdk-overlay-pane, [role="dialog"]')
            : null;
        if (
            active instanceof HTMLElement &&
            active !== document.body &&
            (!origin.isConnected || !origin.contains(active)) &&
            !activeOverlay
        ) {
            settle();
            return;
        }

        if (activeOverlay) {
            if (attempt < 20) {
                retry();
            }
            settle();
            return;
        }

        // A route transition can leave the clicked card mounted for a few
        // frames. Wait for that card to be replaced rather than moving focus
        // to a sibling from the old view.
        if (
            origin.isConnected &&
            isAvailableTvFocusTarget(origin, true) &&
            active instanceof HTMLElement
        ) {
            if (attempt < 20) {
                retry();
            }
            settle();
            return;
        }

        const playbackTarget = findPlaybackTarget(origin);
        if (playbackTarget) {
            settle();
            applyFocus(playbackTarget);
            return;
        }
        if (recoverWorkspace?.()) {
            settle();
            return;
        }
        const target = findFirstContentTarget(origin);
        if (target) {
            settle();
            applyFocus(target);
            return;
        }
        if (attempt < 20) {
            retry();
        }
        settle();
    }, attempt === 0 ? 0 : 50);
}

const FOCUS_SURVIVAL_INTERVAL_MS = 60;
const FOCUS_SURVIVAL_CHECKS = 30;
let focusSurvivalTimer: number | null = null;
let contentActivations = 0;

/**
 * Re-own the remote when the element just focused is destroyed before the
 * viewer presses anything.
 *
 * Handing focus to a list that is about to be replaced is normal here: the only
 * rows on screen when a category is confirmed still belong to the previous
 * category. Measured on the reference box, the confirmed category's own
 * channels arrived 93 ms later and destroyed the focused row. DOM focus then
 * falls to the body, and because every recovery path in this engine is driven
 * by a key press, the remote stays dead until the viewer presses something —
 * and that press then bootstraps from wherever recovery happens to land rather
 * than from the list they just opened.
 *
 * One timer for the whole engine: only the most recently focused element can
 * still be the one holding the remote.
 */
export function guardFocusSurvival(
    element: HTMLElement,
    currentElement: () => HTMLElement | null,
    recover: () => void,
    attempt = 0
): void {
    if (focusSurvivalTimer !== null) {
        window.clearTimeout(focusSurvivalTimer);
    }

    focusSurvivalTimer = window.setTimeout(() => {
        focusSurvivalTimer = null;

        const current = currentElement();
        if (current !== null && current !== element) {
            return;
        }

        const again = () => {
            if (attempt + 1 < FOCUS_SURVIVAL_CHECKS) {
                guardFocusSurvival(
                    element,
                    currentElement,
                    recover,
                    attempt + 1
                );
            }
        };

        if (element.isConnected) {
            again();
            return;
        }

        // An activation handoff already owns this transition and deliberately
        // waits for the outgoing view; recovering here would race it and focus
        // the page the viewer is leaving.
        if (contentActivations > 0) {
            again();
            return;
        }

        recover();
    }, FOCUS_SURVIVAL_INTERVAL_MS);
}

/**
 * Making Channels inert clears DOM focus on Android. Transfer ownership after
 * Angular has rendered the tuned channel; otherwise the next D-pad press sees
 * no origin and bootstraps from the active tray item.
 */
export function focusPlaybackAfterChannelCollapse(
    sidebar: HTMLElement,
    applyFocus: ApplyFocus
): void {
    window.setTimeout(() => {
        if (!sidebar.classList.contains('sidebar-collapsed')) return;

        const active = document.activeElement;
        if (
            active instanceof HTMLElement &&
            active !== document.body &&
            !sidebar.contains(active)
        ) {
            return;
        }

        const epg = document.querySelector<HTMLElement>(EPG_LIST_SELECTOR);
        const target =
            epg?.querySelector<HTMLElement>(`${EPG_ROW_SELECTOR}.sel`) ??
            epg?.querySelector<HTMLElement>(`${EPG_ROW_SELECTOR}.playing`) ??
            epg?.querySelector<HTMLElement>(
                `${EPG_ROW_SELECTOR}[data-when="now"]`
            ) ??
            epg?.querySelector<HTMLElement>(EPG_ROW_SELECTOR) ??
            preferredPlayerFocusTarget();
        if (target) applyFocus(target);
    });
}
