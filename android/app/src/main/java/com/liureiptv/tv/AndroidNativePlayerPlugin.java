package com.liureiptv.tv;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.WindowManager;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Phase 1 of the native video engine: one ExoPlayer instance rendering to a
 * {@link NativePlayerSurface} — a SurfaceView sibling of the WebView, sitting
 * behind it and visible through the WebView's transparent pixels (see that
 * class's doc comment for what the DOM side must do to keep those pixels
 * transparent). Exists because the WebView plays 4K IPTV streams with audio
 * only — the SoC decodes HEVC/AV1 4K60 fine in hardware, the bottleneck is
 * the WebView + JS demuxing. ExoPlayer talks to the platform decoder and
 * built-in TsExtractor directly instead.
 *
 * Audio-track switching is supported: IPTV VOD is largely multi-language
 * ("MULTI" in the title means several dubs), so the native engine would have
 * been a downgrade from the WebView without it.
 *
 * Deliberately NOT in scope here (see the phase-1 plan): DRM/ClearKey,
 * subtitle rendering, playback speed, aspect override, recording, PiP.
 * DASH/ClearKey channels never reach this plugin — the JS side keeps those
 * on the existing HTML5/Shaka path.
 *
 * Every method marshals onto the UI thread: ExoPlayer must be built and
 * mutated on a single Looper thread, and SurfaceView/ViewGroup mutation is
 * main-thread-only in Android regardless.
 */
@CapacitorPlugin(name = "AndroidNativePlayer")
public class AndroidNativePlayerPlugin extends Plugin {

    private static final String EVENT_STATUS = "nativePlayerStatus";
    private static final long POSITION_POLL_INTERVAL_MS = 500;

    private ExoPlayer player;
    private NativePlayerSurface surface;
    private String sessionId;
    private boolean isLive;
    private String lastError;

    private String lastPushedStatus;
    private String lastPushedTracksSignature;
    private long lastPushedPositionMillis = Long.MIN_VALUE;

