import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
    AndroidNativePlayerSnapshot,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DEFAULT_PLAYER_CAPABILITIES } from '../player-controls/player-controls-defaults';
import { AndroidNativeControlsAdapter } from './android-native-controls.adapter';
import { AndroidNativeSessionController } from './android-native-session-controller';

const LIVE_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/live',
    title: 'Live news',
};

const VOD_PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://example.com/movie',
    title: 'Movie',
    contentInfo: {
        contentXtreamId: 42,
        contentType: 'vod',
        playlistId: 'playlist-1',
    },
};

function snapshot(
    overrides: Partial<AndroidNativePlayerSnapshot> = {}
): AndroidNativePlayerSnapshot {
    return {
        id: 'session-1',
        status: 'playing',
        positionSeconds: 25,
        durationSeconds: 100,
        volume: 0.65,
        isLive: false,
        audioTracks: [],
        selectedAudioTrackId: null,
        updatedAt: 1_700_000_000_000,
        ...overrides,
    };
}

function createController() {
    return {
        snapshot: signal<AndroidNativePlayerSnapshot | null>(snapshot()),
        togglePaused: jest
            .fn<Promise<void>, []>()
            .mockResolvedValue(undefined),
        seekTo: jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined),
        seekBy: jest.fn<Promise<boolean>, [number]>().mockResolvedValue(true),
        applyVolume: jest
            .fn<Promise<void>, [number]>()
            .mockResolvedValue(undefined),
        setAudioTrack: jest
            .fn<Promise<void>, [number]>()
            .mockResolvedValue(undefined),
    };
}

function translations(): object {
    return {
        ANDROID_NATIVE_PLAYER: {
            LOADING_STREAM: 'Loading stream',
            PLAYBACK_FAILED: 'Playback failed',
        },
    };
}

describe('AndroidNativeControlsAdapter', () => {
    let adapter: AndroidNativeControlsAdapter;
    let controller: ReturnType<typeof createController>;
    let playback: WritableSignal<ResolvedPortalPlayback>;

    beforeEach(() => {
        localStorage.clear();
        controller = createController();
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                AndroidNativeControlsAdapter,
                {
                    provide: AndroidNativeSessionController,
                    useValue: controller,
                },
            ],
        });

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', translations());
        translate.setDefaultLang('en');
        translate.use('en');

        adapter = TestBed.inject(AndroidNativeControlsAdapter);
        playback = signal(VOD_PLAYBACK);
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        localStorage.clear();
    });

    function configure(): void {
        adapter.configure({ playback });
    }

    it('reports all-false capabilities before configure() is called', () => {
        expect(adapter.capabilities()).toEqual(DEFAULT_PLAYER_CAPABILITIES);
    });

    it('reports seek/volume/fullscreen for VOD and never speed/aspect/recording/PiP', () => {
        configure();

        expect(adapter.capabilities()).toEqual({
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: true,
            volume: true,
            fullscreen: true,
        });
    });

    it('reports seek false for live playback', () => {
        playback.set(LIVE_PLAYBACK);
        configure();

        expect(adapter.capabilities().seek).toBe(false);
    });

    it('derives isLive from contentInfo when the playback flag is absent', () => {
        configure();
        expect(adapter.state().isLive).toBe(false);

        playback.set(LIVE_PLAYBACK);
        expect(adapter.state().isLive).toBe(true);
    });

    it('maps the snapshot into state, clamping negative positions to zero', () => {
        configure();
        controller.snapshot.set(snapshot({ positionSeconds: -5 }));

        const state = adapter.state();
        expect(state.status).toBe('playing');
        expect(state.positionSeconds).toBe(0);
        expect(state.durationSeconds).toBe(100);
        expect(state.canSeek).toBe(true);
        expect(state.volume).toBe(0.65);
    });

    it('reports null duration and canSeek=false for live playback even with a durationSeconds snapshot', () => {
        playback.set(LIVE_PLAYBACK);
        configure();
        controller.snapshot.set(snapshot({ isLive: true, durationSeconds: 100 }));

        const state = adapter.state();
        expect(state.durationSeconds).toBeNull();
        expect(state.canSeek).toBe(false);
    });

    it('shows a translated loading message before the first snapshot arrives', () => {
        controller.snapshot.set(null);
        configure();

        expect(adapter.state().status).toBe('loading');
        expect(adapter.state().statusMessage).toBe('Loading stream');
    });

    it('shows the snapshot error verbatim when present', () => {
        configure();
        controller.snapshot.set(
            snapshot({ status: 'error', error: 'Source unreachable' })
        );

        expect(adapter.state().statusMessage).toBe('Source unreachable');
    });

    it('falls back to a translated generic message when the native side reports no error text', () => {
        configure();
        controller.snapshot.set(snapshot({ status: 'error', error: undefined }));

        expect(adapter.state().statusMessage).toBe('Playback failed');
    });

    it('falls back to stored volume when there is no snapshot yet', () => {
        localStorage.setItem('volume', '0.4');
        controller.snapshot.set(null);
        configure();

        expect(adapter.state().volume).toBe(0.4);
    });

    it('delegates transport commands to the controller', () => {
        configure();

        adapter.commands.togglePlay();
        expect(controller.togglePaused).toHaveBeenCalledTimes(1);

        adapter.commands.seekTo(30);
        expect(controller.seekTo).toHaveBeenCalledWith(30);

        adapter.commands.seekBy(-10);
        expect(controller.seekBy).toHaveBeenCalledWith(-10);

        adapter.commands.setVolume(0.2);
        expect(controller.applyVolume).toHaveBeenCalledWith(0.2);
    });

    it('offers no audio-track picker for a single track, which is not a choice', () => {
        configure();
        controller.snapshot.set(
            snapshot({
                audioTracks: [{ id: 0, label: 'French', selected: true }],
                selectedAudioTrackId: 0,
            })
        );

        expect(adapter.capabilities().audioTracks).toBe(false);
    });

    it('exposes the dub picker once the container reports more than one track', () => {
        // The list is empty until the first samples are read, so this arrives
        // well after playback starts rather than with the first snapshot.
        configure();
        controller.snapshot.set(
            snapshot({
                audioTracks: [
                    { id: 0, label: 'French', selected: false },
                    { id: 1, label: 'English', selected: true },
                ],
                selectedAudioTrackId: 1,
            })
        );

        expect(adapter.capabilities().audioTracks).toBe(true);
        expect(adapter.state().audioTracks).toEqual([
            { id: 0, label: 'French', selected: false },
            { id: 1, label: 'English', selected: true },
        ]);
        expect(adapter.state().selectedAudioTrackId).toBe(1);
    });

    it('delegates an audio-track choice to the controller', () => {
        configure();

        adapter.commands.setAudioTrack(1);

        expect(controller.setAudioTrack).toHaveBeenCalledWith(1);
    });

    it('no-ops every phase-2+ command', () => {
        configure();

        expect(() => {
            adapter.commands.setSubtitleTrack(-1);
            adapter.commands.setPlaybackSpeed(1.5);
            adapter.commands.setAspectRatio('16:9');
            adapter.commands.toggleRecording();
            adapter.commands.togglePictureInPicture();
        }).not.toThrow();
    });
});
