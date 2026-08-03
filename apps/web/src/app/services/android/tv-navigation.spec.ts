import { armTvNavigation } from './tv-navigation';
import { getLastContextFocus } from './panel-region';

HTMLElement.prototype.scrollIntoView ??= () => undefined;

function dispatch(key: string): void {
    (
        window as Window & { __tvKeyDispatch?: (key: string) => void }
    ).__tvKeyDispatch?.(key);
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
        category.addEventListener('click', click);

        category.focus();
        dispatch('ok');

        expect(click).toHaveBeenCalledTimes(1);
        expect(
            document.querySelector('aside.context-panel')?.hasAttribute('inert')
        ).toBe(true);
        expect(document.activeElement).toBe(channel);
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
            <main><div class="video-player"></div></main>
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
