import { isAndroidRuntime } from './android-runtime';
import {
    collectCandidates,
    ensureFocusable,
    isTextEntry,
} from './spatial-candidates';
import { resolveZone, ZoneMemory } from './focus-zones';
import {
    applyRegion,
    collapseContext,
    isContextCollapsed,
    isContextCategoryItem,
    isPanelTransitionAllowed,
    noteContextFocus,
    recallPanelSelection,
    resolveRegion,
} from './panel-region';
import {
    clearVirtualFocus,
    getVirtualFocus,
    promoteVirtualFocus,
    setVirtualFocus,
} from './virtual-focus';
import {
    enterFullscreen,
    exitFullscreen,
    handleFullscreenDirection,
    handleChannelListDirection,
    handleCatchupProgrammeOk,
    isInsidePlayer,
    focusPlayerControls,
    isTvFullscreen,
    isInsidePlayerControls,
    armPlayerControlsIdleHide,
} from './player-keys';
import { scrollToReveal } from './scroll-reach';
import { findBestCandidate, type TvDirection } from './spatial-geometry';
import { installTvFocusStyles } from './tv-focus.styles';
import * as tvRange from './tv-range-control';
import { handleTrayBack, resetTrayBackSequence } from './tv-app-exit';
import {
    dispatchRealKey,
    findActionableOverlay,
    findUnmanagedOverlay,
    focusFirstActionableOverlay,
    isNativeControlOpen,
} from './tv-native-control-keys';
import { TvPanelNavigation } from './tv-panel-navigation';
import {
    findContentActivationOrigin,
    focusAfterContentActivation,
    guardFocusSurvival,
} from './tv-playback-focus';
import { TvWorkspaceFocus } from './tv-workspace-focus';

/**
 * D-pad navigation for the Android TV port.
 *
 * Entry point for the whole feature: `armTvNavigation()` is called once from
 * `main.ts` and no-ops off Android, so nothing here affects the PWA or the
 * Electron build.
 *
 * See docs/android-port/tv-navigation-reference.md for the behaviour this
 * reproduces.
 */

const DIRECTION_BY_KEY: Readonly<Record<string, TvDirection>> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

const KEY_BY_DIRECTION: Readonly<Record<TvDirection, string>> = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
};

const memory = new ZoneMemory();

function currentElement(): HTMLElement | null {
    // A virtually focused text field is where the user believes focus is, even
    // though the browser has it on the body.
    const virtual = getVirtualFocus();
    if (virtual) {
        return virtual;
    }

    const active = document.activeElement;
    if (
        !active ||
        active === document.body ||
        !(active instanceof HTMLElement)
    ) {
        return null;
    }
    return active;
}

function applyFocus(element: HTMLElement): void {
    ensureFocusable(element);

    const origin = currentElement();
    const entersVirtualRange = tvRange.prepareVirtualFocus(element, origin);

    // Arriving on a text field must not raise the keyboard — only OK does.
    // Real focus would open the IME immediately, so the field is marked instead
    // and DOM focus stays on the body, which keeps the D-pad alive.
    if (entersVirtualRange || isTextEntry(element)) {
        setVirtualFocus(element);

        if (entersVirtualRange) {
            // Range inputs stay on virtual focus so Android does not open the
            // soft keyboard. Keep a real focus inside the player controls,
            // though, because their focusin state is what keeps the bar (and
            // therefore the slider) visible while the user scrubs.
            if (origin?.closest('app-player-controls')) {
                origin.focus({ preventScroll: true });
            } else {
                focusPlayerControls();
            }
        }
    } else {
        clearVirtualFocus();
        element.focus({ preventScroll: true });
    }

    // Panels scroll independently, so the newly focused row is often just
    // outside its own container even though the page did not move.
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    memory.remember(element);
    noteContextFocus(element);
    applyRegion(element);
    panels.noteFocus(element);
    workspaceFocus.note(element);
    // Live panels answer first because their virtual lists need semantic keys;
    // grids, detail pages and Settings fall to the generic workspace owner.
    guardFocusSurvival(element, currentElement, () => {
        if (panels.recoverLastPanelFocus()) return;
        workspaceFocus.recover();
    });
}

const panels = new TvPanelNavigation(applyFocus, memory);
const workspaceFocus = new TvWorkspaceFocus(applyFocus);