    private final Handler positionPollHandler = new Handler(Looper.getMainLooper());
    private final Runnable positionPollRunnable = new Runnable() {
        @Override
        public void run() {
            pushSnapshotIfChanged();
            positionPollHandler.postDelayed(this, POSITION_POLL_INTERVAL_MS);
        }
    };

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int playbackState) {
            pushSnapshotIfChanged();
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            keepScreenOn(isPlaying);
            pushSnapshotIfChanged();
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            lastError = error.getMessage();
            pushSnapshotIfChanged();
        }

        @Override
        public void onTracksChanged(Tracks tracks) {
            // Tracks appear well after load() — the audio list is empty until
            // the first samples are read — and change again on every switch,
            // neither of which moves status or position, so the snapshot's
            // own change test would drop both updates.
            pushSnapshotIfChanged();
        }
    };

    @PluginMethod
    public void create(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            // Defensive: a missed dispose() (fast channel-zap race) must
            // never leave two sessions or a leaked transparent WebView.
            disposeInternal();

            JSObject boundsJson = call.getObject("bounds");
            double devicePixelRatio = call.getDouble("devicePixelRatio", 1.0);
            double volume = call.getDouble("volume", 1.0);

            sessionId = UUID.randomUUID().toString();
            lastError = null;
            lastPushedStatus = null;
            lastPushedTracksSignature = null;
            lastPushedPositionMillis = Long.MIN_VALUE;

            player = new ExoPlayer.Builder(getContext()).build();
            player.addListener(playerListener);
            player.setVolume((float) volume);

            surface = new NativePlayerSurface(getBridge());
            player.setVideoSurfaceView(
                    surface.attach(boundsFromCall(boundsJson, devicePixelRatio)));

            startPositionPolling();

            JSObject result = new JSObject();
            result.put("id", sessionId);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void load(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!isCurrentSession(call) || player == null) {
                call.resolve();
                return;
            }

            String url = call.getString("url");
            if (TextUtils.isEmpty(url)) {
                call.reject("Missing url");
                return;
            }

            lastError = null;
            isLive = call.getBoolean("isLive", false);
            Double startSeconds = call.getDouble("startSeconds");
            String userAgent = call.getString("userAgent");
            Map<String, String> headers = toStringMap(call.getObject("headers"));

            DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory();
            if (!TextUtils.isEmpty(userAgent)) {
                httpFactory.setUserAgent(userAgent);
            }
            if (!headers.isEmpty()) {
                httpFactory.setDefaultRequestProperties(headers);
            }

            MediaItem.Builder itemBuilder = new MediaItem.Builder().setUri(url);
            String mimeType = resolveMimeType(call.getString("mimeType"), url, getContext());
            if (mimeType != null) {
                itemBuilder.setMimeType(mimeType);
            }

            // Not the raw http factory: a downloaded file plays from a
            // file:// (or occasionally content://) URI, which
            // DefaultHttpDataSource cannot open at all. DefaultDataSource
            // delegates by scheme — http(s) still goes through the same
            // header-carrying httpFactory, local schemes go through
            // FileDataSource/ContentDataSource — so this one factory serves
            // both live streaming and downloaded playback.
            DataSource.Factory dataSourceFactory =
                    new DefaultDataSource.Factory(getContext(), httpFactory);
            MediaSource mediaSource =
                    new DefaultMediaSourceFactory(getContext())
                            .setDataSourceFactory(dataSourceFactory)
                            .createMediaSource(itemBuilder.build());

            player.setMediaSource(mediaSource);
            player.prepare();
            if (startSeconds != null && startSeconds > 0) {
                player.seekTo((long) (startSeconds * 1000));
            }
            player.setPlayWhenReady(true);

            call.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (isCurrentSession(call) && player != null) {
                player.play();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (isCurrentSession(call) && player != null) {
                player.pause();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (isCurrentSession(call) && player != null) {
                double positionSeconds = call.getDouble("positionSeconds", 0.0);
                player.seekTo((long) (positionSeconds * 1000));
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (isCurrentSession(call) && player != null) {
                double volume = call.getDouble("volume", 1.0);
                player.setVolume((float) volume);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setBounds(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (isCurrentSession(call) && surface != null) {
                JSObject boundsJson = call.getObject("bounds");
                double devicePixelRatio = call.getDouble("devicePixelRatio", 1.0);
                surface.updateBounds(boundsFromCall(boundsJson, devicePixelRatio));
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void dispose(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (isCurrentSession(call)) {
                disposeInternal();
            }
            call.resolve();
        });
    }

    /**
     * Stops the active session without requiring its id. The TV shell uses
     * this immediately before Capacitor's App.exitApp() so ExoPlayer is
     * silenced and released before the Activity finishes.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            disposeInternal();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::disposeInternal);
    }

    /**
     * Watching a film involves no input for two hours, so without this the
     * TV's screensaver takes the screen mid-playback. ExoPlayer does not do
     * this for us — the flag belongs to the window, which the plugin does not
     * own. Mirrors the desktop engine's `powerSaveBlocker`, which is likewise
     * held only while something is actually playing rather than for the whole
     * session, so a film left paused overnight still lets the screen sleep.
     */
    private void keepScreenOn(boolean keepOn) {
        getActivity().runOnUiThread(() -> {
            if (keepOn) {
                getActivity()
                        .getWindow()
                        .addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                getActivity()
                        .getWindow()
                        .clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
    }

    private void disposeInternal() {
        keepScreenOn(false);
        stopPositionPolling();

        if (player != null) {
            player.removeListener(playerListener);
            // Releasing a large local content:// source can take noticeable
            // time on Android TV. Silence and stop the renderers first so a
            // route change never leaves movie audio playing behind the
            // catalogue while release() finishes its cleanup.
            player.setPlayWhenReady(false);
            player.setVolume(0f);
            player.pause();
            player.stop();
            player.clearVideoSurface();
            player.release();
            player = null;
        }
        if (surface != null) {
            surface.detach();
            surface = null;
        }

        sessionId = null;
        lastError = null;
        lastPushedStatus = null;
        lastPushedTracksSignature = null;
        lastPushedPositionMillis = Long.MIN_VALUE;
    }

    private void startPositionPolling() {
        positionPollHandler.removeCallbacks(positionPollRunnable);
        positionPollHandler.postDelayed(positionPollRunnable, POSITION_POLL_INTERVAL_MS);
    }

    private void stopPositionPolling() {
        positionPollHandler.removeCallbacks(positionPollRunnable);
    }

    /**
     * Pushed at most once per poll tick, and only when something actually
     * changed — status, or position beyond a coarse threshold — mirroring
     * the desktop native-view engine's "poll, diff, then push" main-process
     * loop. ExoPlayer has no per-tick position callback of its own, and
     * pushing every 500ms unconditionally while paused/idle would be
     * needless bridge traffic for a snapshot nothing in it changed.
     */
    private void pushSnapshotIfChanged() {
        if (player == null || sessionId == null) {
            return;
        }

        String status = currentStatus();
        long positionMillis = player.getCurrentPosition();
        JSArray audioTracks = buildAudioTracks();
        String tracksSignature = audioTracks.toString();
        boolean statusChanged = !status.equals(lastPushedStatus);
        boolean positionChanged = Math.abs(positionMillis - lastPushedPositionMillis) >= 200;
        boolean tracksChanged = !tracksSignature.equals(lastPushedTracksSignature);

        if (!statusChanged && !positionChanged && !tracksChanged) {
            return;
        }

        lastPushedStatus = status;
        lastPushedPositionMillis = positionMillis;
        lastPushedTracksSignature = tracksSignature;

        long durationMillis = player.getDuration();
        JSObject snapshot = new JSObject();
        snapshot.put("id", sessionId);
        snapshot.put("status", status);
        snapshot.put("positionSeconds", positionMillis / 1000.0);
        snapshot.put(
                "durationSeconds",
                durationMillis == C.TIME_UNSET
                        ? JSObject.NULL
                        : durationMillis / 1000.0);
        snapshot.put("volume", player.getVolume());
        snapshot.put("isLive", isLive);
        snapshot.put("audioTracks", audioTracks);
        snapshot.put("selectedAudioTrackId", selectedAudioTrackId(audioTracks));
        // Epoch millis, not an ISO string: java.time.Instant needs API 26+
        // (this app's minSdk is 24, and core library desugaring isn't
        // enabled), and a plain number is all the JS side needs to compare
        // recency between snapshots.
        snapshot.put("updatedAt", System.currentTimeMillis());
        if (lastError != null) {
            snapshot.put("error", lastError);
        }

        notifyListeners(EVENT_STATUS, snapshot, false);
    }

    /**
     * The audio tracks, flattened across groups and numbered by their position
     * in that flattening.
     *
     * ExoPlayer identifies a track by (group, index within group), which is
     * two numbers; the shared controls contract carries one. The flattening
     * order is stable for a given media item — it comes from the container —
     * so the ordinal round-trips reliably, and {@link #applyAudioTrack} walks
     * the identical loop to turn it back into a group and index. Any change to
     * one loop must be mirrored in the other.
     */
    private JSArray buildAudioTracks() {
        JSArray tracks = new JSArray();
        if (player == null) {
            return tracks;
        }

        int id = 0;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO) {
                continue;
            }
            for (int i = 0; i < group.length; i++) {
                JSObject track = new JSObject();
                track.put("id", id);
                track.put("label", audioTrackLabel(group.getTrackFormat(i), id));
                track.put("selected", group.isTrackSelected(i));
                tracks.put(track);
                id++;
            }
        }
        return tracks;
    }

    /**
     * Display name for one audio track. Providers rarely fill in a title, so
     * the language is what users actually pick by — a MULTI release is a list
     * of dubs. Falls back to a bare ordinal rather than a codec name: knowing
     * a track is AC3 does not help anyone choose it.
     */
    private String audioTrackLabel(Format format, int ordinal) {
        if (format.label != null && !format.label.trim().isEmpty()) {
            return format.label;
        }

        String language = format.language;
        if (language != null && !language.isEmpty() && !"und".equals(language)) {
            String display = Locale.forLanguageTag(language).getDisplayLanguage();
            if (!display.isEmpty()) {
                // Locale returns the tag unchanged when it cannot resolve it.
                return display.equals(language)
                        ? language.toUpperCase(Locale.ROOT)
                        : display;
            }
        }
        return "Audio " + (ordinal + 1);
    }

    private Object selectedAudioTrackId(JSArray tracks) {
        for (int i = 0; i < tracks.length(); i++) {
            JSObject track = (JSObject) tracks.opt(i);
            if (track != null && track.optBoolean("selected", false)) {
                return track.optInt("id", i);
            }
        }
        return JSObject.NULL;
    }

    @PluginMethod
    public void setAudioTrack(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (isCurrentSession(call) && player != null) {
                applyAudioTrack(call.getInt("trackId", -1));
            }
            call.resolve();
        });
    }

    /** Mirrors {@link #buildAudioTracks}' flattening; see its doc comment. */
    private void applyAudioTrack(int wantedId) {
        int id = 0;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != C.TRACK_TYPE_AUDIO) {
                continue;
            }
            for (int i = 0; i < group.length; i++) {
                if (id == wantedId) {
                    player.setTrackSelectionParameters(
                            player.getTrackSelectionParameters()
                                    .buildUpon()
                                    .setOverrideForType(
                                            new TrackSelectionOverride(
                                                    group.getMediaTrackGroup(), i))
                                    .build());
                    return;
                }
                id++;
            }
        }
    }

    private String currentStatus() {
        if (player == null) {
            return "idle";
        }
        if (lastError != null) {
            return "error";
        }
        switch (player.getPlaybackState()) {
            case Player.STATE_BUFFERING:
                return "loading";
            case Player.STATE_ENDED:
                return "ended";
            case Player.STATE_READY:
                return player.isPlaying() ? "playing" : "paused";
            case Player.STATE_IDLE:
            default:
                return "idle";
        }
    }

    private boolean isCurrentSession(PluginCall call) {
        String id = call.getString("id");
        return sessionId != null && sessionId.equals(id);
    }

    private static NativePlayerViewBounds.Bounds boundsFromCall(JSObject boundsJson, double devicePixelRatio) {
        double x = boundsJson != null ? boundsJson.optDouble("x", 0) : 0;
        double y = boundsJson != null ? boundsJson.optDouble("y", 0) : 0;
        double width = boundsJson != null ? boundsJson.optDouble("width", 1) : 1;
        double height = boundsJson != null ? boundsJson.optDouble("height", 1) : 1;
        return NativePlayerViewBounds.toDevicePixels(x, y, width, height, devicePixelRatio);
    }

    /**
     * Xtream/Stalker live URLs routinely carry no file extension at all —
     * the case this whole feature exists to fix, since the WebView's own
     * mpegts.js already treats that shape as raw MPEG-TS. Without an
     * explicit MIME hint here, ExoPlayer's extension/content sniffing is
     * unreliable for exactly that shape, so extensionless defaults to TS
     * rather than being left to guess.
     *
     * A {@code content://} URI (downloaded-file playback, see
     * AndroidDownloadsPlugin) breaks that same extensionless heuristic in the
     * other direction: its last path segment is normally a bare numeric row
     * id, which would default to MPEG-TS for what is actually an MP4/MKV
     * file. The ContentResolver already knows the real type — it is asked
     * first, before any extension guessing, and only for this scheme; http(s)
     * URLs never reach it.
     */
    private static String resolveMimeType(String hint, String url, Context context) {
        String normalizedHint = hint != null ? hint.toLowerCase(Locale.US) : null;
        if (normalizedHint != null) {
            if (normalizedHint.contains("mpegurl") || normalizedHint.contains("m3u8")) {
                return MimeTypes.APPLICATION_M3U8;
            }
            if (normalizedHint.contains("mp2t") || normalizedHint.contains("mpeg-ts")) {
                return MimeTypes.VIDEO_MP2T;
            }
        }

        Uri uri = Uri.parse(url);
        if ("content".equals(uri.getScheme())) {
            ContentResolver resolver = context.getContentResolver();
            String contentType = resolver.getType(uri);
            if (!TextUtils.isEmpty(contentType)) {
                return contentType;
            }
        }

        String path = url.toLowerCase(Locale.US).split("\\?")[0];
        if (path.endsWith(".m3u8")) {
            return MimeTypes.APPLICATION_M3U8;
        }
        if (path.endsWith(".ts")) {
            return MimeTypes.VIDEO_MP2T;
        }
        int lastSlash = path.lastIndexOf('/');
        String lastSegment = lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
        if (!lastSegment.contains(".")) {
            return MimeTypes.VIDEO_MP2T;
        }

        return null;
    }

    private static Map<String, String> toStringMap(JSObject json) {
        Map<String, String> map = new HashMap<>();
        if (json == null) {
            return map;
        }

        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            String value = json.optString(key, null);
            if (value != null) {
                map.put(key, value);
            }
        }
        return map;
    }
}
