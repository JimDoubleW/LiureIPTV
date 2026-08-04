import { ZoneMemory } from './focus-zones';
import { TvPanelNavigation } from './tv-panel-navigation';

function withRect(element: HTMLElement, top: number): HTMLElement {
    element.getBoundingClientRect = () =>
        ({
            top,
            bottom: top + 40,
            left: 0,
            right: 200,
            width: 200,
            height: 40,
            x: 0,
            y: top,
            toJSON: () => undefined,
        }) as DOMRect;
    return element;
}

describe('TvPanelNavigation.moveWithinEpgRow at the list boundaries', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('returns UP from the first row to the video, even faded', () => {
        // The transport bar fades to opacity:0 a few seconds after focus
        // leaves it — the common state by the time a viewer has scrolled to
        // the top of the guide. Focusing it must still work: that focus is
        // what reveals it again.
        document.body.innerHTML = `
            <app-player-controls>
                <button id="pause" disabled>Pause</button>
                <button id="fullscreen"
                    data-tv-fullscreen-toggle
                    style="opacity: 0"
                >Fullscreen</button>
            </app-player-controls>
            <app-epg-list-view>
                <app-epg-list-view-row id="first" tabindex="0">
                    <button data-tv-row-action>Info</button>
                </app-epg-list-view-row>
            </app-epg-list-view>
        `;
        const fullscreen = withRect(
            document.getElementById('fullscreen') as HTMLButtonElement,
            0
        );
        const first = document.getElementById('first') as HTMLElement;
        const applyFocus = jest.fn();
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        const handled = panels.moveWithinEpgRow(first, 'up');

        expect(handled).toBe(true);
        expect(applyFocus).toHaveBeenCalledWith(fullscreen);
    });

    it('stays consumed at the top row when no player exists to return to', () => {
        document.body.innerHTML = `
            <app-epg-list-view>
                <app-epg-list-view-row id="first" tabindex="0">
                    <button data-tv-row-action>Info</button>
                </app-epg-list-view-row>
            </app-epg-list-view>
        `;
        const first = document.getElementById('first') as HTMLElement;
        const applyFocus = jest.fn();
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        const handled = panels.moveWithinEpgRow(first, 'up');

        expect(handled).toBe(true);
        expect(applyFocus).not.toHaveBeenCalled();
    });

    it('keeps DOWN at the last row consumed even with a player present', () => {
        // Asymmetric on purpose: nothing sits below the guide on this screen,
        // so unlike UP at the top there is no equivalent target to escape to.
        document.body.innerHTML = `
            <app-player-controls>
                <button id="fullscreen" data-tv-fullscreen-toggle>
                    Fullscreen
                </button>
            </app-player-controls>
            <app-epg-list-view>
                <app-epg-list-view-row id="last" tabindex="0">
                    <button data-tv-row-action>Info</button>
                </app-epg-list-view-row>
            </app-epg-list-view>
        `;
        const last = document.getElementById('last') as HTMLElement;
        const applyFocus = jest.fn();
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        const handled = panels.moveWithinEpgRow(last, 'down');

        expect(handled).toBe(true);
        expect(applyFocus).not.toHaveBeenCalled();
    });
});

function liveTrayLink(): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = '/workspace/xtreams/p1/live';
    return link;
}

