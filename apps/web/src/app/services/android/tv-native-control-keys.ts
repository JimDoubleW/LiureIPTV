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
    const overlay = document.querySelector('.cdk-overlay-pane');
    return overlay !== null && overlayHasNativeKeyboardHandling(overlay);
}

/**
 * Return the open overlay only when it has no native/Material item manager.
 * Spatial search is scoped to this pane so background controls stay excluded.
 */
export function findUnmanagedOverlay(): HTMLElement | null {
    const overlay = document.querySelector<HTMLElement>('.cdk-overlay-pane');
    if (!overlay || overlayHasNativeKeyboardHandling(overlay)) {
        return null;
    }
    return overlay;
}