function move(direction: TvDirection): boolean {
    // Fullscreen video owns the D-pad outright: UP/DOWN zap, LEFT/RIGHT are
    // swallowed. BACK is the explicit gesture that reveals the list.
    if (handleFullscreenDirection(direction)) {
        return true;
    }

    const origin = currentElement();
    if (!origin) {
        if (focusFirstActionableOverlay(applyFocus)) return true;
        if (panels.recoverLastPanelFocus()) return true;
        return workspaceFocus.recover() || panels.focusInitialTarget();
    }

    if (
        !panels.isChannelListCollapsed() &&
        handleChannelListDirection(direction, origin, (target) => {
            panels.rememberChannel(target);
            applyFocus(target);
        })
    ) {
        return true;
    }

    if (panels.moveWithinActionCard(origin, direction)) {
        return true;
    }

    if (panels.moveWithinEpgRow(origin, direction)) {
        return true;
    }

    // An open overlay with no native keyboard handling of its own (see
    // findUnmanagedOverlay) has no other mechanism to move focus among its
    // content, so this engine's own search is confined to it — otherwise
    // background content, which the overlay's backdrop does not mark
    // `aria-hidden`, would still be a reachable candidate right behind it.
    const overlay = findUnmanagedOverlay();
    const searchRoot: ParentNode = overlay ?? document;

    const originRegion = resolveRegion(origin);
    const reachable = (candidate: HTMLElement): boolean =>
        candidate !== origin &&
        isPanelTransitionAllowed(origin, candidate, direction) &&
        (direction === 'up' ||
            direction === 'down' ||
            resolveRegion(candidate) === originRegion);
    const candidates = collectCandidates(searchRoot).filter((candidate) =>
        reachable(candidate.target)
    );
    const target = findBestCandidate(
        origin.getBoundingClientRect(),
        candidates,
        direction
    );

    if (!target) {
        // Nothing in range does not mean nothing exists: candidate collection
        // is bounded to the viewport, so anything below the fold — the play
        // button on a movie detail, for one — is invisible to the search. Scroll
        // that way and look again, otherwise such content can never be focused
        // and therefore never scrolled to.
        if (scrollToReveal(origin, direction)) {
            const revealed = findBestCandidate(
                origin.getBoundingClientRect(),
                collectCandidates(searchRoot).filter((c) =>
                    reachable(c.target)
                ),
                direction
            );
            if (revealed) {
                applyFocus(revealed);
                return true;
            }
        }

        // Deliberately do not wrap around: on a TV the user cannot see where
        // focus went, and wrapping reads as focus vanishing.
        return false;
    }

    // Entering a different panel restores that panel's own selection rather
    // than landing wherever geometry pointed. This is what makes navigation
    // feel like it remembers you.
    const targetZone = resolveZone(target);
    const destination =
        targetZone === resolveZone(origin)
            ? target
            : (recallPanelSelection(memory, origin, targetZone, direction) ??
              target);

    applyFocus(destination);
    return true;
}

/**
 * The remote's OK button.
 *
 * Clicks everything itself, native controls included. The native key layer
 * consumes DPAD_CENTER/ENTER before the WebView sees them, so the browser's
 * own Enter-activates-buttons behaviour never runs any more — if this only
 * clicked the non-native elements, every real <button> would go dead.
 */
function activate(): boolean {
    const active = currentElement();

    // OK over fullscreen video raises the transport controls — the reference
    // player's gesture, and the same one in live as on demand. Live used to
    // fall through to the branch below and hit `enterFullscreen()`, which
    // reports success for an already-fullscreen player and so swallowed the
    // press: pause was unreachable with the picture up. On demand there is
    // nothing focused at all, because entering the watch layout removes the
    // button that started playback.
    //
    // Once focus is on a control, OK belongs to that control and falls
    // through to the click below.
    if (isTvFullscreen() && !isInsidePlayerControls(active)) {
        return focusPlayerControls();
    }

    if (!active) {
        return false;
    }

    // Granting real focus is what raises the keyboard; no coaxing needed.
    if (isTextEntry(active)) {
        return promoteVirtualFocus();
    }

    if (isContextCategoryItem(active)) {
        // Category browsing is an explicit OK action on TV. Confirm it first,
        // then fold the category column and put focus on the first channel.
        noteContextFocus(active);
        active.click();
        collapseContext();
        panels.focusFirstContentAfterCategorySelection(active, currentElement);
        return true;
    }

    if (workspaceFocus.activateSettingsSection(active)) {
        return true;
    }

    if (handleCatchupProgrammeOk(active)) return true;

    const channelRow = active.closest<HTMLElement>('.channel-list-item');
    const selectingChannel = channelRow !== null;

    // OK on the player itself commits to fullscreen. A channel row — including
    // the already-active row — falls through to its click handler below so a
    // single OK starts inline playback and folds the Channels panel.
    //
    // Only before fullscreen. `enterFullscreen()` reports success for an
    // already-fullscreen player, so leaving this reachable swallowed every OK
    // aimed at a transport control — they all sit inside the player view.
    if (
        !isTvFullscreen() &&
        isInsidePlayer(active)
    ) {
        if (enterFullscreen()) {
            return true;
        }
    }

    if (selectingChannel) {
        panels.rememberChannel(channelRow);
    }
    const contentOrigin = findContentActivationOrigin(
        active,
        isInsidePlayer(active)
    );
    const selectedTrayItem = active.closest('aside.app-rail') !== null;
    // Read before the click, which is what starts the route transition.
    const trayLink = selectedTrayItem ? active : null;
    active.click();
    if (trayLink) {
        panels.focusFirstContextAfterTraySelection(trayLink);
    }
    if (selectingChannel) {
        panels.collapseChannelList();
        // Keep the first OK inline so the EPG remains visible. A later OK with
        // focus on the player is the explicit fullscreen gesture. The channel
        // row remains the remembered focus target for BACK reopening.
    }
    if (contentOrigin && !selectingChannel && !selectedTrayItem) {
        focusAfterContentActivation(
            contentOrigin,
            applyFocus,
            () => workspaceFocus.recover()
        );
    }
    return true;
}