describe('TvPanelNavigation.focusFirstContextAfterTraySelection', () => {
    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    it('resumes the category the currently playing channel airs in', () => {
        // Leaving Live TV for another section and coming back resets the
        // selected category, but the channel keeps playing behind the scenes.
        // [data-tv-resume-category-id] is written from that remembered state;
        // confirming it directly is what skips the "hunt through 50
        // categories to find the right one" step.
        jest.useFakeTimers();
        document.body.innerHTML = `
            <main>
                <aside class="context-panel">
                    <button class="category-item" data-category-id="10">
                        Cat A
                    </button>
                    <button class="category-item" data-category-id="20">
                        Cat B
                    </button>
                </aside>
                <div class="content-container" data-tv-resume-category-id="20">
                    <div class="sidebar"></div>
                </div>
            </main>
        `;
        const catB = document.querySelector(
            'button.category-item[data-category-id="20"]'
        ) as HTMLButtonElement;
        catB.addEventListener('click', () => {
            document.querySelector('.sidebar')!.innerHTML = `
                <div class="channel-list-item active" id="active-channel"
                    tabindex="0"
                >
                    Now playing
                </div>
            `;
            // Marking the panel inert forcibly blurs whatever it still
            // contains — jsdom does not reproduce that side effect, so it is
            // simulated directly. Missing this in the guard below is what
            // silently stranded focus on the reference box: it read the
            // resulting <body> as "focus moved to something else" instead of
            // "nothing is focused", and gave up instead of waiting.
            catB.blur();
        });
        const applyFocus = jest.fn((element: HTMLElement) => element.focus());
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        // The first resolution only arms the stability check; it never acts
        // on a single observation.
        const firstAttempt =
            panels.focusFirstContextAfterTraySelection(liveTrayLink());
        expect(firstAttempt).toBe(false);
        expect(applyFocus).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1000);

        expect(document.activeElement).toBe(
            document.getElementById('active-channel')
        );
    });

    it('falls back to the first category once the route has mounted with nothing playing', () => {
        // Root cause traced on the reference box: `.content-container`
        // mounting is not proof `ngOnInit` has run — it was observed in the
        // DOM up to ~60ms before the resume-marker binding it feeds actually
        // caught up. Trusting "no resume marker" immediately therefore risks
        // the exact same stale-panel failure the resume path guards against.
        // MIN_LIVE_SETTLE_ATTEMPTS is what forces at least one retry first.
        jest.useFakeTimers();
        document.body.innerHTML = `
            <main>
                <aside class="context-panel">
                    <button class="category-item" data-category-id="10">
                        Cat A
                    </button>
                    <button class="category-item" data-category-id="20">
                        Cat B
                    </button>
                </aside>
                <div class="content-container"></div>
            </main>
        `;
        const catA = document.querySelector(
            'button.category-item[data-category-id="10"]'
        ) as HTMLButtonElement;
        const applyFocus = jest.fn((element: HTMLElement) => element.focus());
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        const firstAttempt =
            panels.focusFirstContextAfterTraySelection(liveTrayLink());
        expect(firstAttempt).toBe(false);
        expect(applyFocus).not.toHaveBeenCalled();

        jest.advanceTimersByTime(200);

        expect(document.activeElement).toBe(catA);
    });

    it('stays pending on a stale panel left over from another section, never guessing its first category', () => {
        // Root cause traced on the reference box: the category panel is a
        // persistent workspace-shell fixture that survives route navigation.
        // Right after the tray click it still shows the *previous* section's
        // own real, clickable first category — Movies' "FILMS RÉCEMMENT
        // AJOUTÉS" here — while Live TV's own content, and with it the resume
        // marker, has not mounted at all yet. Confirming this stale category
        // is what silently stranded the remote on the category panel with
        // the channel list never opening.
        document.body.innerHTML = `
            <main>
                <aside class="context-panel">
                    <button class="category-item" data-category-id="2">
                        Films récemment ajoutés
                    </button>
                </aside>
            </main>
        `;
        const applyFocus = jest.fn((element: HTMLElement) => element.focus());
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        const handled =
            panels.focusFirstContextAfterTraySelection(liveTrayLink());

        expect(handled).toBe(false);
        expect(applyFocus).not.toHaveBeenCalled();
    });

    it('waits for the resume category to render rather than settling early', () => {
        jest.useFakeTimers();
        document.body.innerHTML = `
            <main>
                <aside class="context-panel">
                    <button class="category-item" data-category-id="10">
                        Cat A
                    </button>
                </aside>
                <div class="content-container" data-tv-resume-category-id="20">
                </div>
            </main>
        `;
        const applyFocus = jest.fn((element: HTMLElement) => element.focus());
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        const firstAttempt =
            panels.focusFirstContextAfterTraySelection(liveTrayLink());
        expect(firstAttempt).toBe(false);
        expect(applyFocus).not.toHaveBeenCalled();

        const context = document.querySelector(
            'aside.context-panel'
        ) as HTMLElement;
        context.insertAdjacentHTML(
            'beforeend',
            `<button class="category-item" data-category-id="20">
                Cat B
            </button>`
        );
        const catB = document.querySelector(
            'button.category-item[data-category-id="20"]'
        ) as HTMLButtonElement;
        catB.addEventListener('click', () => {
            document.querySelector('.content-container')!.innerHTML +=
                '<div class="sidebar"><div class="channel-list-item active" ' +
                'id="active-channel" tabindex="0">Now playing</div></div>';
            // See the blur note in the earlier resume test.
            catB.blur();
        });

        jest.advanceTimersByTime(1000);

        expect(document.activeElement).toBe(
            document.getElementById('active-channel')
        );
    });

    it('gives up on the resume category and falls back after 20 attempts', () => {
        jest.useFakeTimers();
        document.body.innerHTML = `
            <main>
                <aside class="context-panel">
                    <button class="category-item" data-category-id="10">
                        Cat A
                    </button>
                </aside>
                <div class="content-container" data-tv-resume-category-id="999">
                </div>
            </main>
        `;
        const catA = document.querySelector(
            'button.category-item[data-category-id="10"]'
        ) as HTMLButtonElement;
        const applyFocus = jest.fn((element: HTMLElement) => element.focus());
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());

        panels.focusFirstContextAfterTraySelection(liveTrayLink());
        jest.advanceTimersByTime(20 * 50);

        expect(document.activeElement).toBe(catA);
    });

    it('resolves immediately for a non-live tray section, never awaiting a resume marker', () => {
        // VOD/Series/Downloads/Settings have no resume concept — the
        // isLiveTypeTarget gate is what keeps them resolving on the first
        // attempt exactly as before, instead of paying the resume wait too.
        document.body.innerHTML = `
            <main>
                <aside class="context-panel">
                    <button class="category-item" data-category-id="10">
                        Action
                    </button>
                </aside>
            </main>
        `;
        const catA = document.querySelector(
            'button.category-item[data-category-id="10"]'
        ) as HTMLButtonElement;
        const applyFocus = jest.fn((element: HTMLElement) => element.focus());
        const panels = new TvPanelNavigation(applyFocus, new ZoneMemory());
        const vodLink = document.createElement('a');
        vodLink.href = '/workspace/xtreams/p1/vod';

        const handled = panels.focusFirstContextAfterTraySelection(vodLink);

        expect(handled).toBe(true);
        expect(document.activeElement).toBe(catA);
    });
});
