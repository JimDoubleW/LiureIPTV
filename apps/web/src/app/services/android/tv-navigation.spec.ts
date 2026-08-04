import { armTvNavigation } from './tv-navigation';
import { getLastContextFocus } from './panel-region';
import { TV_FULLSCREEN_ATTRIBUTE } from './player-keys';

HTMLElement.prototype.scrollIntoView ??= () => undefined;

function dispatch(key: string): void {
    (
        window as Window & { __tvKeyDispatch?: (key: string) => void }
    ).__tvKeyDispatch?.(key);
}

function withRect(
    element: HTMLElement,
    {
        top,
        left = 100,
        width = 240,
        height = 48,
    }: {
        top: number;
        left?: number;
        width?: number;
        height?: number;
    }
): HTMLElement {
    element.getBoundingClientRect = () =>
        ({
            top,
            bottom: top + height,
            left,
            right: left + width,
            width,
            height,
            x: left,
            y: top,
            toJSON: () => undefined,
        }) as DOMRect;
    return element;
}

describe('native key dispatch for EPG programme rows', () => {
    beforeAll(() => {
        (
            window as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };
        armTvNavigation();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.documentElement.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
    });

    afterAll(() => {
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    it('enters the row actions with RIGHT and leaves them with LEFT', () => {
        document.body.innerHTML = `
            <app-epg-list-view-row class="g-row" tabindex="0" role="button">
                <div class="body"><div class="title">Programme</div></div>
                <div class="aux">
                    <button id="watch" type="button" data-tv-row-action>
                        Watch
                    </button>
                    <button id="info" type="button" data-tv-row-action>
                        i
                    </button>
                </div>
            </app-epg-list-view-row>
        `;

        const row = document.querySelector(
            'app-epg-list-view-row'
        ) as HTMLElement;
        const watch = document.getElementById('watch') as HTMLButtonElement;
        const info = document.getElementById('info') as HTMLButtonElement;

        row.focus();
        expect(document.activeElement).toBe(row);

        dispatch('right');
        expect(document.activeElement).toBe(watch);

        dispatch('right');
        expect(document.activeElement).toBe(info);

        dispatch('left');
        expect(document.activeElement).toBe(watch);

        dispatch('left');
        expect(document.activeElement).toBe(row);
    });

    it('keeps UP/DOWN inside EPG rows, including at list boundaries', () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <main class="content-container">
                <app-epg-list-view>
                    <app-epg-list-view-row id="first" tabindex="0">
                        <button data-tv-row-action>Info 1</button>
                    </app-epg-list-view-row>
                    <app-epg-list-view-row id="second" tabindex="0">
                        <button id="second-info" data-tv-row-action>Info 2</button>
                    </app-epg-list-view-row>
                    <app-epg-list-view-row id="last" tabindex="0">
                        <button data-tv-row-action>Info 3</button>
                    </app-epg-list-view-row>
                </app-epg-list-view>
            </main>
        `;

        const first = document.getElementById('first') as HTMLElement;
        const second = document.getElementById('second') as HTMLElement;
        const secondInfo = document.getElementById(
            'second-info'
        ) as HTMLButtonElement;
        const last = document.getElementById('last') as HTMLElement;
        const live = document.getElementById('live') as HTMLAnchorElement;

        secondInfo.focus();
        dispatch('down');
        expect(document.activeElement).toBe(last);

        dispatch('down');
        expect(document.activeElement).toBe(last);
        expect(document.activeElement).not.toBe(live);

        dispatch('up');
        expect(document.activeElement).toBe(second);

        dispatch('up');
        expect(document.activeElement).toBe(first);

        dispatch('up');
        expect(document.activeElement).toBe(first);
        expect(document.activeElement).not.toBe(live);
    });

    it('confirms a live category with OK, folds it, and reopens it with BACK', () => {
        document.body.innerHTML = `
            <aside class="context-panel">
                <button id="category" class="category-item">News</button>
            </aside>
            <main>
                <div id="channel" class="channel-list-item" tabindex="0">
                    Channel 1
                </div>
            </main>
        `;

        const category = document.getElementById(
            'category'
        ) as HTMLButtonElement;
        const channel = document.getElementById('channel') as HTMLElement;
        const click = jest.fn();
        const play = jest.fn();
        category.addEventListener('click', click);
        channel.addEventListener('dblclick', play);

        category.focus();
        dispatch('ok');

        expect(click).toHaveBeenCalledTimes(1);
        expect(
            document.querySelector('aside.context-panel')?.hasAttribute('inert')
        ).toBe(true);
        expect(document.activeElement).toBe(channel);
        expect(play).toHaveBeenCalledTimes(1);
        expect(getLastContextFocus()).toBe(category);

        // Angular may recreate the sidebar after the category data refresh;
        // the document region is the durable collapsed-state signal.
        document.querySelector('aside.context-panel')?.removeAttribute('inert');

        dispatch('back');

        expect(
            document.querySelector('aside.context-panel')?.hasAttribute('inert')
        ).toBe(false);
        expect(document.activeElement).toBe(category);
    });

    it('keeps category navigation in the content panel for movie cards', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" class="portal-rail-link is-active" href="#">Live TV</a>
            </aside>
            <aside class="context-panel">
                <button id="category" class="category-item">Movies</button>
            </aside>
            <main>
                <button id="refine">Refine</button>
                <app-grid-list>
                    <mat-card id="movie" data-tv-content-card tabindex="0">
                        Movie
                    </mat-card>
                    <mat-card id="movie-next" data-tv-content-card tabindex="0">
                        Next
                    </mat-card>
                </app-grid-list>
            </main>
        `;

        const category = document.getElementById('category') as HTMLElement;
        const movie = document.getElementById('movie') as HTMLElement;

        category.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve));

        expect(document.activeElement).toBe(movie);
        dispatch('down');
        expect(document.activeElement).not.toBe(
            document.getElementById('live')
        );
    });

    it('restores focus to a remaining content card after a card is removed', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" class="portal-rail-link is-active" href="#">Live TV</a>
            </aside>
            <main>
                <div id="removed" data-tv-action-card tabindex="0">Remove</div>
                <div id="remaining" data-tv-action-card tabindex="0">Remaining</div>
            </main>
        `;

        const removed = document.getElementById('removed') as HTMLElement;
        const remaining = document.getElementById('remaining') as HTMLElement;
        withRect(removed, { top: 100 });
        withRect(remaining, { top: 180 });
        removed.addEventListener('click', () => {
            window.setTimeout(() => removed.remove(), 100);
        });

        removed.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve, 175));

        expect(document.activeElement).toBe(remaining);
        expect(document.activeElement).not.toBe(document.getElementById('live'));
    });

    it('restores focus when a movie or series detail replaces its source button', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="movies" class="portal-rail-link is-active" href="#">
                    Movies
                </a>
            </aside>
            <main>
                <button id="similar" class="details__similar-card">
                    Similar movie
                </button>
            </main>
        `;

        const similar = document.getElementById(
            'similar'
        ) as HTMLButtonElement;
        withRect(similar, { top: 120 });
        similar.addEventListener('click', () => {
            window.setTimeout(() => {
                const main = document.querySelector('main');
                if (main) {
                    main.innerHTML = '<button id="play-detail">Play</button>';
                    withRect(
                        document.getElementById(
                            'play-detail'
                        ) as HTMLButtonElement,
                        { top: 120 }
                    );
                }
            }, 100);
        });

        similar.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve, 175));

        expect(document.activeElement).toBe(
            document.getElementById('play-detail')
        );
        expect(document.activeElement).not.toBe(
            document.getElementById('movies')
        );
    });

    it('moves focus from a collapsed VOD hero to the player controls', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="movies" class="portal-rail-link is-active" href="#">
                    Movies
                </a>
            </aside>
            <main>
                <div id="hero" class="shell__hero">
                    <button id="play">Play</button>
                </div>
                <app-player-controls>
                    <button id="pause">Pause</button>
                </app-player-controls>
            </main>
        `;

        const hero = document.getElementById('hero') as HTMLElement;
        const play = withRect(
            document.getElementById('play') as HTMLButtonElement,
            { top: 120 }
        );
        const pause = withRect(
            document.getElementById('pause') as HTMLButtonElement,
            { top: 40 }
        );
        play.addEventListener('click', () => {
            hero.style.visibility = 'hidden';
        });

        play.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve));

        expect(document.activeElement).toBe(pause);
        expect(document.activeElement).not.toBe(
            document.getElementById('movies')
        );
    });

    it('moves focus from an off-screen series episode to the player controls', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="series" class="portal-rail-link is-active" href="#">
                    Series
                </a>
            </aside>
            <main>
                <div id="episode" class="episode-card"
                     data-tv-content-card tabindex="0">
                    Episode
                </div>
                <app-player-controls>
                    <button id="pause">Pause</button>
                </app-player-controls>
            </main>
        `;

        const episode = withRect(
            document.getElementById('episode') as HTMLElement,
            { top: 180 }
        );
        const pause = withRect(
            document.getElementById('pause') as HTMLButtonElement,
            { top: 40 }
        );
        episode.addEventListener('click', () => {
            withRect(episode, { top: window.innerHeight + 100 });
        });

        episode.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve));

        expect(document.activeElement).toBe(pause);
        expect(document.activeElement).not.toBe(
            document.getElementById('series')
        );
    });

    it('reopens an empty category instead of falling back to the tray', () => {
        jest.useFakeTimers();
        try {
            document.body.innerHTML = `
                <aside class="app-rail">
                    <a id="movies" class="portal-rail-link is-active" href="#">
                        Movies
                    </a>
                </aside>
                <aside class="context-panel">
                    <button id="empty" class="category-item">Empty</button>
                </aside>
                <main></main>
            `;

            const category = document.getElementById('empty') as HTMLElement;
            category.focus();
            dispatch('ok');
            jest.advanceTimersByTime(1_100);

            expect(document.activeElement).toBe(category);
            expect(
                document.querySelector('.context-panel')?.hasAttribute('inert')
            ).toBe(false);
            expect(document.activeElement).not.toBe(
                document.getElementById('movies')
            );
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('uses OK/BACK to enter and leave a Settings section', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="settings-route" class="portal-rail-link is-active"
                   href="#">Settings</a>
            </aside>
            <aside class="context-panel context-panel--settings">
                <button id="playback-section"
                    class="nav-item settings-section-item active"
                    data-test-id="settings-section-playback">
                    Playback
                </button>
            </aside>
            <main>
                <section id="playback" class="settings-group">
                    <button id="player-setting">Player</button>
                </section>
            </main>
        `;

        const section = document.getElementById(
            'playback-section'
        ) as HTMLButtonElement;
        const setting = document.getElementById(
            'player-setting'
        ) as HTMLButtonElement;

        section.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve));
        expect(document.activeElement).toBe(setting);

        dispatch('back');
        expect(document.activeElement).toBe(section);

        dispatch('back');
        expect(document.activeElement).toBe(
            document.getElementById('settings-route')
        );
    });

    it('recovers a Settings control replaced asynchronously before tray fallback', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="settings-route" class="portal-rail-link is-active"
                   href="#">Settings</a>
            </aside>
            <aside class="context-panel context-panel--settings">
                <button id="general-section"
                    class="settings-section-item active"
                    data-test-id="settings-section-general">
                    General
                </button>
            </aside>
            <main>
                <section id="general" class="settings-group">
                    <button id="old-control">Old</button>
                </section>
            </main>
        `;

        const section = document.getElementById(
            'general-section'
        ) as HTMLButtonElement;
        section.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve));

        document.getElementById('old-control')?.remove();
        const replacement = document.createElement('button');
        replacement.id = 'replacement-control';
        replacement.textContent = 'Replacement';
        replacement.getBoundingClientRect = () =>
            ({
                left: 100,
                top: 100,
                right: 260,
                bottom: 140,
                width: 160,
                height: 40,
                x: 100,
                y: 100,
                toJSON: () => undefined,
            }) as DOMRect;
        document.getElementById('general')?.append(replacement);

        dispatch('down');

        expect(document.activeElement).toBe(replacement);
        expect(document.activeElement).not.toBe(
            document.getElementById('settings-route')
        );
    });

    it('leaves a disabled Settings control for its nearest enabled neighbour', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="settings-route" class="portal-rail-link is-active"
                   href="#">Settings</a>
            </aside>
            <aside class="context-panel context-panel--settings">
                <button id="general-section"
                    class="settings-section-item active"
                    data-test-id="settings-section-general">
                    General
                </button>
            </aside>
            <main>
                <section id="general" class="settings-group">
                    <button id="save">Save</button>
                    <button id="export">Export</button>
                </section>
            </main>
        `;

        const section = document.getElementById(
            'general-section'
        ) as HTMLButtonElement;
        const save = withRect(
            document.getElementById('save') as HTMLButtonElement,
            { top: 100 }
        ) as HTMLButtonElement;
        const exportButton = withRect(
            document.getElementById('export') as HTMLButtonElement,
            { top: 170 }
        );

        section.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve));
        expect(document.activeElement).toBe(save);

        save.disabled = true;
        save.blur();
        dispatch('down');

        expect(document.activeElement).toBe(exportButton);
        expect(document.activeElement).not.toBe(
            document.getElementById('settings-route')
        );
    });

    it('restores a download card when its focused async action disappears', () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="downloads" class="portal-rail-link is-active" href="#">
                    Downloads
                </a>
            </aside>
            <main>
                <article id="download-card" data-tv-content-card
                    data-tv-action-card data-tv-focus-key="download-42"
                    tabindex="0">
                    Download
                    <div data-tv-action-row>
                        <button id="pause">Pause</button>
                        <button id="cancel">Cancel</button>
                    </div>
                </article>
            </main>
        `;

        const card = withRect(
            document.getElementById('download-card') as HTMLElement,
            { top: 100 }
        );
        const pause = withRect(
            document.getElementById('pause') as HTMLButtonElement,
            { top: 120, left: 360, width: 80 }
        );
        withRect(
            document.getElementById('cancel') as HTMLButtonElement,
            { top: 120, left: 460, width: 80 }
        );

        card.focus();
        dispatch('right');
        expect(document.activeElement).toBe(pause);

        pause.remove();
        expect(document.activeElement).toBe(document.body);
        dispatch('down');

        expect(document.activeElement).toBe(card);
        expect(document.activeElement).not.toBe(
            document.getElementById('downloads')
        );
    });

    it('keeps LEFT and RIGHT inside a panel and uses BACK to return to the tray', () => {
        document.body.innerHTML = `
            <aside class="app-rail"><button id="tray">Live TV</button></aside>
            <aside class="context-panel">
                <button id="category" class="category-item">News</button>
            </aside>
            <main><div id="channel" class="channel-list-item" tabindex="0">Channel 1</div></main>
        `;

        const tray = document.getElementById('tray') as HTMLButtonElement;
        const category = document.getElementById(
            'category'
        ) as HTMLButtonElement;
        const channel = document.getElementById('channel') as HTMLElement;

        document.documentElement.setAttribute('data-tv-region', 'context');
        channel.focus();
        dispatch('left');
        expect(document.activeElement).toBe(channel);

        category.focus();
        dispatch('right');
        expect(document.activeElement).toBe(category);

        dispatch('back');
        expect(document.activeElement).toBe(tray);
    });

    it('uses OK on a tray item to enter the Live Categories panel', () => {
        // A Live TV destination always waits a couple of retries before
        // trusting "nothing to resume" — see MIN_LIVE_SETTLE_ATTEMPTS — so
        // this needs fake timers even though nothing here is playing yet.
        jest.useFakeTimers();
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" href="/workspace/live">Live TV</a>
            </aside>
            <aside class="context-panel">
                <button id="category" class="category-item">News</button>
            </aside>
            <div class="content-container"></div>
            <main><div class="channel-list-item" tabindex="0">Channel 1</div></main>
        `;

        const trayItem = document.getElementById('live') as HTMLAnchorElement;
        const category = document.getElementById(
            'category'
        ) as HTMLButtonElement;
        const click = jest.fn();
        trayItem.addEventListener('click', (event) => {
            event.preventDefault();
            click();
        });

        trayItem.focus();
        dispatch('ok');
        jest.advanceTimersByTime(200);

        expect(click).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(category);
        jest.useRealTimers();
    });

    it.each(['up', 'down', 'left', 'right'])(
        'starts %s navigation on the active vertical tray item',
        (direction) => {
            document.body.innerHTML = `
                <aside class="app-rail">
                    <a id="brand" href="/">Brand</a>
                    <nav>
                        <a id="dashboard" class="portal-rail-link" href="/dashboard">Dashboard</a>
                        <a id="live" class="portal-rail-link is-active"
                           aria-current="page" href="/workspace/live">Live TV</a>
                    </nav>
                </aside>
                <app-workspace-shell-header>
                    <button id="playlist">Playlist</button>
                </app-workspace-shell-header>
            `;

            dispatch(direction);

            expect(document.activeElement).toBe(
                document.getElementById('live')
            );
        }
    );

    it('uses BACK from the workspace header as a recovery to the vertical tray', () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <app-workspace-shell-header>
                <button id="playlist">Playlist</button>
            </app-workspace-shell-header>
        `;

        const playlist = document.getElementById(
            'playlist'
        ) as HTMLButtonElement;
        playlist.focus();
        dispatch('back');

        expect(document.activeElement).toBe(document.getElementById('live'));
    });

    it('folds the channel list after OK and restores it with BACK', () => {
        document.body.innerHTML = `
            <aside class="context-panel" inert>
                <button class="category-item">News</button>
            </aside>
            <div class="sidebar">
                <div class="sidebar-header">
                    <button id="hide" aria-pressed="false">Hide</button>
                </div>
                <div id="channel" class="channel-list-item active" tabindex="0">
                    Channel 1
                </div>
            </div>
            <div class="content-container">
                <button class="sidebar-restore" aria-pressed="true">Show</button>
            </div>
            <main>
                <div class="video-player"></div>
                <app-web-player-view><app-android-native-player>
                </app-android-native-player></app-web-player-view>
            </main>
        `;

        const channel = document.getElementById('channel') as HTMLElement;
        const hide = document.getElementById('hide') as HTMLButtonElement;
        const show = document.querySelector(
            '.sidebar-restore'
        ) as HTMLButtonElement;
        const click = jest.fn();
        channel.addEventListener('click', click);
        hide.addEventListener('click', () => {
            document
                .querySelector('.sidebar')
                ?.classList.add('sidebar-collapsed');
            show.setAttribute('aria-pressed', 'true');
        });
        show.addEventListener('click', () => {
            document
                .querySelector('.sidebar')
                ?.classList.remove('sidebar-collapsed');
            show.setAttribute('aria-pressed', 'false');
        });

        channel.focus();
        dispatch('ok');

        expect(click).toHaveBeenCalledTimes(1);
        expect(
            document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
        ).toBe(false);
        expect(
            document
                .querySelector('.sidebar')
                ?.classList.contains('sidebar-collapsed')
        ).toBe(true);
        expect(document.querySelector('.sidebar')?.hasAttribute('inert')).toBe(
            true
        );

        dispatch('back');

        expect(
            document
                .querySelector('.sidebar')
                ?.classList.contains('sidebar-collapsed')
        ).toBe(false);
        expect(document.querySelector('.sidebar')?.hasAttribute('inert')).toBe(
            false
        );
        expect(document.activeElement).toBe(channel);
    });

    it('transfers focus to the current EPG row after Channels becomes inert', async () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <div class="sidebar">
                <button id="hide" aria-pressed="false">Hide</button>
                <div id="channel" class="channel-list-item active" tabindex="0">
                    Channel 1
                </div>
            </div>
            <main class="content-container">
                <app-epg-list-view>
                    <app-epg-list-view-row id="past" data-when="past"
                        tabindex="0">Past</app-epg-list-view-row>
                    <app-epg-list-view-row id="now" class="sel"
                        data-when="now" tabindex="0">Now</app-epg-list-view-row>
                    <app-epg-list-view-row id="next" data-when="future"
                        tabindex="0">Next</app-epg-list-view-row>
                </app-epg-list-view>
            </main>
        `;

        const sidebar = document.querySelector('.sidebar') as HTMLElement;
        const channel = document.getElementById('channel') as HTMLElement;
        const now = document.getElementById('now') as HTMLElement;
        const next = document.getElementById('next') as HTMLElement;
        const live = document.getElementById('live') as HTMLAnchorElement;
        document.getElementById('hide')?.addEventListener('click', () => {
            sidebar.classList.add('sidebar-collapsed');
        });

        channel.focus();
        dispatch('ok');
        await new Promise((resolve) => window.setTimeout(resolve));

        expect(sidebar.hasAttribute('inert')).toBe(true);
        expect(document.activeElement).toBe(now);

        dispatch('down');
        expect(document.activeElement).toBe(next);
        expect(document.activeElement).not.toBe(live);
    });

    it('starts inline from the channel list, then enters fullscreen from the player', () => {
        document.body.innerHTML = `
            <aside class="context-panel" inert>
                <button class="category-item">News</button>
            </aside>
            <div class="sidebar">
                <div class="sidebar-header">
                    <button id="hide" aria-pressed="false">Hide</button>
                </div>
                <div id="previous" class="channel-list-item" tabindex="0">
                    Previous
                </div>
                <div id="current" class="channel-list-item active" tabindex="0">
                    Current
                </div>
                <div id="next" class="channel-list-item" tabindex="0">
                    Next
                </div>
            </div>
            <div class="content-container">
                <button class="sidebar-restore" aria-pressed="true">Show</button>
            </div>
            <main>
                <app-web-player-view><app-android-native-player>
                </app-android-native-player>
                <button id="player-surface">Video</button>
                <app-player-controls><button id="pause">Pause</button>
                </app-player-controls></app-web-player-view>
            </main>
        `;

        const current = document.getElementById('current') as HTMLElement;
        const previous = document.getElementById('previous') as HTMLElement;
        const next = document.getElementById('next') as HTMLElement;
        const hide = document.getElementById('hide') as HTMLButtonElement;
        const clicked: string[] = [];
        const activate = (target: HTMLElement, id: string) => {
            for (const row of [previous, current, next]) {
                row.classList.toggle('active', row === target);
            }
            clicked.push(id);
        };
        current.addEventListener('click', () => activate(current, 'current'));
        previous.addEventListener('click', () =>
            activate(previous, 'previous')
        );
        next.addEventListener('click', () => activate(next, 'next'));
        hide.addEventListener('click', () => {
            document
                .querySelector('.sidebar')
                ?.classList.add('sidebar-collapsed');
        });

        current.focus();
        dispatch('up');
        expect(clicked).toEqual(['previous']);
        expect(document.activeElement).toBe(previous);

        dispatch('down');
        expect(clicked).toEqual(['previous', 'current']);
        expect(document.activeElement).toBe(current);

        dispatch('ok');

        expect(clicked).toEqual(['previous', 'current', 'current']);
        expect(
            document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
        ).toBe(false);
        expect(document.activeElement).toBe(current);

        const player = document.getElementById(
            'player-surface'
        ) as HTMLButtonElement;
        player.focus();
        dispatch('ok');
        expect(
            document.documentElement.hasAttribute(TV_FULLSCREEN_ATTRIBUTE)
        ).toBe(true);

        dispatch('up');
        expect(clicked).toEqual([
            'previous',
            'current',
            'current',
            'previous',
        ]);

        dispatch('down');
        expect(clicked).toEqual([
            'previous',
            'current',
            'current',
            'previous',
            'current',
        ]);
    });

    it('recovers a channel row recycled by virtual scrolling before using the tray fallback', () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <aside class="context-panel" inert>
                <button class="category-item">News</button>
            </aside>
            <main>
                <div class="sidebar">
                    <div id="current" class="channel-list-item active" tabindex="0">Current</div>
                    <div id="next" class="channel-list-item" tabindex="0">Next</div>
                </div>
            </main>
        `;

        const current = document.getElementById('current') as HTMLElement;
        const next = document.getElementById('next') as HTMLElement;
        next.addEventListener('click', () => {
            current.classList.remove('active');
            next.classList.add('active');
        });

        current.focus();
        dispatch('down');
        expect(document.activeElement).toBe(next);

        next.remove();
        const replacement = document.createElement('div');
        replacement.id = 'next-recycled';
        replacement.className = 'channel-list-item active';
        replacement.tabIndex = 0;
        document.querySelector('.sidebar')?.append(replacement);
        expect(document.activeElement).toBe(document.body);

        dispatch('up');

        expect(document.activeElement).toBe(replacement);
        expect(document.activeElement).not.toBe(document.getElementById('live'));
        expect(
            document.querySelector('.context-panel')?.hasAttribute('inert')
        ).toBe(true);
    });

    it('recovers an EPG programme row replaced during guide navigation before using the tray fallback', () => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="live" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <aside class="context-panel" inert>
                <button class="category-item">News</button>
            </aside>
            <main>
                <div class="content-container">
                    <app-epg-list-view>
                        <app-epg-list-view-row id="programme"
                            data-tv-epg-key="2026-08-03T21:10" tabindex="0">
                            <button id="info" data-tv-row-action>Info</button>
                        </app-epg-list-view-row>
                    </app-epg-list-view>
                </div>
            </main>
        `;

        const programme = document.getElementById('programme') as HTMLElement;
        programme.focus();
        dispatch('right');
        expect(document.activeElement).toBe(document.getElementById('info'));

        programme.remove();
        const replacement = document.createElement('app-epg-list-view-row');
        replacement.id = 'programme-recycled';
        replacement.dataset['tvEpgKey'] = '2026-08-03T21:10';
        replacement.tabIndex = 0;
        document.querySelector('app-epg-list-view')?.append(replacement);
        expect(document.activeElement).toBe(document.body);

        dispatch('down');

        expect(document.activeElement).toBe(replacement);
        expect(document.activeElement).not.toBe(document.getElementById('live'));
        expect(
            document.querySelector('.context-panel')?.hasAttribute('inert')
        ).toBe(true);
    });

    it('requires a double BACK in the tray and stops the native player before exit', async () => {
        document.body.innerHTML = `
            <aside class="app-rail"><button id="tray">Live TV</button></aside>
            <main><div id="channel" class="channel-list-item" tabindex="0">Channel 1</div></main>
        `;

        const tray = document.getElementById('tray') as HTMLButtonElement;
        const exitApp = jest.fn().mockResolvedValue(undefined);
        const stop = jest.fn().mockResolvedValue(undefined);
        (
            window as unknown as {
                Capacitor: {
                    getPlatform(): string;
                    Plugins: {
                        App: { exitApp: () => Promise<void> };
                        AndroidNativePlayer: { stop: () => Promise<void> };
                    };
                };
            }
        ).Capacitor = {
            getPlatform: () => 'android',
            Plugins: {
                App: { exitApp },
                AndroidNativePlayer: { stop },
            },
        };

        tray.focus();
        dispatch('back');
        expect(stop).not.toHaveBeenCalled();
        expect(exitApp).not.toHaveBeenCalled();

        dispatch('back');
        await Promise.resolve();
        await Promise.resolve();

        expect(stop).toHaveBeenCalledTimes(1);
        expect(exitApp).toHaveBeenCalledTimes(1);
        expect(stop.mock.invocationCallOrder[0]).toBeLessThan(
            exitApp.mock.invocationCallOrder[0]
        );
    });
});

describe('panel memory when entering another zone', () => {
    beforeAll(() => {
        (
            window as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };
        armTvNavigation();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.documentElement.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
    });

    afterAll(() => {
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    it('does not recall another live panel from the shared body zone', () => {
        // Anything with no landmark ancestor and no scroll container of its own
        // resolves to `document.body` — on the live screen the channel list's
        // header buttons and the player controls share that single slot. The
        // remembered element must not be treated as the target panel's own
        // selection, or a move inside the player lands back in Channels.
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="tray" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <main>
                <div class="sidebar">
                    <button id="collapse" type="button">Hide</button>
                    <button id="sort" type="button">Sort</button>
                </div>
                <div class="content-container">
                    <app-player-controls>
                        <button id="play" type="button">Play</button>
                    </app-player-controls>
                    <div class="epg" data-tv-zone="epg">
                        <button id="guide" type="button">Guide</button>
                    </div>
                </div>
            </main>
        `;

        const collapse = withRect(
            document.getElementById('collapse') as HTMLElement,
            { top: 60, left: 20, width: 40, height: 40 }
        );
        const sort = withRect(document.getElementById('sort') as HTMLElement, {
            top: 120,
            left: 20,
            width: 40,
            height: 40,
        });
        const play = withRect(document.getElementById('play') as HTMLElement, {
            top: 200,
            left: 400,
            width: 60,
            height: 40,
        });
        const guide = withRect(
            document.getElementById('guide') as HTMLElement,
            { top: 300, left: 400, width: 200, height: 40 }
        );

        // Leaves the channel sidebar's header button as the body zone's
        // remembered selection.
        collapse.focus();
        dispatch('down');
        expect(document.activeElement).toBe(sort);

        guide.focus();
        dispatch('up');

        expect(document.activeElement).toBe(play);
    });

    it('still restores a real panel selection when entering its zone', () => {
        document.body.innerHTML = `
            <main>
                <div data-tv-zone="listA">
                    <button id="a1" type="button">A1</button>
                    <button id="a2" type="button">A2</button>
                </div>
                <div data-tv-zone="listB">
                    <button id="b1" type="button">B1</button>
                    <button id="b2" type="button">B2</button>
                </div>
            </main>
        `;

        const a1 = withRect(document.getElementById('a1') as HTMLElement, {
            top: 100,
            left: 100,
            width: 80,
            height: 40,
        });
        withRect(document.getElementById('a2') as HTMLElement, {
            top: 160,
            left: 100,
            width: 80,
            height: 40,
        });
        const b1 = withRect(document.getElementById('b1') as HTMLElement, {
            top: 100,
            left: 500,
            width: 80,
            height: 40,
        });
        const b2 = withRect(document.getElementById('b2') as HTMLElement, {
            top: 160,
            left: 500,
            width: 80,
            height: 40,
        });

        b1.focus();
        dispatch('down');
        expect(document.activeElement).toBe(b2);

        a1.focus();
        dispatch('right');

        expect(document.activeElement).toBe(b2);
    });
});

