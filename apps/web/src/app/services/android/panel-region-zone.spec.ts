import { applyRegion } from './panel-region';
import { resolveZone } from './focus-zones';

function byId(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`missing test fixture #${id}`);
    }
    return element;
}

/**
 * Regression coverage for the "Open settings unreachable" bug: two links
 * outside every `<nav>` island (the brand link, the settings footer) aliased
 * to the same outer-`<aside>` zone, so whichever was focused more recently
 * silently overwrote the other's remembered position. Confirmed on the
 * reference device: DOWN from the rail's last item cycled through four
 * remembered slots instead of reaching "Open settings".
 */
describe('rail zone unification', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <aside class="app-rail">
                <a id="brand" href="/dashboard"></a>
                <nav><a id="dashboard"></a><a id="recently-viewed"></a></nav>
                <nav><a id="movies"></a><a id="series"></a></nav>
                <div class="rail-footer"><a id="settings" href="/settings"></a></div>
            </aside>
        `;
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('gives every rail item the same zone once tagged', () => {
        applyRegion(byId('brand'));

        const rail = document.querySelector('aside.app-rail');
        const zones = [
            'brand',
            'dashboard',
            'recently-viewed',
            'movies',
            'series',
            'settings',
        ].map((id) => resolveZone(byId(id)));

        expect(zones.every((zone) => zone === rail)).toBe(true);
    });

    it('tags the rail lazily, so it works from the very first focus move', () => {
        // Nothing calls applyRegion before this — simulating the first key
        // press of a session, before any prior navigation could have tagged it.
        expect(resolveZone(byId('settings'))).not.toBe(byId('brand'));

        applyRegion(byId('settings'));

        expect(resolveZone(byId('settings'))).toBe(
            document.querySelector('aside.app-rail')
        );
    });
});
