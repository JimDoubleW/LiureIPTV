package com.liureiptv.tv;

import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Receives a playlist backup shared into the app from outside (a file
 * manager's "Share" action) — the only way to hand this app a backup file:
 * Settings' Import button opens Android's native file chooser via
 * {@code <input type="file">.click()}, which requires genuine user
 * activation. Clicks synthesized by the D-pad engine's key dispatch (see
 * MainActivity#dispatchKeyEvent) run through WebView#evaluateJavascript and
 * carry none, so the chooser silently refuses to open from the remote.
 *
 * Registered as a share target for application/json in AndroidManifest.xml.
 * {@link #handleOnNewIntent} fires both for a cold start — Capacitor's own
 * BridgeActivity#load() replays the launch intent through onNewIntent — and
 * for a share arriving while the app is already running, which is safe here
 * because MainActivity is android:launchMode="singleTask", so there is only
 * ever one instance to receive it. notifyListeners(..., true) retains the
 * event natively until the JS side registers a listener, so a share landing
 * before Angular finishes bootstrapping is not lost.
 */
@CapacitorPlugin(name = "BackupImport")
public class BackupImportPlugin extends Plugin {

    private static final String EVENT_BACKUP_IMPORT_RECEIVED = "backupImportReceived";

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);

        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return;
        }

        Uri uri = extractStreamUri(intent);
        if (uri == null) {
            return;
        }

        String json = readUriAsUtf8(uri);
        if (json == null) {
            return;
        }

        JSObject data = new JSObject();
        data.put("json", json);
        notifyListeners(EVENT_BACKUP_IMPORT_RECEIVED, data, true);
    }

    private Uri extractStreamUri(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return extractStreamUriLegacy(intent);
    }

    @SuppressWarnings("deprecation")
    private Uri extractStreamUriLegacy(Intent intent) {
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    private String readUriAsUtf8(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) {
                return null;
            }

            StringBuilder builder = new StringBuilder();
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(input, StandardCharsets.UTF_8));
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, read);
            }
            return builder.toString();
        } catch (Exception ex) {
            return null;
        }
    }
}
