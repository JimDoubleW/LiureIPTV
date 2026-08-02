import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { AndroidNativePlayerComponent } from './android-native-player.component';
import {
    ANDROID_NATIVE_PLAYER_PLUGIN,
    AndroidNativePlayerPlugin,
} from './android-native-player.plugin';

/**
 * Native video is composited BEHIND the WebView, so it is only visible
 * through pixels the DOM leaves fully transparent. Losing this class means
 * the workspace shell paints over the player's rect and playback regresses
 * to the original defect: audio plays, picture never appears, and every
 * native-side signal (decoder, buffers, SurfaceFlinger composition) still
 * looks correct — which is why it cost a long debugging session the first
 * time. See `workspace-shell.component.scss` for the rules it drives.
 *
 * Deliberately a literal rather than an import of
 * `NATIVE_VIDEO_PUNCH_THROUGH_CLASS`: the SCSS consumer cannot import it
 * either, so a rename must fail here instead of passing silently on both
 * sides while the stylesheet stops matching.
 */
const PUNCH_THROUGH_CLASS = 'native-video-punchthrough';

@Component({
    imports: [AndroidNativePlayerComponent],
    template: `<app-android-native-player [playback]="playback" />`,
})
class HostComponent {
    playback: ResolvedPortalPlayback = {
        streamUrl: 'https://example.test/live/1.ts',
        title: 'Example Channel',
        isLive: true,
    };
}

describe('AndroidNativePlayerComponent punch-through', () => {
    let fixture: ComponentFixture<HostComponent>;

    beforeEach(async () => {
        const plugin = {
            create: jest.fn().mockResolvedValue({ id: 'session-1' }),
            load: jest.fn().mockResolvedValue(undefined),
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn().mockResolvedValue(undefined),
            seek: jest.fn().mockResolvedValue(undefined),
            setVolume: jest.fn().mockResolvedValue(undefined),
            setBounds: jest.fn().mockResolvedValue(undefined),
            dispose: jest.fn().mockResolvedValue(undefined),
            addListener: jest
                .fn()
                .mockResolvedValue({ remove: jest.fn() }),
        } as unknown as jest.Mocked<AndroidNativePlayerPlugin>;

        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: class {
                observe = jest.fn();
                disconnect = jest.fn();
            },
        });

        await TestBed.configureTestingModule({
            imports: [HostComponent, TranslateModule.forRoot()],
            providers: [
                { provide: ANDROID_NATIVE_PLAYER_PLUGIN, useValue: plugin },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(HostComponent);
    });

    afterEach(() => {
        document.documentElement.classList.remove(PUNCH_THROUGH_CLASS);
    });

    it('marks the document while a native session is active', () => {
        expect(
            document.documentElement.classList.contains(PUNCH_THROUGH_CLASS)
        ).toBe(false);

        fixture.detectChanges();

        expect(
            document.documentElement.classList.contains(PUNCH_THROUGH_CLASS)
        ).toBe(true);
    });

    it('restores the app background when the session tears down', () => {
        fixture.detectChanges();
        fixture.destroy();

        // The class makes the whole app's own backgrounds transparent, so
        // leaving it on after teardown would show the black Android window
        // everywhere instead of the theme.
        expect(
            document.documentElement.classList.contains(PUNCH_THROUGH_CLASS)
        ).toBe(false);
    });
});