describe('focus survival across an async list swap', () => {
    beforeAll(() => {
        (
            window as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };
        armTvNavigation();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
        document.documentElement.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
    });

    afterAll(() => {
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    it('re-owns the remote when the confirmed category replaces the rows', () => {
        // Measured on the reference box: confirming a category focuses the
        // first row on screen, which still belongs to the previous category,
        // and the real channels replace it ~93 ms later. Nothing watched that
        // destruction, so the remote went dead until the next key press.
        jest.useFakeTimers();
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="tray" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <aside class="context-panel">
                <button id="category" class="category-item" type="button">
                    FR TV
                </button>
            </aside>
            <main>
                <div class="sidebar">
                    <div class="channel-list-item" id="old-1" tabindex="0">
                        Old 1
                    </div>
                    <div class="channel-list-item" id="old-2" tabindex="0">
                        Old 2
                    </div>
                </div>
            </main>
        `;

        const category = document.getElementById('category') as HTMLElement;
        category.focus();
        dispatch('ok');

        expect(document.activeElement).toBe(document.getElementById('old-1'));

        const sidebar = document.querySelector('.sidebar') as HTMLElement;
        sidebar.innerHTML = `
            <div class="channel-list-item" id="new-1" tabindex="0">New 1</div>
            <div class="channel-list-item" id="new-2" tabindex="0">New 2</div>
        `;
        expect(document.activeElement).toBe(document.body);

        jest.advanceTimersByTime(300);

        expect(document.activeElement).toBe(document.getElementById('new-1'));
    });

    it('leaves focus alone when another owner took over meanwhile', () => {
        jest.useFakeTimers();
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="tray" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <aside class="context-panel">
                <button id="category" class="category-item" type="button">
                    FR TV
                </button>
            </aside>
            <main>
                <div class="sidebar">
                    <div class="channel-list-item" id="old-1" tabindex="0">
                        Old 1
                    </div>
                </div>
                <button id="elsewhere" type="button">Elsewhere</button>
            </main>
        `;

        const category = document.getElementById('category') as HTMLElement;
        category.focus();
        dispatch('ok');
        expect(document.activeElement).toBe(document.getElementById('old-1'));

        const elsewhere = document.getElementById(
            'elsewhere'
        ) as HTMLButtonElement;
        elsewhere.focus();
        (document.getElementById('old-1') as HTMLElement).remove();

        jest.advanceTimersByTime(300);

        expect(document.activeElement).toBe(elsewhere);
    });
});

describe('focus survival for grid content', () => {
    beforeAll(() => {
        (
            window as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };
        armTvNavigation();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.innerHTML = '';
        document.documentElement.removeAttribute(TV_FULLSCREEN_ATTRIBUTE);
    });

    afterAll(() => {
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    it('recovers a replaced catalog card, not only channel rows', () => {
        // Traced on the reference box: the live route's cold start renders a
        // card grid rather than the channel sidebar, so the row-based recovery
        // owner does not apply and the remote was left on <body>.
        jest.useFakeTimers();
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="tray" class="portal-rail-link is-active"
                   aria-current="page" href="/workspace/live">Live TV</a>
            </aside>
            <aside class="context-panel">
                <button id="category" class="category-item" type="button">
                    FR TV
                </button>
            </aside>
            <main>
                <div class="grid">
                    <mat-card id="old-card" data-tv-content-card tabindex="0">
                        Old card
                    </mat-card>
                </div>
            </main>
        `;

        withRect(document.getElementById('old-card') as HTMLElement, {
            top: 200,
            left: 400,
            width: 200,
            height: 120,
        });

        const category = document.getElementById('category') as HTMLElement;
        category.focus();
        dispatch('ok');
        expect(document.activeElement).toBe(
            document.getElementById('old-card')
        );

        const grid = document.querySelector('.grid') as HTMLElement;
        grid.innerHTML = `
            <mat-card id="new-card" data-tv-content-card tabindex="0">
                New card
            </mat-card>
        `;
        withRect(document.getElementById('new-card') as HTMLElement, {
            top: 200,
            left: 400,
            width: 200,
            height: 120,
        });
        expect(document.activeElement).toBe(document.body);

        jest.advanceTimersByTime(300);

        expect(document.activeElement).toBe(
            document.getElementById('new-card')
        );
    });
});
