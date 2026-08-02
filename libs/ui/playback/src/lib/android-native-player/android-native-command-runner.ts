import { Signal, WritableSignal } from '@angular/core';
import { AndroidNativePlayerSnapshot } from '@iptvnator/shared/interfaces';
import { AndroidNativePlayerPlugin } from './android-native-player.plugin';

/**
 * Context the {@link AndroidNativeCommandRunner} reads. The controller owns
 * the signals; the runner only delegates to the plugin.
 */
export interface AndroidNativeCommandContext {
    readonly sessionId: Signal<string | null>;
    readonly snapshot: WritableSignal<AndroidNativePlayerSnapshot | null>;
}

/**
 * Thin plugin delegators for transport commands. Split out of the
 * controller so each stays a one-liner around `guard`, which swallows races
 * where the session was torn down mid-call (the next status push resyncs
 * state) — mirrors EmbeddedMpvCommandRunner's guardIpc.
 */
export class AndroidNativeCommandRunner {
    constructor(
        private readonly plugin: AndroidNativePlayerPlugin,
        private readonly ctx: AndroidNativeCommandContext
    ) {}

    async togglePaused(): Promise<void> {
        const id = this.ctx.sessionId();
        const snapshot = this.ctx.snapshot();
        if (!id || !snapshot) {
            return;
        }
        await this.guard(() =>
            snapshot.status === 'playing'
                ? this.plugin.pause({ id })
                : this.plugin.play({ id })
        );
    }

    async seekTo(seconds: number): Promise<void> {
        const id = this.ctx.sessionId();
        if (!id) {
            return;
        }
        await this.guard(() =>
            this.plugin.seek({ id, positionSeconds: Math.max(0, seconds) })
        );
    }

    async seekBy(deltaSeconds: number): Promise<boolean> {
        const id = this.ctx.sessionId();
        const snapshot = this.ctx.snapshot();
        if (!id || !snapshot) {
            return false;
        }
        const next = Math.max(0, snapshot.positionSeconds + deltaSeconds);
        await this.guard(() => this.plugin.seek({ id, positionSeconds: next }));
        return true;
    }

    async applyVolume(value: number): Promise<void> {
        const id = this.ctx.sessionId();
        if (!id) {
            return;
        }
        await this.guard(() => this.plugin.setVolume({ id, volume: value }));
    }

    async setAudioTrack(trackId: number): Promise<void> {
        const id = this.ctx.sessionId();
        if (!id) {
            return;
        }
        await this.guard(() => this.plugin.setAudioTrack({ id, trackId }));
    }

    /**
     * Errors are intentionally swallowed: the session may have been torn
     * down, or the native side may have thrown, between the command
     * dispatching and resolving — the next status push resyncs state.
     */
    private async guard(call: () => Promise<void>): Promise<void> {
        try {
            await call();
        } catch {
            // Deliberately empty — see doc comment above.
        }
    }
}
