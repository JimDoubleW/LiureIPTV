package com.liureiptv.tv;

import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowInsets;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import androidx.core.splashscreen.SplashScreen;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Apply Theme.SplashScreen's Android 12+ icon/background contract
        // before BridgeActivity creates the window and WebView.
        SplashScreen.installSplashScreen(this);

        // Must run before super.onCreate(), which is what builds the Bridge
        // and needs the plugin class in hand to register it. BridgeActivity's
        // onCreate() also replays the launch intent through onNewIntent(),
        // which is how BackupImportPlugin sees a share that cold-started the
        // app, not just one that arrives while it is already running.
        registerPlugin(BackupImportPlugin.class);
        registerPlugin(AndroidNativePlayerPlugin.class);
        registerPlugin(AndroidDownloadsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Takes the D-pad away from the WebView and hands it to the app's own
     * navigation engine.
     *
     * The WebView moves focus for D-pad keys natively, below the DOM event
     * layer, where preventDefault() has no reach. That produced two defects no
     * JavaScript could fix: merely traversing a text field focused it natively
     * and raised the IME over half the screen, and when the JS engine declined
     * a key the WebView's own document-order focus search ran anyway,
     * teleporting focus across panels. Consuming the keys here means the
     * WebView never runs that search at all; the JS engine
     * (window.__tvKeyDispatch, installed by armTvNavigation) becomes the only
     * thing that ever moves focus.
     *
     * The one deliberate exception: while the soft keyboard is visible, every
     * key belongs to it — arrows move the caret, letters type, back closes it.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String key = tvKeyName(event.getKeyCode());
        if (key == null || isImeVisible()) {
            return super.dispatchKeyEvent(event);
        }

        // Only a selected range input consumes repeated LEFT/RIGHT in the web
        // layer. Repeating other keys would make ordinary focus traversal race
        // through the UI, so their first DOWN remains the sole dispatched one.
        if (event.getAction() == KeyEvent.ACTION_DOWN
                && (event.getRepeatCount() == 0 || isHorizontalDpadKey(key))) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.evaluateJavascript(
                        "window.__tvKeyDispatch && window.__tvKeyDispatch('" + key
                                + "', " + event.getRepeatCount() + ")",
                        null);
            }
        }

        // Consume DOWN and UP alike: returning false for either would let the
        // WebView run its native focus search after all.
        return true;
    }

    private static boolean isHorizontalDpadKey(String key) {
        return "left".equals(key) || "right".equals(key);
    }

    private static String tvKeyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return "right";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                return "ok";
            case KeyEvent.KEYCODE_BACK:
                // From a list, the default chain finished the activity instead
                // of stepping back through the app's own history. JS closes an
                // open overlay first, then walks history, and only at the real
                // root minimizes the app. While the IME is visible this case is
                // never reached and the system closes the keyboard as usual.
                return "back";
            default:
                return null;
        }
    }

    private boolean isImeVisible() {
        // WindowInsets.Type needs API 30. Below that we cannot ask, and
        // consuming is the safer default: the reference device is API 34, and
        // a TV without the overlay keyboard visible wants the D-pad captured.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return false;
        }

        WindowInsets insets = getWindow().getDecorView().getRootWindowInsets();
        return insets != null && insets.isVisible(WindowInsets.Type.ime());
    }
}
