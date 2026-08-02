import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StorageMap } from '@ngx-pwa/local-storage';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import type { WebPlayerViewComponent as WebPlayerViewComponentInstance } from './web-player-view.component';

// video.js fails to evaluate under the ESM test runner, and importing the
// player view pulls it in transitively. These tests never render a player —
// they only read which one was selected — so a bare stub is enough.
jest.unstable_mockModule('video.js', () => ({ default: jest.fn() }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));

/**
 * Which engine a host gets on Android.
 *
 * This lived in each host as a copied `playerOverride` computed, and the
 * VOD/series host never got a copy — so movies silently kept using the
 * WebView engines that cannot decode 4K on this hardware (audio, no picture),
 * which is the entire reason the native engine exists. The decision now has
 * one home, and these cases pin the two rules that make it safe to centralise:
 * an explicit override still wins (that is how DASH stays on Shaka), and a
 * non-Android runtime is untouched.
 */
describe('WebPlayerViewComponent Android engine selection', () => {
    let WebPlayerViewComponent: typeof import('./web-player-view.component').WebPlayerViewComponent;
    let fixture: ComponentFixture<WebPlayerViewComponentInstance>;
    let component: WebPlayerViewComponentInstance;
    let runtimeCapabilities: {
        supportsManagedExternalPlayers: boolean;
        isAndroid: boolean;
    };

    const storageMap = {
        get: jest.fn(() => of({ player: VideoPlayer.VideoJs })),
    };

    beforeAll(async () => {
        ({ WebPlayerViewComponent } =
            await import('./web-player-view.component'));
    });

    async function createWith(options: {
        isAndroid: boolean;
        streamUrl: string;
        override?: VideoPlayer | null;
    }) {
        runtimeCapabilities = {
            supportsManagedExternalPlayers: false,
            isAndroid: options.isAndroid,
        };

        await TestBed.configureTestingModule({
            imports: [WebPlayerViewComponent, TranslateModule.forRoot()],
            providers: [
                { provide: StorageMap, useValue: storageMap },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(WebPlayerViewComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('streamUrl', options.streamUrl);
        fixture.componentRef.setInput('title', 'Example');
        if (options.override !== undefined) {
            fixture.componentRef.setInput('playerOverride', options.override);
        }
    }

    afterEach(() => {
        fixture?.destroy();
        TestBed.resetTestingModule();
    });

    it('uses the native engine on Android when no host asks for anything', async () => {
        // The VOD/series case: PortalInlinePlayerComponent passes no override.
        await createWith({
            isAndroid: true,
            streamUrl: 'https://example.test/movie/1001.mkv',
        });

        expect(component.selectedPlayer()).toBe(VideoPlayer.AndroidNative);
    });

    it('lets an explicit override win, which is what keeps DASH on Shaka', async () => {
        await createWith({
            isAndroid: true,
            streamUrl: 'https://example.test/channel/1.mpd',
            override: VideoPlayer.Html5Player,
        });

        expect(component.selectedPlayer()).toBe(VideoPlayer.Html5Player);
    });

    it('never sends a .mpd URL to the native engine, which has no ClearKey', async () => {
        await createWith({
            isAndroid: true,
            streamUrl: 'https://example.test/channel/1.mpd',
        });

        expect(component.selectedPlayer()).not.toBe(VideoPlayer.AndroidNative);
    });

    it('leaves every other platform on the stored setting', async () => {
        await createWith({
            isAndroid: false,
            streamUrl: 'https://example.test/movie/1001.mkv',
        });

        expect(component.selectedPlayer()).toBe(VideoPlayer.VideoJs);
    });
});
