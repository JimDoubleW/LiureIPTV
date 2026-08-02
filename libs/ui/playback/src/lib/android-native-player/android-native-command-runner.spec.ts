import { signal } from '@angular/core';
import { AndroidNativePlayerSnapshot } from '@iptvnator/shared/interfaces';
import { AndroidNativeCommandRunner } from './android-native-command-runner';
import { AndroidNativePlayerPlugin } from './android-native-player.plugin';

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

function createPluginMock(): jest.Mocked<AndroidNativePlayerPlugin> {
    return {
        create: jest.fn(),
        load: jest.fn(),
        play: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn().mockResolvedValue(undefined),
        seek: jest.fn().mockResolvedValue(undefined),
        setVolume: jest.fn().mockResolvedValue(undefined),
        setBounds: jest.fn(),
        dispose: jest.fn(),
        addListener: jest.fn(),
    } as unknown as jest.Mocked<AndroidNativePlayerPlugin>;
}

describe('AndroidNativeCommandRunner', () => {
    const sessionId = signal<string | null>('session-1');
    const snapshot = signal<AndroidNativePlayerSnapshot | null>(
        createSnapshot()
    );
    let plugin: jest.Mocked<AndroidNativePlayerPlugin>;
    let runner: AndroidNativeCommandRunner;

    beforeEach(() => {
        sessionId.set('session-1');
        snapshot.set(createSnapshot());
        plugin = createPluginMock();
        runner = new AndroidNativeCommandRunner(plugin, {
            sessionId,
            snapshot,
        });
    });

    it('togglePaused calls pause while playing and play while paused', async () => {
        await runner.togglePaused();
        expect(plugin.pause).toHaveBeenCalledWith({ id: 'session-1' });

        snapshot.set(createSnapshot({ status: 'paused' }));
        await runner.togglePaused();
        expect(plugin.play).toHaveBeenCalledWith({ id: 'session-1' });
    });

    it('seekTo clamps negative values to zero', async () => {
        await runner.seekTo(-5);
        expect(plugin.seek).toHaveBeenCalledWith({
            id: 'session-1',
            positionSeconds: 0,
        });
    });

    it('seekBy clamps to zero, reports it ran, and uses the current position', async () => {
        expect(await runner.seekBy(-999)).toBe(true);
        expect(plugin.seek).toHaveBeenCalledWith({
            id: 'session-1',
            positionSeconds: 0,
        });

        expect(await runner.seekBy(15)).toBe(true);
        expect(plugin.seek).toHaveBeenLastCalledWith({
            id: 'session-1',
            positionSeconds: 25,
        });
    });

    it('applyVolume delegates to the plugin', async () => {
        await runner.applyVolume(0.3);
        expect(plugin.setVolume).toHaveBeenCalledWith({
            id: 'session-1',
            volume: 0.3,
        });
    });

    it('no-ops every command when there is no current session id', async () => {
        sessionId.set(null);

        await runner.togglePaused();
        expect(await runner.seekBy(10)).toBe(false);
        await runner.seekTo(5);
        await runner.applyVolume(0.5);

        expect(plugin.pause).not.toHaveBeenCalled();
        expect(plugin.play).not.toHaveBeenCalled();
        expect(plugin.seek).not.toHaveBeenCalled();
        expect(plugin.setVolume).not.toHaveBeenCalled();
    });

    it('no-ops togglePaused and seekBy when the snapshot is missing', async () => {
        snapshot.set(null);

        await runner.togglePaused();
        expect(await runner.seekBy(10)).toBe(false);

        expect(plugin.pause).not.toHaveBeenCalled();
        expect(plugin.play).not.toHaveBeenCalled();
        expect(plugin.seek).not.toHaveBeenCalled();
    });

    it('swallows a rejected plugin call instead of throwing', async () => {
        plugin.seek.mockRejectedValueOnce(new Error('session disposed'));

        await expect(runner.seekTo(30)).resolves.toBeUndefined();
    });
});
