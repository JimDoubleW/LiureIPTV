import {
    armPlayerControlsIdleHide,
    enterFullscreen,
    exitFullscreen,
    handleCatchupProgrammeOk,
    handleFullscreenDirection,
    isActiveChannelRow,
    isInsidePlayer,
    TV_FULLSCREEN_ATTRIBUTE,
    TV_FULLSCREEN_LOCKED_ATTRIBUTE,
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
        document.documentElement.removeAttribute(
            TV_FULLSCREEN_LOCKED_ATTRIBUTE
        );
    });

    describe('layout fullscreen', () => {
        it('enters fullscreen on a quick double OK over a catch-up programme', () => {
            document.body.innerHTML =
                '<app-web-player-view data-tv-catchup-playing>' +
                '<app-android-native-player></app-android-native-player>' +
                '</app-web-player-view>' +
                '<div id="programme" data-tv-catchup-target></div>';
            const programme = document.getElementById('programme');

            expect(handleCatchupProgrammeOk(programme)).toBe(false);
            expect(handleCatchupProgrammeOk(programme)).toBe(true);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(true);
        });

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

        it('refuses to leave a locked fullscreen, so BACK closes the player instead', () => {
            // On-demand playback has no inline layout that can show the
            // picture — the theater stage paints over a surface composited
            // behind the WebView. Exiting would leave invisible video
            // playing, so exitFullscreen() declines and the caller's next
            // branch (history) takes over.
            document.body.innerHTML =
                '<app-web-player-view><app-android-native-player>' +
                '</app-android-native-player></app-web-player-view>';
            enterFullscreen();
            document.documentElement.setAttribute(
                TV_FULLSCREEN_LOCKED_ATTRIBUTE,
                ''
            );

            expect(exitFullscreen()).toBe(false);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(true);

            document.documentElement.removeAttribute(
                TV_FULLSCREEN_LOCKED_ATTRIBUTE
            );
            expect(exitFullscreen()).toBe(true);
        });

        it('drops focus off the controls once the remote goes quiet', () => {
            // The shared bar pins itself open while focus is inside — right
            // for a pointer, which moves on by itself. A remote's focus has
            // nowhere else to go while the shell is blanked, so the bar sat
            // over the film forever. Dropping focus is what releases the pin.
            jest.useFakeTimers();
            document.body.innerHTML =
                '<app-web-player-view><app-player-controls>' +
                '<button id="pause">Pause</button>' +
                '</app-player-controls></app-web-player-view>';
            byId('pause').focus();
            expect(document.activeElement).toBe(byId('pause'));

            armPlayerControlsIdleHide();
            jest.advanceTimersByTime(4_000);
            expect(document.activeElement).toBe(byId('pause'));

            // Re-armed on every press, so it measures idleness, not age.
            armPlayerControlsIdleHide();
            jest.advanceTimersByTime(4_000);
            expect(document.activeElement).toBe(byId('pause'));

            jest.advanceTimersByTime(2_000);
            expect(document.activeElement).not.toBe(byId('pause'));
            jest.useRealTimers();
        });

        it('reports nothing to exit when not fullscreen', () => {
            // goBack uses this to fall through to the overlay/history branches.
            expect(exitFullscreen()).toBe(false);
        });

        it('owns every direction while fullscreen, including inert LEFT/RIGHT', () => {
            document.body.innerHTML =
                '<app-web-player-view><video></video></app-web-player-view>';
            enterFullscreen();

            // RIGHT does nothing but must be swallowed, or the WebView acts.
            expect(handleFullscreenDirection('right')).toBe(true);
            // LEFT also stays in fullscreen; BACK is the explicit exit.
            expect(handleFullscreenDirection('left')).toBe(true);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(true);
        });

        it('stays out of the way when not fullscreen', () => {
            expect(handleFullscreenDirection('up')).toBe(false);
        });

        it('stops zapping in live once focus is on a transport control', () => {
            // Zapping out from under a half-used control panel is the wrong
            // gesture: while the bar has focus the directions belong to it.
            // The idle timeout drops focus again, which gives zap its keys
            // back — so this never strands the channel keys.
            document.body.innerHTML = `
                <div class="channel-list-item active" id="r0"></div>
                <div class="channel-list-item" id="r1"></div>
                <app-web-player-view><video></video>
                <app-player-controls><button id="pause">Pause</button>
                </app-player-controls></app-web-player-view>
            `;
            let zapped = false;
            byId('r1').addEventListener('click', () => {
                zapped = true;
            });
            enterFullscreen();

            // Nothing focused: live still zaps, the benchmark contract.
            expect(handleFullscreenDirection('up')).toBe(true);
            expect(zapped).toBe(true);

            zapped = false;
            byId('pause').focus();
            expect(handleFullscreenDirection('up')).toBe(false);
            expect(zapped).toBe(false);
        });

        it('never zaps in a locked fullscreen, and yields the keys instead', () => {
            // On-demand playback has no channel list to zap through. Claiming
            // the keys anyway consumed every direction and moved nothing, so
            // the remote was inert apart from BACK. Yielding lets the ordinary
            // spatial search reach the transport controls.
            document.body.innerHTML = `
                <div class="channel-list-item active" id="r0"></div>
                <div class="channel-list-item" id="r1"></div>
                <app-web-player-view><app-android-native-player>
                </app-android-native-player></app-web-player-view>
            `;
            let zapped = false;
            byId('r1').addEventListener('click', () => {
                zapped = true;
            });
            enterFullscreen();
            document.documentElement.setAttribute(
                TV_FULLSCREEN_LOCKED_ATTRIBUTE,
                ''
            );

            for (const direction of ['up', 'down', 'left', 'right'] as const) {
                expect(handleFullscreenDirection(direction)).toBe(false);
            }
            expect(zapped).toBe(false);
            expect(
                document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
            ).toBe(true);
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
