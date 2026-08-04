import { collectCandidates } from './spatial-candidates';

const KEY_CODES: Readonly<Record<string, number>> = {
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Enter: 13,
    Escape: 27,
};

/** Dispatch a real key event to a native or Angular Material control. */
export function dispatchRealKey(key: string, target: EventTarget): void {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });

    // Material still tests the legacy values for Escape in some controls.
    const keyCode = KEY_CODES[key];
    if (keyCode !== undefined) {
        Object.defineProperty(event, 'keyCode', { value: keyCode });
        Object.defineProperty(event, 'which', { value: keyCode });
    }

    target.dispatchEvent(event);
}

function overlayHasNativeKeyboardHandling(overlay: Element): boolean {
    return (
        overlay.querySelector(
            '[role="option"], [role="menuitem"], [role="slider"]'
        ) !== null
    );
}

function isTransientFeedbackOverlay(overlay: Element): boolean {
    if (
        overlay.matches('.mat-mdc-dialog-panel') ||
        overlay.querySelector('[role="dialog"], mat-dialog-container')
    ) {
        return false;
    }

    return (
        overlay.matches('.mat-mdc-tooltip-panel') ||
        overlay.querySelector(
            '[role="tooltip"], .mat-mdc-tooltip,' +
                ' .mat-mdc-snack-bar-container'
        ) !== null
    );
}

function overlayHasActionableContent(overlay: Element): boolean {
    return (
        overlay.querySelector(
            'button, a[href], input, select, textarea,' +
                ' [role="option"], [role="menuitem"], [role="slider"],' +
                ' [role="dialog"], mat-dialog-container'
        ) !== null
    );
}

/** The topmost real menu/dialog; tooltips and snackbars never own the D-pad. */
export function findActionableOverlay(): HTMLElement | null {
    const overlays = Array.from(
        document.querySelectorAll<HTMLElement>('.cdk-overlay-pane')
    );
    return (
        overlays
            .reverse()
            .find(
                (overlay) =>
                    !isTransientFeedbackOverlay(overlay) &&
                    overlayHasActionableContent(overlay)
            ) ?? null
    );
}

export function focusFirstActionableOverlay(
    applyFocus: (element: HTMLElement) => void
): boolean {
    const overlay = findActionableOverlay();
    if (!overlay) return false;

    const target =
        collectCandidates(overlay)[0]?.target ??
        overlay.querySelector<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]),' +
                ' [role="option"], [role="menuitem"], [role="slider"]'
        );
    if (target) applyFocus(target);
    return true;
}

/**
 * A mat-select, native select, ARIA slider, or a Material overlay with real
 * managed items owns its arrow/Enter key handling. A bare role=menu wrapper is
 * deliberately insufficient: this app also uses mat-menu only for positioning
 * ordinary buttons, which the TV spatial engine must drive itself.
 */
export function isNativeControlOpen(active: Element | null): boolean {
    if (active?.closest('[role="slider"], select')) {
        return true;
    }

    // This app's CDK pane can be a direct child of its trigger rather than a
    // descendant of a global overlay container.
    const overlay = findActionableOverlay();
    return overlay !== null && overlayHasNativeKeyboardHandling(overlay);
}

/**
 * Return the open overlay only when it has no native/Material item manager.
 * Spatial search is scoped to this pane so background controls stay excluded.
 */
export function findUnmanagedOverlay(): HTMLElement | null {
    const overlay = findActionableOverlay();
    if (!overlay || overlayHasNativeKeyboardHandling(overlay)) {
        return null;
    }
    return overlay;
}
