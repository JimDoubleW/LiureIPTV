package com.liureiptv.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.webkit.MimeTypeMap;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

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
 * Every download is staged in {@code context.getExternalFilesDir("downloads")}
 * so DownloadManager can survive process death without broad storage
 * permission. When the user selected a destination through Android's Storage
 * Access Framework, a completed staging file is copied to that persisted
 * document-tree URI on a background worker. This two-step design is required:
 * DownloadManager cannot target an arbitrary SAF {@code content://} tree.
 */
@CapacitorPlugin(name = "AndroidDownloads")
public class AndroidDownloadsPlugin extends Plugin {

    private static final String DESTINATION_SUBDIRECTORY = "downloads";
    private static final String DEFAULT_FOLDER_LABEL = "Android app downloads";
    private static final String PREFERENCES_NAME = "android-download-destinations";
    private static final String SELECTED_TREE_URI = "selected-tree-uri";
    private static final String SELECTED_TREE_LABEL = "selected-tree-label";
    private static final String DOWNLOAD_PREFIX = "download.";
    private static final String APP_PRIVATE_DESTINATION = "app-private://downloads";
    private static final String MEDIA_STORE_SCHEME = "liureiptv-media";
    private static final String MEDIA_RELATIVE_PATH =
            Environment.DIRECTORY_DOWNLOADS + "/LiureIPTV";
    private static final String TV_DOCUMENTS_STUB_PACKAGE =
            "com.android.tv.frameworkpackagestubs";
    private static final int COPY_BUFFER_SIZE = 1024 * 1024;

    private final ExecutorService exportExecutor = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<Long, Future<?>> exportJobs = new ConcurrentHashMap<>();
    private final Set<Long> removedIds =
            Collections.newSetFromMap(new ConcurrentHashMap<>());

    @PluginMethod
    public void selectFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);

        String currentTree = preferences().getString(SELECTED_TREE_URI, null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && currentTree != null) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(currentTree));
        }

        ResolveInfo picker = getContext()
                .getPackageManager()
                .resolveActivity(intent, 0);
        if (picker == null
                || picker.activityInfo == null
                || TV_DOCUMENTS_STUB_PACKAGE.equals(picker.activityInfo.packageName)) {
            showTvDestinationPicker(call);
            return;
        }

        try {
            startActivityForResult(call, intent, "folderSelected");
        } catch (Exception error) {
            showTvDestinationPicker(call);
        }
    }

    @ActivityCallback
    private void folderSelected(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        Uri treeUri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || treeUri == null) {
            call.resolve(folderResult(null, null));
            return;
        }

        try {
            int grantFlags = data.getFlags()
                    & (Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext()
                    .getContentResolver()
                    .takePersistableUriPermission(treeUri, grantFlags);

            String label = folderLabel(treeUri);
            preferences()
                    .edit()
                    .putString(SELECTED_TREE_URI, treeUri.toString())
                    .putString(SELECTED_TREE_LABEL, label)
                    .apply();
            call.resolve(folderResult(treeUri.toString(), label));
        } catch (Exception error) {
            call.reject("Failed to authorize download folder", error);
        }
    }

    @PluginMethod
    public void getSelectedFolder(PluginCall call) {
        SharedPreferences preferences = preferences();
        String uri = preferences.getString(SELECTED_TREE_URI, null);
        String label = preferences.getString(
                SELECTED_TREE_LABEL,
                uri == null ? DEFAULT_FOLDER_LABEL : null);
        call.resolve(folderResult(uri, label == null ? DEFAULT_FOLDER_LABEL : label));
    }

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
            String selectedDestination = preferences().getString(SELECTED_TREE_URI, null);
            rememberDestination(
                    id,
                    fileName,
                    mimeTypeFor(fileName, mimeType),
                    APP_PRIVATE_DESTINATION.equals(selectedDestination)
                            ? null
                            : selectedDestination);

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
                long id = cursor.getLong(idIndex);
                int nativeStatus = cursor.getInt(statusIndex);
                String localUri = cursor.getString(localUriIndex);
                JSObject item = new JSObject();
                item.put("id", String.valueOf(id));
                item.put("status", statusName(nativeStatus));
                item.put("reason", cursor.getInt(reasonIndex));
                item.put("bytesDownloaded", cursor.getLong(bytesIndex));

                long total = cursor.getLong(totalIndex);
                item.put("totalBytes", total > 0 ? total : JSObject.NULL);

                if (nativeStatus == DownloadManager.STATUS_SUCCESSFUL) {
                    applyExportStatus(item, id, localUri);
                } else {
                    item.put("localUri", localUri != null ? localUri : JSObject.NULL);
                }

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
                removedIds.add(ids[i]);
                cancelExport(ids[i]);
                deleteExportedFiles(ids[i]);
            }
            downloadManager.remove(ids);
            for (long id : ids) {
                clearDestination(id);
            }
            call.resolve(new JSObject());
        } catch (Exception error) {
            call.reject("Failed to remove download", error);
        }
    }

    private DownloadManager downloadManager() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private void rememberDestination(long id, String fileName, String mimeType, String treeUri) {
        removedIds.remove(id);
        SharedPreferences.Editor editor = preferences()
                .edit()
                .putString(downloadKey(id, "file-name"), fileName)
                .putString(downloadKey(id, "mime-type"), mimeType)
                .remove(downloadKey(id, "exported-uri"))
                .remove(downloadKey(id, "pending-uri"))
                .remove(downloadKey(id, "export-error"));
        if (treeUri == null) {
            editor.remove(downloadKey(id, "tree-uri"));
        } else {
            editor.putString(downloadKey(id, "tree-uri"), treeUri);
        }
        editor.apply();
    }

    private void applyExportStatus(JSObject item, long id, String stagingUri) {
        SharedPreferences preferences = preferences();
        String treeUri = preferences.getString(downloadKey(id, "tree-uri"), null);
        if (treeUri == null) {
            item.put("localUri", stagingUri != null ? stagingUri : JSObject.NULL);
            return;
        }

        String exportedUri = preferences.getString(downloadKey(id, "exported-uri"), null);
        if (exportedUri != null) {
            item.put("localUri", exportedUri);
            return;
        }

        String exportError = preferences.getString(downloadKey(id, "export-error"), null);
        if (exportError != null) {
            item.put("status", "failed");
            item.put("reason", -1);
            item.put("errorMessage", exportError);
            item.put("localUri", JSObject.NULL);
            return;
        }

        item.put("status", "exporting");
        item.put("localUri", JSObject.NULL);
        startExport(id, treeUri);
    }

    private void startExport(long id, String treeUri) {
        synchronized (exportJobs) {
            if (exportJobs.containsKey(id) || removedIds.contains(id)) {
                return;
            }
            Future<?> future = exportExecutor.submit(() -> {
                try {
                    exportDownload(id, treeUri);
                } finally {
                    synchronized (exportJobs) {
                        exportJobs.remove(id);
                    }
                }
            });
            exportJobs.put(id, future);
        }
    }

    private void exportDownload(long id, String destination) {
        SharedPreferences preferences = preferences();
        ContentResolver resolver = getContext().getContentResolver();
        Uri targetUri = null;
        try {
            deleteUri(preferences.getString(downloadKey(id, "pending-uri"), null));
            String mimeType =
                    preferences.getString(downloadKey(id, "mime-type"), "video/mp4");
            String fileName =
                    preferences.getString(downloadKey(id, "file-name"), "download.mp4");
            targetUri = createDestinationDocument(destination, fileName, mimeType);
            if (targetUri == null) {
                throw new IllegalStateException("The selected folder refused the new file");
            }

            preferences.edit()
                    .putString(downloadKey(id, "pending-uri"), targetUri.toString())
                    .remove(downloadKey(id, "export-error"))
                    .commit();

            copyDownloadedFile(id, targetUri);

            if (removedIds.contains(id)) {
                deleteUri(targetUri.toString());
                return;
            }
            publishMediaStoreDocument(destination, targetUri);
            preferences.edit()
                    .putString(downloadKey(id, "exported-uri"), targetUri.toString())
                    .remove(downloadKey(id, "pending-uri"))
                    .remove(downloadKey(id, "export-error"))
                    .apply();
        } catch (Exception error) {
            if (targetUri != null) {
                deleteUri(targetUri.toString());
            }
            preferences.edit().remove(downloadKey(id, "pending-uri")).apply();
            if (!removedIds.contains(id)) {
                preferences.edit()
                        .putString(
                                downloadKey(id, "export-error"),
                                "Failed to copy into the selected folder: "
                                        + safeErrorMessage(error))
                        .apply();
            }
        }
    }

    private void cancelExport(long id) {
        Future<?> job;
        synchronized (exportJobs) {
            job = exportJobs.remove(id);
        }
        if (job != null) {
            job.cancel(true);
        }
    }

    private void deleteExportedFiles(long id) {
        SharedPreferences preferences = preferences();
        deleteUri(preferences.getString(downloadKey(id, "exported-uri"), null));
        deleteUri(preferences.getString(downloadKey(id, "pending-uri"), null));
    }

    private void deleteUri(String uri) {
        if (uri == null) {
            return;
        }
        try {
            Uri parsed = Uri.parse(uri);
            if (ContentResolver.SCHEME_FILE.equals(parsed.getScheme())) {
                File file = new File(parsed.getPath());
                if (file.exists()) {
                    file.delete();
                }
            } else {
                getContext().getContentResolver().delete(parsed, null, null);
            }
        } catch (Exception ignored) {
            // The provider may already have removed an interrupted export.
        }
    }

    private void clearDestination(long id) {
        preferences().edit()
                .remove(downloadKey(id, "tree-uri"))
                .remove(downloadKey(id, "file-name"))
                .remove(downloadKey(id, "mime-type"))
                .remove(downloadKey(id, "exported-uri"))
                .remove(downloadKey(id, "pending-uri"))
                .remove(downloadKey(id, "export-error"))
                .apply();
    }

    private String folderLabel(Uri treeUri) {
        String documentId = DocumentsContract.getTreeDocumentId(treeUri);
        Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
        try (Cursor cursor = getContext().getContentResolver().query(
                documentUri,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
                null,
                null,
                null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String label = cursor.getString(0);
                if (!TextUtils.isEmpty(label)) {
                    return label;
                }
            }
        }
        return treeUri.getLastPathSegment();
    }

    private void showTvDestinationPicker(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            List<FolderChoice> choices = tvFolderChoices();
            String[] labels = new String[choices.size()];
            for (int i = 0; i < choices.size(); i++) {
                labels[i] = choices.get(i).label;
            }

            AlertDialog dialog = new AlertDialog.Builder(getActivity())
                    .setTitle("Download destination")
                    .setItems(labels, (ignored, index) -> {
                        FolderChoice choice = choices.get(index);
                        preferences()
                                .edit()
                                .putString(SELECTED_TREE_URI, choice.uri)
                                .putString(SELECTED_TREE_LABEL, choice.label)
                                .apply();
                        call.resolve(folderResult(choice.uri, choice.label));
                    })
                    .setNegativeButton(android.R.string.cancel, (ignored, which) ->
                            call.resolve(folderResult(null, null)))
                    .create();
            dialog.setOnCancelListener(ignored ->
                    call.resolve(folderResult(null, null)));
            dialog.show();
        });
    }

    private List<FolderChoice> tvFolderChoices() {
        List<FolderChoice> choices = new ArrayList<>();
        choices.add(new FolderChoice(
                APP_PRIVATE_DESTINATION,
                "App storage (removed on uninstall)"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            for (String volume : MediaStore.getExternalVolumeNames(getContext())) {
                String storageLabel = MediaStore.VOLUME_EXTERNAL_PRIMARY.equals(volume)
                        ? "Internal storage"
                        : "External storage (" + volume + ")";
                Uri destination = new Uri.Builder()
                        .scheme(MEDIA_STORE_SCHEME)
                        .authority(volume)
                        .path(MEDIA_RELATIVE_PATH)
                        .build();
                choices.add(new FolderChoice(
                        destination.toString(),
                        storageLabel + " · " + MEDIA_RELATIVE_PATH));
            }
        }
        return choices;
    }

    private Uri createDestinationDocument(
            String destination,
            String fileName,
            String mimeType) throws Exception {
        Uri uri = Uri.parse(destination);
        if (MEDIA_STORE_SCHEME.equals(uri.getScheme())) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, trimLeadingSlash(uri.getPath()));
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            return getContext()
                    .getContentResolver()
                    .insert(
                            MediaStore.Downloads.getContentUri(uri.getAuthority()),
                            values);
        }
        if (ContentResolver.SCHEME_FILE.equals(uri.getScheme())) {
            File directory = new File(uri.getPath());
            if (!directory.exists() && !directory.mkdirs()) {
                throw new IllegalStateException("Could not create the selected folder");
            }
            return Uri.fromFile(uniqueFile(directory, fileName));
        }

        String documentId = DocumentsContract.getTreeDocumentId(uri);
        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(uri, documentId);
        return DocumentsContract.createDocument(
                getContext().getContentResolver(),
                parentUri,
                mimeType,
                fileName);
    }

    private void copyDownloadedFile(long id, Uri targetUri) throws Exception {
        DownloadManager manager = downloadManager();
        if (manager == null) {
            throw new IllegalStateException("DownloadManager unavailable");
        }
        OutputStream target = ContentResolver.SCHEME_FILE.equals(targetUri.getScheme())
                ? new FileOutputStream(new File(targetUri.getPath()))
                : getContext().getContentResolver().openOutputStream(targetUri, "w");
        if (target == null) {
            throw new IllegalStateException("The selected folder is not writable");
        }

        try (ParcelFileDescriptor source = manager.openDownloadedFile(id);
                InputStream input = new FileInputStream(source.getFileDescriptor());
                OutputStream output = target) {
            byte[] buffer = new byte[COPY_BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted() || removedIds.contains(id)) {
                    throw new InterruptedIOException("Download export canceled");
                }
                output.write(buffer, 0, count);
            }
            output.flush();
        }
    }

    private void publishMediaStoreDocument(String destination, Uri uri) {
        if (!MEDIA_STORE_SCHEME.equals(Uri.parse(destination).getScheme())
                || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return;
        }
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        getContext().getContentResolver().update(uri, values, null, null);
    }

    private static File uniqueFile(File directory, String fileName) {
        File candidate = new File(directory, fileName);
        if (!candidate.exists()) {
            return candidate;
        }
        int dot = fileName.lastIndexOf('.');
        String base = dot < 0 ? fileName : fileName.substring(0, dot);
        String extension = dot < 0 ? "" : fileName.substring(dot);
        int suffix = 1;
        do {
            candidate = new File(directory, base + " (" + suffix++ + ")" + extension);
        } while (candidate.exists());
        return candidate;
    }

    private static String trimLeadingSlash(String value) {
        if (value == null) {
            return MEDIA_RELATIVE_PATH;
        }
        return value.startsWith("/") ? value.substring(1) : value;
    }

    private static JSObject folderResult(String uri, String label) {
        JSObject result = new JSObject();
        result.put("uri", uri == null ? JSObject.NULL : uri);
        result.put("label", label == null ? JSObject.NULL : label);
        return result;
    }

    private static String mimeTypeFor(String fileName, String requestedMimeType) {
        if (!TextUtils.isEmpty(requestedMimeType)) {
            return requestedMimeType;
        }
        int dot = fileName.lastIndexOf('.');
        String extension = dot < 0 ? "" : fileName.substring(dot + 1).toLowerCase();
        String inferred = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return inferred == null ? "video/mp4" : inferred;
    }

    private static String downloadKey(long id, String suffix) {
        return DOWNLOAD_PREFIX + id + "." + suffix;
    }

    private static String safeErrorMessage(Exception error) {
        String message = error.getMessage();
        return TextUtils.isEmpty(message) ? error.getClass().getSimpleName() : message;
    }

    private static final class FolderChoice {
        final String uri;
        final String label;

        FolderChoice(String uri, String label) {
            this.uri = uri;
            this.label = label;
        }
    }

    @Override
    protected void handleOnDestroy() {
        exportExecutor.shutdownNow();
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
