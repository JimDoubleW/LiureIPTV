import {
    enterFullscreen,
    exitFullscreen,
    handleFullscreenDirection,
    isActiveChannelRow,
    isInsidePlayer,
    TV_FULLSCREEN_ATTRIBUTE,
    zapAdjacent,
} from './player-keys';

function byId(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`missing test fixture #${id}`);
    }
    return element;
}

describe('player keys', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        document.documentElement.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
    });

    describe('layout fullscreen', () => {
        it('refuses to go fullscreen with nothing playing', () => {
            // An empty black overlay would look like a crash.
            expect(enterFullscreen()).toBe(false);
        });

        it('pins the player once a video exists, and releases it', () => {
            document.body.innerHTML =
                '<app-web-player-view><video></video></app-web-player-view>';

            expect(enterFullscreen()).toBe(true);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(true);

            expect(exitFullscreen()).toBe(true);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(false);
        });

        it('pins the player for the Android native engine, which has no <video>', () => {
            // ExoPlayer renders into a native SurfaceView composited behind
            // the WebView; the DOM holds only a bounds placeholder. Testing
            // for `video` alone made fullscreen permanently unreachable on
            // the very engine this port defaults to.
            document.body.innerHTML =
                '<app-web-player-view><app-android-native-player>' +
                '<div class="android-native-player__surface"></div>' +
                '</app-android-native-player></app-web-player-view>';

            expect(enterFullscreen()).toBe(true);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(true);
        });

        it('reports nothing to exit when not fullscreen', () => {
            // goBack uses this to fall through to the overlay/history branches.
            expect(exitFullscreen()).toBe(false);
        });

        it('owns every direction while fullscreen, including inert RIGHT', () => {
            document.body.innerHTML =
                '<app-web-player-view><video></video></app-web-player-view>';
            enterFullscreen();

            // RIGHT does nothing but must be swallowed, or the WebView acts.
            expect(handleFullscreenDirection('right')).toBe(true);
            // LEFT returns to the list layout.
            expect(handleFullscreenDirection('left')).toBe(true);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(false);
        });

        it('stays out of the way when not fullscreen', () => {
            expect(handleFullscreenDirection('up')).toBe(false);
        });
    });

    describe('recognising the two-step OK targets', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <div class="channel-list-item active"><span id="in-active">TF1</span></div>
                <div class="channel-list-item"><span id="in-idle">France 2</span></div>
                <app-web-player-view><button id="in-player">controls</button></app-web-player-view>
                <button id="elsewhere">Refine</button>
            `;
        });

        it('spots focus inside the tuned channel row', () => {
            expect(isActiveChannelRow(byId('in-active'))).toBe(true);
        });

        it('does not treat an idle channel row as the second step', () => {
            // OK there is the FIRST step: it tunes. Only the active row commits
            // to fullscreen.
            expect(isActiveChannelRow(byId('in-idle'))).toBe(false);
        });

        it('spots focus inside the player view', () => {
            expect(isInsidePlayer(byId('in-player'))).toBe(true);
            expect(isInsidePlayer(byId('elsewhere'))).toBe(false);
        });
    });

    describe('zapping', () => {
        let clicked: string[];

        beforeEach(() => {
            clicked = [];
            document.body.innerHTML = `
                <div class="channel-list-item" id="r0"></div>
                <div class="channel-list-item active" id="r1"></div>
                <div class="channel-list-item" id="r2"></div>
            `;
            for (const id of ['r0', 'r1', 'r2']) {
                byId(id).addEventListener('click', () => clicked.push(id));
            }
        });

        it('UP tunes the next channel — the row below, numbers ascend downward', () => {
            expect(zapAdjacent('up')).toBe(true);
            expect(clicked).toEqual(['r2']);
        });

        it('DOWN tunes the previous channel', () => {
            expect(zapAdjacent('down')).toBe(true);
            expect(clicked).toEqual(['r0']);
        });

        it('stops at the ends instead of wrapping', () => {
            byId('r1').classList.remove('active');
            byId('r2').classList.add('active');

            expect(zapAdjacent('up')).toBe(false);
            expect(clicked).toEqual([]);
        });

        it('does nothing when the active row is not rendered', () => {
            // Virtual scrolling can drop it; jumping somewhere arbitrary would
            // be worse than ignoring the press.
            byId('r1').classList.remove('active');

            expect(zapAdjacent('up')).toBe(false);
        });

        it('leaves horizontal directions alone', () => {
            expect(zapAdjacent('left')).toBe(false);
        });
    });
});
