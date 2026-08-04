import { collectCandidates } from './spatial-candidates';
import { isAvailableTvFocusTarget } from './tv-playback-focus';

type ApplyFocus = (element: HTMLElement) => void;
type WorkspaceRootKind = 'main' | 'settings';

const SETTINGS_PANEL_SELECTOR =
    'aside.context-panel--settings, aside.context-panel:has(.settings-section-item)';
const SETTINGS_ITEM_SELECTOR = 'button.settings-section-item:not([disabled])';
const SETTINGS_TEST_ID_PREFIX = 'settings-section-';
const BASIC_FOCUSABLE_SELECTOR =
    'button:not([disabled]), a[href], input:not([type="hidden"]):not([disabled]),' +
    ' select:not([disabled]), textarea:not([disabled]),' +
    ' [tabindex]:not([tabindex="-1"])';

interface FocusPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * Remembers ownership of ordinary workspace pages. Live channel/EPG recovery
 * remains in TvPanelNavigation because those virtual lists need semantic keys;
 * this class handles cards, detail pages and Settings controls.
 */
export class TvWorkspaceFocus {
    private lastRootKind: WorkspaceRootKind | null = null;
    private lastTarget: HTMLElement | null = null;
    private lastPoint: FocusPoint | null = null;
    private lastFocusKey: string | null = null;
    private lastSettingsSection: HTMLElement | null = null;

    constructor(private readonly applyFocus: ApplyFocus) {}

    note(element: HTMLElement): void {
        if (
            element.closest(
                '.cdk-overlay-pane, mat-dialog-container, [role="dialog"]'
            )
        ) {
            return;
        }

        const settingsPanel = element.closest<HTMLElement>(
            SETTINGS_PANEL_SELECTOR
        );
        if (settingsPanel) {
            if (element.matches(SETTINGS_ITEM_SELECTOR)) {
                this.lastSettingsSection = element;
            }
            this.remember('settings', element);
            return;
        }

        if (element.closest('main')) {
            this.remember('main', element);
            return;
        }

        // An intentional move to the tray, header or browsing categories ends
        // generic workspace ownership. A cold start must still begin at the
        // active tray route.
        this.lastRootKind = null;
        this.lastTarget = null;
        this.lastPoint = null;
        this.lastFocusKey = null;
    }

    recover(attempt = 0): boolean {
        const root = this.resolveRoot();
        if (!root) return false;

        const keyedTarget = this.lastFocusKey
            ? Array.from(
                  root.querySelectorAll<HTMLElement>('[data-tv-focus-key]')
              ).find(
                  (candidate) =>
                      candidate.dataset['tvFocusKey'] === this.lastFocusKey &&
                      isAvailableTvFocusTarget(candidate, true)
              )
            : null;
        if (keyedTarget) {
            this.applyFocus(keyedTarget);
            return true;
        }

        if (
            this.lastTarget?.isConnected &&
            root.contains(this.lastTarget) &&
            isAvailableTvFocusTarget(this.lastTarget, true)
        ) {
            this.applyFocus(this.lastTarget);
            return true;
        }

        const candidates = collectCandidates(root);
        const target = this.closestCandidate(candidates.map((item) => item.target));
        if (target) {
            this.applyFocus(target);
            return true;
        }

        // Angular route/detail transitions and async Settings sections can
        // briefly render an empty root. Consume this key and retry before
        // allowing startup focus to jump to the tray.
        if (attempt < 20) {
            window.setTimeout(() => this.recover(attempt + 1), 50);
        } else {
            this.lastRootKind = null;
        }
        return true;
    }

    activateSettingsSection(element: HTMLElement): boolean {
        if (!element.matches(SETTINGS_ITEM_SELECTOR)) return false;
        if (!element.closest(SETTINGS_PANEL_SELECTOR)) return false;

        this.lastSettingsSection = element;
        element.click();
        this.focusSettingsContent(element);
        return true;
    }

    reopenSettingsPanel(active: HTMLElement | null): boolean {
        const panel = document.querySelector<HTMLElement>(
            SETTINGS_PANEL_SELECTOR
        );
        if (!panel || (active && !active.closest('main'))) return false;

        const target =
            (this.lastSettingsSection?.isConnected
                ? this.lastSettingsSection
                : null) ??
            panel.querySelector<HTMLElement>(
                `${SETTINGS_ITEM_SELECTOR}.active`
            ) ??
            panel.querySelector<HTMLElement>(SETTINGS_ITEM_SELECTOR);
        if (!target) return false;

        this.applyFocus(target);
        return true;
    }

    private focusSettingsContent(
        source: HTMLElement,
        attempt = 0
    ): void {
        window.setTimeout(() => {
            const testId = source.getAttribute('data-test-id') ?? '';
            const sectionId = testId.startsWith(SETTINGS_TEST_ID_PREFIX)
                ? testId.slice(SETTINGS_TEST_ID_PREFIX.length)
                : '';
            const section = sectionId
                ? document.getElementById(sectionId)
                : null;
            const target =
                (section
                    ? collectCandidates(section)[0]?.target
                    : undefined) ??
                section?.querySelector<HTMLElement>(BASIC_FOCUSABLE_SELECTOR);

            if (target) {
                this.applyFocus(target);
                return;
            }
            if (attempt < 20) {
                this.focusSettingsContent(source, attempt + 1);
            }
        }, attempt === 0 ? 0 : 50);
    }

    private remember(kind: WorkspaceRootKind, element: HTMLElement): void {
        const rect = element.getBoundingClientRect();
        this.lastRootKind = kind;
        this.lastTarget = element;
        this.lastPoint = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        };
        this.lastFocusKey =
            element.closest<HTMLElement>('[data-tv-focus-key]')?.dataset[
                'tvFocusKey'
            ] ?? null;
    }

    private resolveRoot(): HTMLElement | null {
        if (this.lastRootKind === 'main') {
            return document.querySelector<HTMLElement>('main');
        }
        if (this.lastRootKind === 'settings') {
            return document.querySelector<HTMLElement>(
                SETTINGS_PANEL_SELECTOR
            );
        }
        return null;
    }

    private closestCandidate(
        candidates: readonly HTMLElement[]
    ): HTMLElement | null {
        if (candidates.length === 0) return null;
        if (!this.lastPoint) return candidates[0];

        return candidates.reduce((best, candidate) => {
            const bestDistance = this.distanceFromLastPoint(best);
            const candidateDistance = this.distanceFromLastPoint(candidate);
            return candidateDistance < bestDistance ? candidate : best;
        });
    }

    private distanceFromLastPoint(element: HTMLElement): number {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - (this.lastPoint?.x ?? 0);
        const y = rect.top + rect.height / 2 - (this.lastPoint?.y ?? 0);
        return x * x + y * y;
    }
}