function onKeyDown(event: KeyboardEvent): void {
    if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
    ) {
        return;
    }

    // Checked before branching on Enter vs. direction, and before anything
    // else: a select, a slider, an open menu, or an open mat-select's
    // activedescendant panel owns BOTH its arrows and its Enter, and a real
    // keydown reaching this listener already IS what such controls need, so
    // simply not touching it is enough here (unlike dispatchFromNative, which
    // has to synthesize one). Checking this only for the direction branch, as
    // an earlier version did, left Enter going through `activate()` first —
    // which calls `stopPropagation()` on success — so a synthetic Enter this
    // same module dispatches at a mat-select to hand it control would have
    // been swallowed by this very listener's capture-phase run before ever
    // reaching the trigger's own binding.
    const active = currentElement();
    const mapped = event.key === 'Enter' ? 'ok' : DIRECTION_BY_KEY[event.key];
    if (mapped && tvRange.handleTvRangeKey(active, mapped)) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    if (isNativeControlOpen(active)) {
        return;
    }

    if (event.key === 'Enter') {
        if (activate()) {
            event.preventDefault();
            event.stopPropagation();
        }
        return;
    }

    const direction = DIRECTION_BY_KEY[event.key];
    if (!direction) {
        return;
    }

    // A field holding *real* focus has the keyboard open over it. Left/right
    // belong to the caret, but up/down must still escape, or the field is a
    // trap once the user is done typing.
    if (
        active &&
        isTextEntry(active) &&
        !getVirtualFocus() &&
        (direction === 'left' || direction === 'right')
    ) {
        return;
    }

    if (move(direction)) {
        event.preventDefault();
        event.stopPropagation();
    }
}

const NATIVE_KEYS: Readonly<Record<string, TvDirection | 'ok' | 'back'>> = {
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    ok: 'ok',
    back: 'back',
};

/**
 * The remote's back button, forwarded by the native layer. Ordered from the
 * most local escape to the least:
 *
 * 1. An open overlay (dialog, menu) closes first — walking history underneath
 *    an open dialog would change the page behind it instead of dismissing it.
 *    CDK closes on Escape, so one synthetic Escape is the whole gesture.
 * 2. In-app history steps back. The Navigation API says whether there is
 *    anywhere to go; `history.length` cannot, since it never shrinks.
 * 3. At the real root, hand the task back to the launcher by minimizing.
 *    Finishing the activity — the old default — is why back used to quit the
 *    app from any list.
 */
