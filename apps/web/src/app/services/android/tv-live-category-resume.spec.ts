import { resolveTrayCategoryTarget } from './tv-live-category-resume';

describe('resolveTrayCategoryTarget', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('is pending when the category panel has not rendered yet', () => {
        expect(resolveTrayCategoryTarget()).toEqual({ kind: 'pending' });
    });

    it('is pending when a resume id is known but its category has not rendered', () => {
        document.body.innerHTML = `
            <aside class="context-panel">
                <button class="category-item" data-category-id="10">
                    Cat A
                </button>
            </aside>
            <div data-tv-resume-category-id="20"></div>
        `;

        expect(resolveTrayCategoryTarget()).toEqual({ kind: 'pending' });
    });

    it('resolves the resume category once it renders', () => {
        document.body.innerHTML = `
            <aside class="context-panel">
                <button class="category-item" data-category-id="10">
                    Cat A
                </button>
                <button class="category-item" data-category-id="20">
                    Cat B
                </button>
            </aside>
            <div data-tv-resume-category-id="20"></div>
        `;
        const catB = document.querySelector(
            'button.category-item[data-category-id="20"]'
        );

        expect(resolveTrayCategoryTarget()).toEqual({
            kind: 'resume',
            category: catB,
        });
    });

    it('falls back to the first category once resume waiting is turned off', () => {
        // The caller passes this once its own retry budget is spent, rather
        // than waiting on a resume category that may never render.
        document.body.innerHTML = `
            <aside class="context-panel">
                <button class="category-item" data-category-id="10">
                    Cat A
                </button>
            </aside>
            <div data-tv-resume-category-id="999"></div>
        `;
        const catA = document.querySelector(
            'button.category-item[data-category-id="10"]'
        );

        expect(
            resolveTrayCategoryTarget({ awaitResume: false })
        ).toEqual({ kind: 'first', category: catA });
    });

    it('resolves the first category directly once the route has mounted with nothing playing', () => {
        document.body.innerHTML = `
            <aside class="context-panel">
                <button class="category-item" data-category-id="10">
                    Cat A
                </button>
            </aside>
            <div class="content-container"></div>
        `;
        const catA = document.querySelector(
            'button.category-item[data-category-id="10"]'
        );

        expect(resolveTrayCategoryTarget()).toEqual({
            kind: 'first',
            category: catA,
        });
    });

    it('stays pending when the live route has not mounted at all yet, even with a stale panel already showing a category', () => {
        // Root cause traced on the reference box: the category panel is a
        // persistent workspace-shell fixture that survives route navigation.
        // Right after a tray click it still shows the *previous* section's
        // own real, clickable first category — exactly what this fixture
        // reproduces — while the live route (and its resume marker) has not
        // mounted at all yet. Angular omits `[attr.x]` entirely for a null
        // value, so an absent resume marker looks identical whether nothing
        // has ever played or the route simply has not rendered yet; only
        // `.content-container`'s own presence tells them apart.
        document.body.innerHTML = `
            <aside class="context-panel">
                <button class="category-item" data-category-id="2">
                    Stale category from the previous section
                </button>
            </aside>
        `;

        expect(resolveTrayCategoryTarget()).toEqual({ kind: 'pending' });
    });

    it('ignores a disabled resume category and keeps waiting', () => {
        document.body.innerHTML = `
            <aside class="context-panel">
                <button class="category-item" data-category-id="20" disabled>
                    Cat B
                </button>
            </aside>
            <div data-tv-resume-category-id="20"></div>
        `;

        expect(resolveTrayCategoryTarget()).toEqual({ kind: 'pending' });
    });
});
