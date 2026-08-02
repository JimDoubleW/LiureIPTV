import { TestBed } from '@angular/core/testing';
import {
    AndroidNativePlayerSnapshot,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    ANDROID_NATIVE_PLAYER_PLUGIN,
    AndroidNativePlayerPlugin,
} from './android-native-player.plugin';
import { AndroidNativeSessionController } from './android-native-session-controller';

describe('AndroidNativeSessionController', () => {
    let plugin: jest.Mocked<AndroidNativePlayerPlugin>;
    let statusListener: ((snapshot: AndroidNativePlayerSnapshot) => void) | null;
    let unsubscribeStatus: jest.Mock;
    let testingModuleDestroyed: boolean;

    beforeEach(() => {
        testingModuleDestroyed = false;
        statusListener = null;
        unsubscribeStatus = jest.fn();

        plugin = {
            create: jest.fn().mockResolvedValue({ id: 'session-1' }),
            load: jest.fn().mockResolvedValue(undefined),
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn().mockResolvedValue(undefined),
            seek: jest
                .fn()
                .mockResolvedValue(undefined) as jest.Mock,
            setVolume: jest.fn().mockResolvedValue(undefined),
            setBounds: jest.fn().mockResolvedValue(undefined),
            dispose: jest.fn().mockResolvedValue(undefined),
            addListener: jest.fn((eventName, callback) => {
                statusListener = callback;
                return Promise.resolve({ remove: unsubscribeStatus });
            }),
        } as unknown as jest.Mocked<AndroidNativePlayerPlugin>;

        Object.defineProperty(window, 'devicePixelRatio', {
            configurable: true,
            value: 1,
        });
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: class MockResizeObserver {
                observe = jest.fn();
                disconnect = jest.fn();
            },
        });
        Object.defineProperty(window, 'requestAnimationFrame', {
            configurable: true,
            value: (callback: FrameRequestCallback) =>
                window.setTimeout(() => callback(0), 0),
        });
        Object.defineProperty(window, 'cancelAnimationFrame', {
            configurable: true,
            value: (handle: number) => window.clearTimeout(handle),
        });

        TestBed.configureTestingModule({
            providers: [
                AndroidNativeSessionController,
                { provide: ANDROID_NATIVE_PLAYER_PLUGIN, useValue: plugin },
            ],
        });
    });

    afterEach(() => {
        if (!testingModuleDestroyed) {
            TestBed.resetTestingModule();
        }
        jest.restoreAllMocks();
    });

    function destroyTestingModule(): void {
        TestBed.resetTestingModule();
        testingModuleDestroyed = true;
    }

    it('subscribes to status updates and unsubscribes on destroy', async () => {
        TestBed.inject(AndroidNativeSessionController);

        await waitFor(() => plugin.addListener.mock.calls.length > 0, 'listener to register');
        expect(plugin.addListener).toHaveBeenCalledWith(
            'nativePlayerStatus',
            expect.any(Function)
        );

        destroyTestingModule();
        await waitFor(() => unsubscribeStatus.mock.calls.length > 0, 'unsubscribe to run');
    });

    it('starts a session, forwards matching status updates, and disposes on teardown', async () => {
        const controller = TestBed.inject(AndroidNativeSessionController);
        const host = createHost();
        const playback = createPlayback();

        const teardown = controller.startSession(host, playback, 0.7);
        expect(controller.snapshot()).toEqual(
            expect.objectContaining({ id: '', status: 'loading', volume: 0.7 })
        );

        await waitFor(
            () => controller.sessionId() === 'session-1',
            'session to start'
        );

        // Fractional CSS edges stay unrounded: the native side rounds once,
        // after converting to device pixels.
        expect(plugin.create).toHaveBeenCalledWith({
            bounds: { x: 10.6, y: 20.5, width: 640, height: 360 },
            devicePixelRatio: 1,
            title: 'Example Movie',
            volume: 0.7,
        });
        expect(plugin.load).toHaveBeenCalledWith({
            id: 'session-1',
            url: playback.streamUrl,
            isLive: playback.isLive,
            startSeconds: playback.startTime,
            headers: playback.headers,
            userAgent: playback.userAgent,
        });
        expect(controller.sessionId()).toBe('session-1');

        await waitFor(() => statusListener !== null, 'status listener to be ready');
        statusListener?.(createSnapshot({ id: 'other-session', status: 'paused' }));
        expect(controller.snapshot()?.status).toBe('loading');

        statusListener?.(createSnapshot({ id: 'session-1', status: 'paused' }));
        expect(controller.snapshot()?.status).toBe('paused');

        teardown();

        expect(controller.snapshot()).toBeNull();
        expect(controller.sessionId()).toBeNull();
        await waitFor(
            () => plugin.dispose.mock.calls.length > 0,
            'session disposal to finish'
        );
        expect(plugin.pause).toHaveBeenCalledWith({ id: 'session-1' });
        expect(plugin.dispose).toHaveBeenCalledWith({ id: 'session-1' });
        expect(plugin.pause.mock.invocationCallOrder[0]).toBeLessThan(
            plugin.dispose.mock.invocationCallOrder[0]
        );
    });

    it('sets an error snapshot when the plugin cannot create a session', async () => {
        plugin.create.mockRejectedValueOnce(new Error('no decoder available'));
        const controller = TestBed.inject(AndroidNativeSessionController);

        controller.startSession(createHost(), createPlayback(), 0.5);
        await waitFor(
            () => controller.snapshot()?.status === 'error',
            'error snapshot to be set'
        );

        expect(controller.snapshot()).toEqual(
            expect.objectContaining({
                id: '',
                status: 'error',
                error: 'no decoder available',
            })
        );
        expect(controller.sessionId()).toBeNull();
    });

    it('ignores a late startup rejection after teardown so it cannot clobber a newer session', async () => {
        let rejectCreate: ((error: Error) => void) | null = null;
        plugin.create.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectCreate = reject;
                })
        );
        const controller = TestBed.inject(AndroidNativeSessionController);

        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );
        await waitFor(() => rejectCreate !== null, 'startup to reach create()');
        teardown();

        // A newer session replaces the torn-down one (fast channel zapping).
        controller.sessionId.set('session-2');
        controller.snapshot.set(createSnapshot({ id: 'session-2' }));

        rejectCreate?.(new Error('no decoder available'));
        await new Promise((resolve) => window.setTimeout(resolve, 0));

        expect(controller.sessionId()).toBe('session-2');
        expect(controller.snapshot()?.id).toBe('session-2');
    });

    it('disposes a session created after teardown instead of leaking it', async () => {
        let resolveCreate: ((value: { id: string }) => void) | null = null;
        plugin.create.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveCreate = resolve;
                })
        );
        const controller = TestBed.inject(AndroidNativeSessionController);

        const teardown = controller.startSession(
            createHost(),
            createPlayback(),
            0.5
        );
        teardown();
        resolveCreate?.({ id: 'session-1' });
        await waitFor(
            () => plugin.dispose.mock.calls.length > 0,
            'the late session to be disposed'
        );

        expect(plugin.dispose).toHaveBeenCalledWith({ id: 'session-1' });
        expect(plugin.load).not.toHaveBeenCalled();
    });

    it('forwards transport commands and swallows a rejected call', async () => {
        const controller = TestBed.inject(AndroidNativeSessionController);
        controller.sessionId.set('session-1');
        controller.snapshot.set(
            createSnapshot({ id: 'session-1', status: 'playing' })
        );

        await controller.togglePaused();
        expect(plugin.pause).toHaveBeenCalledWith({ id: 'session-1' });

        await controller.seekBy(-30);
        expect(plugin.seek).toHaveBeenCalledWith({
            id: 'session-1',
            positionSeconds: 0,
        });

        plugin.setVolume.mockRejectedValueOnce(new Error('session disposed'));
        await expect(controller.applyVolume(0.25)).resolves.toBeUndefined();
    });

    it('re-syncs bounds on resize, and on a devicePixelRatio change via matchMedia', async () => {
        let dprMediaQueryList: {
            addEventListener: jest.Mock;
            removeEventListener: jest.Mock;
        };
        const matchMediaCalls: string[] = [];
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: jest.fn((query: string) => {
                matchMediaCalls.push(query);
                dprMediaQueryList = {
                    addEventListener: jest.fn(),
                    removeEventListener: jest.fn(),
                };
                return dprMediaQueryList;
            }),
        });

        const controller = TestBed.inject(AndroidNativeSessionController);
        const host = createHost();
        controller.startSession(host, createPlayback(), 0.5);
        await waitFor(
            () => controller.sessionId() === 'session-1',
            'session to start'
        );
        plugin.setBounds.mockClear();

        window.dispatchEvent(new Event('resize'));
        await waitFor(
            () => plugin.setBounds.mock.calls.length > 0,
            'bounds to re-sync on resize'
        );
        expect(plugin.setBounds).toHaveBeenCalledWith({
            id: 'session-1',
            bounds: { x: 10.6, y: 20.5, width: 640, height: 360 },
            devicePixelRatio: 1,
        });
        expect(matchMediaCalls[0]).toBe('(resolution: 1dppx)');
    });
});

function createHost(): HTMLElement {
    return {
        getBoundingClientRect: () => ({
            left: 10.6,
            top: 20.5,
            width: 640,
            height: 360,
        }),
    } as HTMLElement;
}

function createPlayback(): ResolvedPortalPlayback {
    return {
        streamUrl: 'https://example.com/movie.mp4',
        title: 'Example Movie',
    };
}

function createSnapshot(
    overrides: Partial<AndroidNativePlayerSnapshot> = {}
): AndroidNativePlayerSnapshot {
    return {
        id: 'session-1',
        status: 'playing',
        positionSeconds: 10,
        durationSeconds: 120,
        volume: 0.7,
        isLive: false,
        updatedAt: 1_700_000_000_000,
        ...overrides,
    };
}

async function waitFor(
    condition: () => boolean,
    description: string
): Promise<void> {
    const deadline = Date.now() + 1_000;

    while (Date.now() < deadline) {
        if (condition()) {
            return;
        }
        await Promise.resolve();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
    }

    throw new Error(`Timed out waiting for ${description}`);
}
