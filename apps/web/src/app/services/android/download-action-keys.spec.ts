import { armTvNavigation } from './tv-navigation';

HTMLElement.prototype.scrollIntoView ??= () => undefined;

function dispatch(key: string): void {
    (
        window as Window & { __tvKeyDispatch?: (key: string) => void }
    ).__tvKeyDispatch?.(key);
}

describe('native key dispatch inside action cards', () => {
    beforeEach(() => {
        (window as unknown as { Capacitor: { getPlatform(): string } }).Capacitor =
            { getPlatform: () => 'android' };
        document.body.innerHTML = `
            <div id="card" data-tv-action-card role="button" tabindex="0">
                Downloaded movie
                <div data-tv-action-row>
                    <button id="copy">Copy URL</button>
                    <button id="remove">Remove</button>
                </div>
            </div>
        `;
        document.documentElement.removeAttribute('data-tv-nav');
        armTvNavigation();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete (window as { Capacitor?: unknown }).Capacitor;
    });

    it('enters and walks nested actions with RIGHT', () => {
        const card = document.getElementById('card') as HTMLElement;
        const copy = document.getElementById('copy');
        const remove = document.getElementById('remove');
        card.focus();

        dispatch('right');
        expect(document.activeElement).toBe(copy);

        dispatch('right');
        expect(document.activeElement).toBe(remove);
    });

    it('walks back to the card with LEFT', () => {
        const card = document.getElementById('card') as HTMLElement;
        const copy = document.getElementById('copy') as HTMLElement;
        const remove = document.getElementById('remove') as HTMLElement;
        remove.focus();

        dispatch('left');
        expect(document.activeElement).toBe(copy);

        dispatch('left');
        expect(document.activeElement).toBe(card);
    });

    it('activates the focused nested action with OK', () => {
        const remove = document.getElementById('remove') as HTMLElement;
        const clicked = jest.fn();
        remove.addEventListener('click', clicked);
        remove.focus();

        dispatch('ok');

        expect(clicked).toHaveBeenCalledTimes(1);
    });
});