function goBack(): void {
    // Slider adjustment consumes BACK before route history. Leaving fullscreen
    // and revealing the collapsed channel list are one gesture in the live TV
    // layout: the user pressed BACK specifically to get the list back.
    if (tvRange.releaseFocus(currentElement())) return;
    const leftFullscreen = exitFullscreen();
    if (
        leftFullscreen &&
        panels.isChannelListCollapsed() &&
        panels.reopenChannelList()
    ) {
        return;
    }
    if (leftFullscreen) return;

    // Same lesson as isNativeControlOpen: this app's overlays are not
    // appended under a global `.cdk-overlay-container`, so requiring that
    // ancestor silently never matched — BACK could not close a `mat-select`
    // or menu at all, falling straight through to the history/minimize
    // branches below instead.
    if (findActionableOverlay()) {
        dispatchRealKey('Escape', document.body);
        return;
    }

    // BACK from the player first restores the channel list. A further BACK
    // reopens the category column.
    const active = currentElement();
    // The header is not part of the OK/BACK live-panel hierarchy. If focus
    // reaches it through a restored browser state or an overlay closing, BACK
    // always recovers to the active item in the vertical tray.
    if (
        active?.closest('app-workspace-shell-header') &&
        panels.focusTray()
    ) {
        return;
    }
    if (workspaceFocus.reopenSettingsPanel(active)) {
        return;
    }
    // Once a channel has been tuned, BACK first restores only its channel
    // list. The category column remains a separate BACK step.
    if (panels.isChannelListCollapsed() && panels.reopenChannelList()) {
        return;
    }
    if (
        (active === null || resolveRegion(active) === 'content') &&
        isContextCollapsed() &&
        panels.reopenContextPanel()
    ) {
        return;
    }

    // BACK from the category panel returns to the tray. LEFT/RIGHT never
    // cross this boundary; the remote has an explicit parent action instead.
    if (active && resolveRegion(active) === 'context' && panels.focusTray()) {
        return;
    }

    // The tray is the app root on Android TV. A single BACK is deliberately
    // consumed as the first half of the close gesture; a second BACK within
    // the short window stops the native player and finishes the Activity.
    // This keeps an accidental press from quitting while still providing an
    // explicit way out once focus has returned to the tray.
    if (
        (active !== null && resolveRegion(active) === 'rail') ||
        (active === null &&
            document.documentElement.getAttribute('data-tv-region') === 'rail')
    ) {
        handleTrayBack();
        return;
    }

    const navigation = (
        globalThis.window as Window & {
            navigation?: { canGoBack?: boolean };
        }
    ).navigation;
    if (navigation?.canGoBack) {
        history.back();
        return;
    }

    const capacitor = (
        globalThis.window as Window & {
            Capacitor?: {
                Plugins?: { App?: { minimizeApp?: () => Promise<void> } };
            };
        }
    ).Capacitor;
    void capacitor?.Plugins?.App?.minimizeApp?.()?.catch(() => undefined);
}

/**
 * Entry point for the native key layer. MainActivity.dispatchKeyEvent consumes
 * the D-pad before the WebView can run its own focus search — the search that
 * raised the IME on traversal and teleported focus when a key was declined —
 * and forwards each press here. Once the native layer is in place, this is the
 * only way D-pad input reaches the app.
 */
function dispatchFromNative(key: string, repeatCount = 0): void {
    const mapped = NATIVE_KEYS[key];
    if (!mapped) return;

    if (mapped === 'back') {
        goBack();
        return;
    }

    // BACK must be a consecutive double press. Any other remote action starts
    // a fresh sequence instead of allowing a delayed second BACK to close the
    // app unexpectedly.
    resetTrayBackSequence();

    // Every press below can leave focus sitting on a transport control, which
    // pins the bar open. Re-arming here rather than at each call site means
    // the timer measures how long the remote has been quiet.
    try {
        handleNavigationKey(mapped, repeatCount);
    } finally {
        armPlayerControlsIdleHide();
    }
}

function handleNavigationKey(
    mapped: TvDirection | 'ok',
    repeatCount = 0
): void {
    const active = currentElement();
    if (tvRange.handleTvRangeKey(active, mapped, repeatCount)) return;
    // Ignore repeats outside an active range so a held D-pad cannot race UI.
    if (repeatCount > 0) return;

    // A native/Material control (an open mat-select, a slider, a plain
    // <select>) must keep driving its own arrow/Enter handling — see
    // isNativeControlOpen's doc comment for the mat-select case this was
    // written for. Handing it a real KeyboardEvent is what makes that
    // handling run at all, now that the native key layer means this
    // function is the only thing that ever sees these presses.
    if (isNativeControlOpen(active)) {
        const target = document.activeElement ?? document.body;
        dispatchRealKey(
            mapped === 'ok' ? 'Enter' : KEY_BY_DIRECTION[mapped],
            target
        );
        return;
    }

    if (mapped === 'ok') {
        activate();
        return;
    }

    move(mapped);
}

let armed = false;

/**
 * Installs D-pad navigation. Safe to call more than once, and a no-op outside
 * the Capacitor Android shell.
 */
export function armTvNavigation(): void {
    if (armed || !isAndroidRuntime()) {
        return;
    }
    armed = true;

    installTvFocusStyles();

    (
        window as Window & {
            __tvKeyDispatch?: (key: string, repeatCount?: number) => void;
        }
    ).__tvKeyDispatch = dispatchFromNative;

    // Kept as a fallback for an APK whose native layer predates the dispatch
    // hook. When the native layer is present these keys are consumed before
    // the WebView, so this listener simply never fires for them.
    document.addEventListener('keydown', onKeyDown, { capture: true });
}
