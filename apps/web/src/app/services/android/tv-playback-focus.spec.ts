import {
    focusAfterContentActivation,
    focusPlaybackAfterChannelCollapse,
} from './tv-playback-focus';

function withRect(element: HTMLElement): HTMLElement {
    element.getBoundingClientRect = () =>
        ({
            top: 0,
            bottom: 40,
            left: 0,
            right: 40,
            width: 40,
            height: 40,
            x: 0,
            y: 0,
            toJSON: () => undefined,
        }) as DOMRect;
    return element;
}

describe('focusPlaybackAfterChannelCollapse', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    it('prefers the fullscreen toggle over an earlier enabled button', () => {
        // Traced on the reference box: play/pause stays disabled while the
        // stream is loading, so "the first enabled player button" landed on
        // volume instead — the visible focus ring sat on mute rather than on
        // the actual OK gesture (`activate()` enters fullscreen from anywhere
        // inside the player). The fullscreen toggle is enabled the instant the
        // player mounts, so it is the reliable target once no EPG row exists
        // yet to take priority.
        document.body.innerHTML = `
            <div class="sidebar sidebar-collapsed"></div>
            <app-player-controls>
                <button id="play" disabled>Play</button>
                <button id="volume" data-tv-volume>Volume</button>
                <button id="fullscreen" data-tv-fullscreen-toggle>
                    Fullscreen
                </button>
            </app-player-controls>
        `;
        for (const id of ['volume', 'fullscreen']) {
            withRect(document.getElementById(id) as HTMLElement);
        }

        const sidebar = document.querySelector('.sidebar') as HTMLElement;
        const applyFocus = jest.fn();

        focusPlaybackAfterChannelCollapse(sidebar, applyFocus);
        jest.runAllTimers();

        expect(applyFocus).toHaveBeenCalledWith(
            document.getElementById('fullscreen')
        );
    });

    it('still prefers the current EPG programme when it has rendered', () => {
        document.body.innerHTML = `
            <div class="sidebar sidebar-collapsed"></div>
            <app-epg-list-view>
                <app-epg-list-view-row id="row" class="playing">
                    Now playing
                </app-epg-list-view-row>
            </app-epg-list-view>
            <app-player-controls>
                <button id="fullscreen" data-tv-fullscreen-toggle>
                    Fullscreen
                </button>
            </app-player-controls>
        `;

        const sidebar = document.querySelector('.sidebar') as HTMLElement;
        const applyFocus = jest.fn();

        focusPlaybackAfterChannelCollapse(sidebar, applyFocus);
        jest.runAllTimers();

        expect(applyFocus).toHaveBeenCalledWith(
            document.getElementById('row')
        );
    });

    it('falls back to any enabled button when no fullscreen toggle exists', () => {
        // Radio and other players without a fullscreen capability must not be
        // left with no focus target at all.
        document.body.innerHTML = `
            <div class="sidebar sidebar-collapsed"></div>
            <app-player-controls>
                <button id="mute">Mute</button>
            </app-player-controls>
        `;
        withRect(document.getElementById('mute') as HTMLElement);

        const sidebar = document.querySelector('.sidebar') as HTMLElement;
        const applyFocus = jest.fn();

        focusPlaybackAfterChannelCollapse(sidebar, applyFocus);
        jest.runAllTimers();

        expect(applyFocus).toHaveBeenCalledWith(
            document.getElementById('mute')
        );
    });
});

describe('focusAfterContentActivation', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    it('prefers the fullscreen toggle when starting VOD from a hero Play button', () => {
        // Same reference-box finding as the live-channel case: play/pause is
        // disabled while the stream is loading, so landing on "the first
        // enabled button" put the focus ring on volume instead of the
        // fullscreen toggle that OK on the player actually activates.
        document.body.innerHTML = `
            <div id="hero" class="shell__hero" style="display: none">
                <button id="play">Play</button>
            </div>
            <app-player-controls>
                <button id="pause" disabled>Pause</button>
                <button id="volume">Volume</button>
                <button id="fullscreen" data-tv-fullscreen-toggle>
                    Fullscreen
                </button>
            </app-player-controls>
        `;
        withRect(document.getElementById('volume') as HTMLElement);
        withRect(document.getElementById('fullscreen') as HTMLElement);

        const hero = document.getElementById('hero') as HTMLElement;
        const applyFocus = jest.fn();

        focusAfterContentActivation(hero, applyFocus);
        jest.runAllTimers();

        expect(applyFocus).toHaveBeenCalledWith(
            document.getElementById('fullscreen')
        );
    });
});
