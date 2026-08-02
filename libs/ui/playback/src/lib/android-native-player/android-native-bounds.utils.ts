import { AndroidNativePlayerBounds } from '@iptvnator/shared/interfaces';

/**
 * Measures the host element in CSS pixels without rounding. The native
 * plugin converts these bounds to device pixels (× devicePixelRatio) and
 * rounds exactly once, after scaling — pre-rounding here would bake up to
 * ±0.5px of CSS error that the scale factor then amplifies into visible
 * off-by-one seams. Mirrors embedded-mpv-format.utils.ts's measureBounds.
 */
export function measureBounds(host: HTMLElement): AndroidNativePlayerBounds {
    const rect = host.getBoundingClientRect();
    return {
        x: rect.left,
        y: rect.top,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
    };
}

export function readStoredVolume(): number {
    const rawValue = Number(localStorage.getItem('volume') ?? '1');
    if (Number.isNaN(rawValue)) {
        return 1;
    }
    return Math.max(0, Math.min(1, rawValue));
}

export function persistVolume(value: number): void {
    localStorage.setItem('volume', String(value));
}
