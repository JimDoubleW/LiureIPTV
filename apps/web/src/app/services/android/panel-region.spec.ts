import {
    applyRegion,
    expandContext,
    isRegionCrossingAllowed,
    REGION_ATTRIBUTE,
    resolveRegion,
} from './panel-region';

function byId(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`missing test fixture #${id}`);
    }
    return element;
}

describe('panel region', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <aside class="app-rail"><nav><button id="rail-item"></button></nav></aside>
            <aside><button id="category"></button></aside>
            <main><button id="tile"></button></main>
        `;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        document.documentElement.removeAttribute(REGION_ATTRIBUTE);
    });

    it.each([
        ['rail-item', 'rail'],
        ['category', 'context'],
        ['tile', 'content'],
    ])('places #%s in the %s region', (id, expected) => {
        expect(resolveRegion(byId(id))).toBe(expected);
    });

    it('keeps the rail out of the context region', () => {
        // The rail is an <aside> wrapping its <nav>. Reading `aside` first put
        // rail items in the context region and collapsed the rail itself.
        document.body.innerHTML =
            '<aside class="app-rail"><nav><button id="link"></button></nav></aside>';

        expect(resolveRegion(byId('link'))).toBe('rail');
    });

    it('recognises rail items that sit outside its <nav>', () => {
        // The brand link at the top of the rail is not inside the <nav>, so
        // matching on <nav> alone reported the context region and the rail
        // never expanded.
        document.body.innerHTML =
            '<aside class="app-rail"><a id="brand" aria-label="Open dashboard"></a><nav></nav></aside>';

        expect(resolveRegion(byId('brand'))).toBe('rail');
    });

    it('prefers content when landmarks nest', () => {
        // Collapsing a panel that contains the focus would pull the ground out
        // from under the user, so `main` has to win.
        document.body.innerHTML =
            '<aside><main><button id="nested"></button></main></aside>';

        expect(resolveRegion(byId('nested'))).toBe('content');
    });

    it('does not treat chrome outside every landmark as content', () => {
        // A toolbar or dialog must not collapse the category column behind it.
        document.body.innerHTML = '<div><button id="loose"></button></div>';

        expect(resolveRegion(byId('loose'))).toBe('context');
    });

    describe('collapsing the category column', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <aside class="context-panel"><button id="category"></button></aside>
                <main><button id="tile"></button></main>
            `;
        });

        it('makes the collapsed column inert', () => {
            // Width alone is not enough: clipped children keep their layout box
            // and stay focusable while invisible, so focus would vanish into a
            // panel nobody can see.
            applyRegion(byId('tile'));

            const panel = document.querySelector('aside.context-panel');
            expect(panel?.hasAttribute('inert')).toBe(true);
        });

        it('restores it as soon as focus leaves the content', () => {
            applyRegion(byId('tile'));
            applyRegion(byId('category'));

            const panel = document.querySelector('aside.context-panel');
            expect(panel?.hasAttribute('inert')).toBe(false);
        });

        it('unfolds on demand so left has somewhere to go', () => {
            applyRegion(byId('tile'));

            const panel = expandContext();

            expect(panel?.hasAttribute('inert')).toBe(false);
            expect(document.documentElement.getAttribute(REGION_ATTRIBUTE)).toBe(
                'context'
            );
        });

        it('reports nothing to unfold when the column is absent', () => {
            document.body.innerHTML = '<main></main>';

            expect(expandContext()).toBeNull();
        });
    });

    describe('isRegionCrossingAllowed', () => {
        beforeEach(() => {
            document.body.innerHTML = `
                <aside class="app-rail"><nav><a id="rail-link"></a></nav></aside>
                <main><button id="play"></button><button id="more"></button></main>
            `;
        });

        it('blocks vertical moves into the rail', () => {
            // The rail spans the full height, so it is the spatial neighbour of
            // everything; without this rule, down from a detail page's back
            // button scored a rail link above the Play button.
            expect(
                isRegionCrossingAllowed(byId('play'), byId('rail-link'), 'down')
            ).toBe(false);
        });

        it('blocks vertical moves out of the rail', () => {
            expect(
                isRegionCrossingAllowed(byId('rail-link'), byId('play'), 'up')
            ).toBe(false);
        });

        it('keeps vertical moves within a region', () => {
            expect(isRegionCrossingAllowed(byId('play'), byId('more'), 'down')).toBe(
                true
            );
        });

        it('leaves horizontal crossings alone — that is what left/right are for', () => {
            expect(
                isRegionCrossingAllowed(byId('play'), byId('rail-link'), 'left')
            ).toBe(true);
        });
    });

    it('publishes the region on the document element', () => {
        applyRegion(byId('tile'));

        expect(document.documentElement.getAttribute(REGION_ATTRIBUTE)).toBe(
            'content'
        );
    });
});
