import {
    measureBounds,
    persistVolume,
    readStoredVolume,
} from './android-native-bounds.utils';

describe('android native player bounds/volume utilities', () => {
    afterEach(() => {
        localStorage.clear();
    });

    it('clamps stored volume reads and persists raw volume values', () => {
        localStorage.setItem('volume', '2');
        expect(readStoredVolume()).toBe(1);

        localStorage.setItem('volume', '-0.5');
        expect(readStoredVolume()).toBe(0);

        localStorage.setItem('volume', 'not-a-number');
        expect(readStoredVolume()).toBe(1);

        persistVolume(0.35);
        expect(localStorage.getItem('volume')).toBe('0.35');
    });

    it('preserves fractional host edges and keeps minimum dimensions', () => {
        // Rounding happens once, natively, after CSS→device-pixel scaling
        // — pre-rounded edges would drift by up to 1px per scale factor on
        // scaled displays. See NativePlayerViewBounds.java.
        const host = {
            getBoundingClientRect: () => ({
                left: 10.4,
                top: 20.6,
                width: 0,
                height: 0.2,
            }),
        } as HTMLElement;

        expect(measureBounds(host)).toEqual({
            x: 10.4,
            y: 20.6,
            width: 1,
            height: 1,
        });
    });
});
