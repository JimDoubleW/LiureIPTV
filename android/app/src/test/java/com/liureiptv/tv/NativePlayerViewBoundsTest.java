package com.liureiptv.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * JVM analogue of embedded-mpv-bounds.util.spec.ts — same edge-rounding
 * invariants, ported to the single devicePixelRatio factor Android uses in
 * place of Electron's zoomFactor x displayScaleFactor.
 */
public class NativePlayerViewBoundsTest {

    @Test
    public void returnsBoundsUnchangedAtDevicePixelRatioOne() {
        NativePlayerViewBounds.Bounds result =
                NativePlayerViewBounds.toDevicePixels(372, 60, 578, 330, 1.0);

        assertEquals(new NativePlayerViewBounds.Bounds(372, 60, 578, 330), result);
    }

    @Test
    public void scalesBoundsByDevicePixelRatio() {
        NativePlayerViewBounds.Bounds result =
                NativePlayerViewBounds.toDevicePixels(372, 60, 578, 330, 1.4);

        assertEquals(new NativePlayerViewBounds.Bounds(521, 84, 809, 462), result);
    }

    @Test
    public void roundsFractionalCssEdgesOnlyAfterScaling() {
        // A 10.49px CSS edge at 200% renders at 21 physical pixels; edges
        // rounded before scaling would send 20 and shift the video by 1px.
        NativePlayerViewBounds.Bounds result =
                NativePlayerViewBounds.toDevicePixels(10.49, 0.5, 100.02, 50, 2.0);

        assertEquals(new NativePlayerViewBounds.Bounds(21, 1, 200, 100), result);
    }

    @Test
    public void keepsVerticallyAdjacentRectsSeamlessUnderFractionalScales() {
        // 42 x 1.25 and 153 x 1.25 both land on .5/.25 fractions: rounding
        // x/y/width/height independently would misplace the shared edge by
        // 1px, while edge-based rounding keeps the rects flush.
        NativePlayerViewBounds.Bounds upper =
                NativePlayerViewBounds.toDevicePixels(0, 42, 500, 111, 1.25);
        NativePlayerViewBounds.Bounds lower =
                NativePlayerViewBounds.toDevicePixels(0, 153, 500, 90, 1.25);

        assertEquals(lower.y, upper.y + upper.height);
    }

    @Test
    public void clampsResultToAtLeastOneByOne() {
        NativePlayerViewBounds.Bounds result =
                NativePlayerViewBounds.toDevicePixels(-100000, -100000, 1, 1, 1.5);

        assertTrue(result.width >= 1);
        assertTrue(result.height >= 1);
    }

    @Test
    public void treatsNonFiniteOrNonPositiveRatiosAsOne() {
        double[] invalidRatios = {Double.NaN, 0, -1, Double.POSITIVE_INFINITY};

        for (double ratio : invalidRatios) {
            NativePlayerViewBounds.Bounds result =
                    NativePlayerViewBounds.toDevicePixels(372, 60, 578, 330, ratio);

            assertEquals(new NativePlayerViewBounds.Bounds(372, 60, 578, 330), result);
        }
    }

    @Test
    public void centersLandscapeVideoInsideShortWideHost() {
        NativePlayerViewBounds.Bounds result =
                NativePlayerViewBounds.fitVideo(
                        new NativePlayerViewBounds.Bounds(120, 80, 1800, 450),
                        1920,
                        1080,
                        1.0f);

        assertEquals(new NativePlayerViewBounds.Bounds(620, 80, 800, 450), result);
    }

    @Test
    public void centersPortraitVideoInsideWideHostAndHonorsPixelRatio() {
        NativePlayerViewBounds.Bounds result =
                NativePlayerViewBounds.fitVideo(
                        new NativePlayerViewBounds.Bounds(10, 20, 1000, 600),
                        720,
                        1280,
                        1.0f);

        assertEquals(new NativePlayerViewBounds.Bounds(341, 20, 338, 600), result);

        NativePlayerViewBounds.Bounds anamorphic =
                NativePlayerViewBounds.fitVideo(
                        new NativePlayerViewBounds.Bounds(0, 0, 1000, 800),
                        720,
                        576,
                        1.25f);
        assertEquals(new NativePlayerViewBounds.Bounds(0, 80, 1000, 640), anamorphic);
    }
}
