import { clearVirtualFocus } from './virtual-focus';
import type { TvDirection } from './spatial-geometry';

export const TV_RANGE_ACTIVE_ATTRIBUTE = 'data-tv-range-active';

let preparedRange: HTMLInputElement | null = null;
let returnTarget: HTMLElement | null = null;

export function isTvRangeInput(
    element: Element | null
): element is HTMLInputElement {
    return element instanceof HTMLInputElement && element.type === 'range';
}

/**
 * Records where BACK should return after slider adjustment and keeps the range
 * on virtual focus so Android never sees a focusable text-editor candidate.
 */
export function prepareVirtualFocus(
    element: HTMLElement,
    origin: HTMLElement | null
): boolean {
    const range = isTvRangeInput(element) ? element : null;
    if (preparedRange !== range) {
        preparedRange?.removeAttribute(TV_RANGE_ACTIVE_ATTRIBUTE);
    }
    preparedRange = range;
    if (!range) {
        returnTarget = null;
        return false;
    }

    range.removeAttribute(TV_RANGE_ACTIVE_ATTRIBUTE);
    returnTarget =
        origin &&
        !(origin instanceof HTMLInputElement) &&
        !(origin instanceof HTMLTextAreaElement) &&
        !origin.isContentEditable
            ? origin
            : null;
    return true;
}

/**
 * Operates a range input without granting it real DOM focus.
 *
 * The reference Android TV opens its IME when a range input receives focus,
 * even though the control cannot accept text. OK therefore enters a virtual
 * adjustment mode, LEFT/RIGHT adjust and commit its value, and BACK exits.
 * Android forwards the held-key repeat count so an intentional long press
 * progressively increases the adjustment speed without affecting navigation.
 */
export function handleTvRangeKey(
    element: Element | null,
    key: TvDirection | 'ok',
    repeatCount = 0
): boolean {
    if (!isTvRangeInput(element)) {
        return false;
    }
    if (key === 'ok') {
        if (!element.disabled) {
            element.setAttribute(TV_RANGE_ACTIVE_ATTRIBUTE, '');
        }
        return true;
    }
    if (!element.hasAttribute(TV_RANGE_ACTIVE_ATTRIBUTE)) {
        return false;
    }
    if (element.disabled || (key !== 'left' && key !== 'right')) return true;

    const steps = repeatStepCount(repeatCount);
    const previousValue = element.value;
    if (key === 'left') {
        element.stepDown(steps);
    } else {
        element.stepUp(steps);
    }

    if (element.value !== previousValue) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
}

/**
 * Native Android key repeats are cumulative during one held D-pad press.
 * Start precisely, then grow in deliberately distinct, predictable stages.
 */
function repeatStepCount(repeatCount: number): number {
    if (repeatCount >= 60) return 30;
    if (repeatCount >= 30) return 10;
    if (repeatCount >= 15) return 5;
    if (repeatCount >= 6) return 2;
    return 1;
}

/**
 * Leaves slider adjustment without invoking the route-level BACK behavior.
 * Restores the control that led into the range, or the first player button.
 */
export function releaseFocus(element: Element | null): boolean {
    if (
        !isTvRangeInput(element) ||
        !element.hasAttribute(TV_RANGE_ACTIVE_ATTRIBUTE)
    ) {
        return false;
    }

    element.removeAttribute(TV_RANGE_ACTIVE_ATTRIBUTE);
    clearVirtualFocus();
    const fallback =
        returnTarget?.isConnected === true
            ? returnTarget
            : element
                  .closest('app-player-controls')
                  ?.querySelector<HTMLElement>('button:not([disabled])');
    preparedRange = null;
    returnTarget = null;
    fallback?.focus({ preventScroll: true });
    return true;
}
