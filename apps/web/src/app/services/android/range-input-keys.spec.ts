import { armTvNavigation } from './tv-navigation';
import { TV_RANGE_ACTIVE_ATTRIBUTE } from './tv-range-control';
import {
    clearVirtualFocus,
    getVirtualFocus,
} from './virtual-focus';

HTMLElement.prototype.scrollIntoView ??= () => undefined;

function dispatch(key: string, repeatCount = 0): void {
    (
        window as Window & {
            __tvKeyDispatch?: (key: string, repeatCount?: number) => void;
        }
    ).__tvKeyDispatch?.(key, repeatCount);
}

function withRect(
    element: HTMLElement,
    rect: { top: number; bottom: number; left: number; right: number }
): void {
    element.getBoundingClientRect = () =>
        ({
            ...rect,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
        }) as DOMRect;
}

describe('native key dispatch and range inputs', () => {
    const showKeyboard = jest.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        (
            window as unknown as {
                Capacitor: {
                    getPlatform(): string;
                    Plugins: { Keyboard: { show(): Promise<void> } };
                };
            }
        ).Capacitor = {
            getPlatform: () => 'android',
            Plugins: { Keyboard: { show: showKeyboard } },
        };
        document.body.innerHTML = `
            <button id="before">Pause</button>
            <input id="timeline" type="range" min="0" max="100" value="5" />
        `;
        clearVirtualFocus();
        showKeyboard.mockClear();
        armTvNavigation();

        withRect(document.getElementById('before') as HTMLElement, {
            top: 0,
            bottom: 40,
            left: 0,
            right: 40,
        });
        withRect(document.getElementById('timeline') as HTMLElement, {
            top: 0,
            bottom: 40,
            left: 80,
            right: 280,
        });
    });

    afterEach(() => {
        clearVirtualFocus();
        document.body.innerHTML = '';
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    it('enters virtual adjustment on OK and releases it to the prior control on BACK', () => {
        const before = document.getElementById('before') as HTMLButtonElement;
        const timeline = document.getElementById(
            'timeline'
        ) as HTMLInputElement;
        before.focus();

        dispatch('right');
        expect(getVirtualFocus()).toBe(timeline);
        expect(document.activeElement).not.toBe(timeline);

        dispatch('ok');

        expect(getVirtualFocus()).toBe(timeline);
        expect(document.activeElement).not.toBe(timeline);
        expect(timeline.hasAttribute(TV_RANGE_ACTIVE_ATTRIBUTE)).toBe(true);
        expect(showKeyboard).not.toHaveBeenCalled();

        dispatch('back');

        expect(getVirtualFocus()).toBeNull();
        expect(timeline.hasAttribute(TV_RANGE_ACTIVE_ATTRIBUTE)).toBe(false);
        expect(document.activeElement).toBe(before);
        expect(showKeyboard).not.toHaveBeenCalled();
    });

    it('keeps a player control focused while the slider is virtually focused', () => {
        document.body.innerHTML = `
            <app-web-player-view>
                <app-player-controls>
                    <button id="player-before" type="button">Pause</button>
                    <input id="player-timeline" type="range" min="0" max="100" value="5" />
                </app-player-controls>
            </app-web-player-view>
        `;

        const before = document.getElementById(
            'player-before'
        ) as HTMLButtonElement;
        const timeline = document.getElementById(
            'player-timeline'
        ) as HTMLInputElement;
        withRect(before, { top: 0, bottom: 40, left: 0, right: 40 });
        withRect(timeline, { top: 0, bottom: 40, left: 80, right: 280 });

        before.focus();
        dispatch('right');

        expect(getVirtualFocus()).toBe(timeline);
        expect(document.activeElement).toBe(before);
        expect(document.activeElement).not.toBe(timeline);
    });

    it('adjusts only after OK and accelerates a held LEFT/RIGHT press', () => {
        const before = document.getElementById('before') as HTMLButtonElement;
        const timeline = document.getElementById(
            'timeline'
        ) as HTMLInputElement;
        const events: string[] = [];
        timeline.addEventListener('input', () => events.push('input'));
        timeline.addEventListener('change', () => events.push('change'));
        before.focus();
        dispatch('right');

        dispatch('right');
        expect(timeline.value).toBe('5');
        expect(events).toEqual([]);

        dispatch('ok');
        dispatch('right');
        expect(timeline.value).toBe('6');
        expect(events).toEqual(['input', 'change']);

        dispatch('right', 6);
        expect(timeline.value).toBe('8');
        dispatch('right', 15);
        expect(timeline.value).toBe('13');
        dispatch('right', 30);
        expect(timeline.value).toBe('23');
        dispatch('right', 60);
        expect(timeline.value).toBe('53');

        dispatch('left');
        expect(timeline.value).toBe('52');
        dispatch('left', 30);
        expect(timeline.value).toBe('42');
        expect(events).toHaveLength(14);
        expect(getVirtualFocus()).toBe(timeline);
        expect(timeline.hasAttribute(TV_RANGE_ACTIVE_ATTRIBUTE)).toBe(true);
    });
});
