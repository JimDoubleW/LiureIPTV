package com.liureiptv.tv;

/**
 * Converts a video-surface rect measured by the WebView
 * (getBoundingClientRect(), unrounded CSS pixels) into the physical pixels
 * the native {@link android.view.SurfaceView}'s
 * {@link android.widget.FrameLayout.LayoutParams} are positioned in.
 *
 * CSS pixels match physical pixels only at devicePixelRatio 1; every other
 * ratio requires scaling. Bounds are rounded exactly once here, after
 * scaling — edges first, then width/height derived from them. Rounding any
 * earlier (or per-field) lets fractional CSS layouts drift by a pixel and
 * opens a 1px seam between the video surface and the surrounding DOM UI —
 * the same lesson already learned for the desktop native-view engine (see
 * apps/electron-backend's embedded-mpv-bounds.util.ts, which this mirrors).
 *
 * devicePixelRatio comes from the WebView's own JS `window.devicePixelRatio`,
 * not {@link android.util.DisplayMetrics#density} — the two can diverge (page
 * zoom, WebView-specific scaling) and only the former is the ratio the CSS
 * bounds were actually measured against.
 */
public final class NativePlayerViewBounds {

    private NativePlayerViewBounds() {}

    public static final class Bounds {
        public final int x;
        public final int y;
        public final int width;
        public final int height;

        public Bounds(int x, int y, int width, int height) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof Bounds)) {
                return false;
            }
            Bounds that = (Bounds) other;
            return x == that.x && y == that.y && width == that.width && height == that.height;
        }

        @Override
        public int hashCode() {
            return ((x * 31 + y) * 31 + width) * 31 + height;
        }

        @Override
        public String toString() {
            return "Bounds{x=" + x + ", y=" + y + ", width=" + width + ", height=" + height + "}";
        }
    }

    public static Bounds toDevicePixels(
            double x, double y, double width, double height, double devicePixelRatio) {
        double scale = sanitizeScale(devicePixelRatio);

        long left = Math.round(x * scale);
        long top = Math.round(y * scale);
        long right = Math.round((x + width) * scale);
        long bottom = Math.round((y + height) * scale);

        int outWidth = (int) Math.max(1, right - left);
        int outHeight = (int) Math.max(1, bottom - top);

        return new Bounds((int) left, (int) top, outWidth, outHeight);
    }

    /**
     * Fits a video rectangle inside its host without changing the video's
     * aspect ratio. The returned rectangle remains in the same parent
     * coordinate space as {@code container}; invalid video dimensions leave
     * the container untouched until Media3 reports a real video size.
     */
    public static Bounds fitVideo(
            Bounds container, int videoWidth, int videoHeight, float pixelWidthHeightRatio) {
        if (container == null || videoWidth <= 0 || videoHeight <= 0) {
            return container;
        }

        double pixelRatio =
                Float.isFinite(pixelWidthHeightRatio) && pixelWidthHeightRatio > 0
                        ? pixelWidthHeightRatio
                        : 1.0;
        double videoRatio = ((double) videoWidth * pixelRatio) / videoHeight;
        double containerRatio = (double) container.width / container.height;

        if (containerRatio > videoRatio) {
            int fittedWidth = Math.max(1, (int) Math.round(container.height * videoRatio));
            int horizontalInset = (container.width - fittedWidth) / 2;
            return new Bounds(
                    container.x + horizontalInset,
                    container.y,
                    fittedWidth,
                    container.height);
        }

        int fittedHeight = Math.max(1, (int) Math.round(container.width / videoRatio));
        int verticalInset = (container.height - fittedHeight) / 2;
        return new Bounds(
                container.x,
                container.y + verticalInset,
                container.width,
                fittedHeight);
    }

    private static double sanitizeScale(double devicePixelRatio) {
        return Double.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1.0;
    }
}
