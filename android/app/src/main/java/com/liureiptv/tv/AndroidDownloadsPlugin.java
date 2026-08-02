package com.liureiptv.tv;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Thin wrapper around {@link DownloadManager} — the OS-owned download queue,
 * not a custom resumable engine like the desktop build's. Chosen deliberately
 * over reimplementing the desktop's byte-range pause/resume: DownloadManager
 * survives an app restart or a device reboot without any code of ours,
 * resumes on its own when connectivity drops mid-transfer, and shows in the
 * system's own download notifications — all for a fraction of the code a
 * custom foreground-service downloader would need. The trade-off, accepted
 * up front: no true manual pause. See {@code android-downloads-bridge.ts},
 * which owns every piece of business logic (metadata, status mapping, the
 * pause-by-cancelling / resume-by-re-enqueueing compromise) — this class only
 * ever talks to the OS queue.
 *
 * Every download writes to {@code context.getExternalFilesDir("downloads")}:
 * app-private, no runtime permission on any API level, cleared on uninstall.
 * Not the public shared Downloads collection — that would need scoped-storage
 * permission handling for no benefit on a device nobody browses with a file
 * manager.
 */
@CapacitorPlugin(name = "AndroidDownloads")
public class AndroidDownloadsPlugin extends Plugin {

    private static final String DESTINATION_SUBDIRECTORY = "downloads";

    @PluginMethod
    public void enqueue(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        if (TextUtils.isEmpty(url) || TextUtils.isEmpty(fileName)) {
            call.reject("Missing url or fileName");
            return;
        }

        DownloadManager downloadManager = downloadManager();
        if (downloadManager == null) {
            call.reject("DownloadManager unavailable");
            return;
        }

        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setDestinationInExternalFilesDir(
                    getContext(), DESTINATION_SUBDIRECTORY, fileName);

            String title = call.getString("title");
            if (!TextUtils.isEmpty(title)) {
                request.setTitle(title);
            }

            String mimeType = call.getString("mimeType");
            if (!TextUtils.isEmpty(mimeType)) {
                request.setMimeType(mimeType);
            }

            String userAgent = call.getString("userAgent");
            if (!TextUtils.isEmpty(userAgent)) {
                request.addRequestHeader("User-Agent", userAgent);
            }
            String referer = call.getString("referer");
            if (!TextUtils.isEmpty(referer)) {
                request.addRequestHeader("Referer", referer);
            }
            String origin = call.getString("origin");
            if (!TextUtils.isEmpty(origin)) {
                request.addRequestHeader("Origin", origin);
            }

            // A TV box is virtually always on Wi-Fi/Ethernet with no data cap
            // in play; unrestricted matches the desktop build, which does not
            // ask either.
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

            long id = downloadManager.enqueue(request);

            JSObject result = new JSObject();
            result.put("id", String.valueOf(id));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Failed to start download", error);
        }
    }

    /**
     * One query for every id being polled, not one call per id — the TS side
     * polls every active download on a single timer, and a 90k-channel-scale
     * app should not turn that into N IPC round trips per tick.
     */
    @PluginMethod
    public void queryStatuses(PluginCall call) {
        JSArray idsJson = call.getArray("ids");
        if (idsJson == null || idsJson.length() == 0) {
            JSObject empty = new JSObject();
            empty.put("items", new JSArray());
            call.resolve(empty);
            return;
        }

        DownloadManager downloadManager = downloadManager();
        if (downloadManager == null) {
            call.reject("DownloadManager unavailable");
            return;
        }

        long[] ids = new long[idsJson.length()];
        try {
            for (int i = 0; i < idsJson.length(); i++) {
                ids[i] = Long.parseLong(idsJson.getString(i));
            }
        } catch (Exception error) {
            call.reject("Invalid id list", error);
            return;
        }

        JSArray items = new JSArray();
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(ids);
        try (Cursor cursor = downloadManager.query(query)) {
            int idIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID);
            int statusIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS);
            int reasonIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON);
            int bytesIndex =
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
            int totalIndex =
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            int localUriIndex = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI);

            while (cursor.moveToNext()) {
                JSObject item = new JSObject();
                item.put("id", String.valueOf(cursor.getLong(idIndex)));
                item.put("status", statusName(cursor.getInt(statusIndex)));
                item.put("reason", cursor.getInt(reasonIndex));
                item.put("bytesDownloaded", cursor.getLong(bytesIndex));

                long total = cursor.getLong(totalIndex);
                item.put("totalBytes", total > 0 ? total : JSObject.NULL);

                String localUri = cursor.getString(localUriIndex);
                item.put("localUri", localUri != null ? localUri : JSObject.NULL);

                items.put(item);
            }
        } catch (Exception error) {
            call.reject("Failed to query downloads", error);
            return;
        }

        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    /**
     * Removing a DownloadManager record also deletes the underlying file —
     * exactly the semantics both "remove" and "clear completed" want on the
     * desktop build (see {@code downloads.events.ts}'s
     * {@code removablePartialStatuses}, which includes {@code completed}).
     */
    @PluginMethod
    public void remove(PluginCall call) {
        JSArray idsJson = call.getArray("ids");
        if (idsJson == null || idsJson.length() == 0) {
            call.resolve(new JSObject());
            return;
        }

        DownloadManager downloadManager = downloadManager();
        if (downloadManager == null) {
            call.reject("DownloadManager unavailable");
            return;
        }

        try {
            long[] ids = new long[idsJson.length()];
            for (int i = 0; i < idsJson.length(); i++) {
                ids[i] = Long.parseLong(idsJson.getString(i));
            }
            downloadManager.remove(ids);
            call.resolve(new JSObject());
        } catch (Exception error) {
            call.reject("Failed to remove download", error);
        }
    }

    private DownloadManager downloadManager() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    private static String statusName(int status) {
        switch (status) {
            case DownloadManager.STATUS_PENDING:
                return "pending";
            case DownloadManager.STATUS_RUNNING:
                return "running";
            case DownloadManager.STATUS_PAUSED:
                return "paused";
            case DownloadManager.STATUS_SUCCESSFUL:
                return "successful";
            case DownloadManager.STATUS_FAILED:
                return "failed";
            default:
                return "unknown";
        }
    }
}
