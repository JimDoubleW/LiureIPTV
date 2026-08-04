package com.liureiptv.tv;

import android.graphics.Color;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.coordinatorlayout.widget.CoordinatorLayout;

import com.getcapacitor.Bridge;

/**
 * Adds/removes a native {@link SurfaceView} as a sibling of the Capacitor
 * WebView, in the same CoordinatorLayout parent
 * (capacitor_bridge_layout_main.xml), positioned inside the
 * android-native-player component's placeholder bounds. The plugin may use a
 * smaller centered rectangle there when the stream's aspect ratio requires
 * letterboxing or pillarboxing.
 *
 * <p>The surface keeps SurfaceView's default Z ordering — behind the window,
 * visible through whatever pixels the WebView leaves fully transparent
 * ("punch-through"). {@link #attach} makes the WebView itself transparent;
 * the DOM side must also stop painting over the player's rect, which
 * {@code AndroidNativePlayerComponent} arranges by putting
 * {@code .native-video-punchthrough} on {@code <html>} for the session's
 * lifetime (see {@code workspace-shell.component.scss}).
 *
 * <p>Both halves are required and the DOM half is the easy one to miss. An
 * earlier revision concluded this technique was impossible on the reference
 * device (Amlogic S905X5M / Mali-G310) because video decoded correctly —
 * hardware decoder engaged, real buffer, correct {@code DEVICE} composition
 * in {@code dumpsys SurfaceFlinger} — yet never reached the screen: audio
 * only. That was the workspace shell's three opaque containers covering the
 * rect, not a driver limitation; with them transparent the picture appears.
 * Do not reintroduce {@code setZOrderOnTop(true)} to "fix" a black screen:
 * an on-top surface also covers this app's own player controls, and toggling
 * it mid-session destroys and recreates the Surface underneath ExoPlayer.
 * Check the DOM for an opaque ancestor first.
 *
 * <p>(A TextureView variant did fail for a genuine vendor reason: frames
 * reached the texture and were composited through the ordinary GPU draw pass,
 * but sampled solid black — a GL {@code external OES} incompatibility with
 * this vendor's decoder buffer format.)
 *
 * Must be driven entirely from the UI thread — {@code Bridge#getWebView()},
 * ViewGroup mutation, and SurfaceView creation are all main-thread-only;
 * {@link AndroidNativePlayerPlugin} is responsible for the
 * {@code runOnUiThread} marshaling, not this class.
 */
final class NativePlayerSurface {

    /**
     * Restored on detach(). The DOM's own opaque backgrounds paint over this
     * immediately regardless of the exact value — this only covers the
     * instant before the next frame, so an exact theme match isn't load
     * bearing, just a reasonable dark-theme default.
     */
    private static final int RESTORED_BACKGROUND_COLOR = Color.BLACK;

    private final Bridge bridge;
    private SurfaceView surfaceView;

    NativePlayerSurface(Bridge bridge) {
        this.bridge = bridge;
    }

    SurfaceView attach(NativePlayerViewBounds.Bounds bounds) {
        if (surfaceView != null) {
            return surfaceView;
        }

        WebView webView = bridge.getWebView();
        ViewGroup parent = (ViewGroup) webView.getParent();

        // No setZOrder* call: SurfaceView's default is exactly what
        // punch-through needs — the surface sits behind the window and shows
        // through the WebView's transparent pixels. See the class doc.
        surfaceView = new SurfaceView(bridge.getContext());
        parent.addView(surfaceView, 0, toLayoutParams(bounds));
        webView.setBackgroundColor(Color.TRANSPARENT);

        return surfaceView;
    }

    void updateBounds(NativePlayerViewBounds.Bounds bounds) {
        if (surfaceView == null) {
            return;
        }

        surfaceView.setLayoutParams(toLayoutParams(bounds));
    }

    void detach() {
        if (surfaceView == null) {
            return;
        }

        ViewGroup parent = (ViewGroup) surfaceView.getParent();
        if (parent != null) {
            parent.removeView(surfaceView);
        }
        surfaceView = null;

        bridge.getWebView().setBackgroundColor(RESTORED_BACKGROUND_COLOR);
    }

    boolean isAttached() {
        return surfaceView != null;
    }

    private static CoordinatorLayout.LayoutParams toLayoutParams(NativePlayerViewBounds.Bounds bounds) {
        // The WebView's parent (capacitor_bridge_layout_main.xml) is a
        // CoordinatorLayout, which casts every child's LayoutParams to its
        // own type during measure/layout — FrameLayout.LayoutParams here
        // throws a ClassCastException as soon as this view enters the tree.
        CoordinatorLayout.LayoutParams layoutParams =
                new CoordinatorLayout.LayoutParams(bounds.width, bounds.height);
        layoutParams.leftMargin = bounds.x;
        layoutParams.topMargin = bounds.y;
        return layoutParams;
    }
}
