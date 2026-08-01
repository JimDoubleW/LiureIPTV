import { resolveZone, SELECTED_ATTRIBUTE, ZoneMemory } from './focus-zones';

function build(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body;
}

function byId(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`missing test fixture #${id}`);
    }
    return element;
}

/** jsdom reports every rect as 0x0, which `recall` treats as unusable. */
function withSize(element: HTMLElement, width = 100, height = 40): HTMLElement {
    element.getBoundingClientRect = () =>
        ({ width, height, left: 0, top: 0, right: width, bottom: height }) as DOMRect;
    return element;
}

describe('focus zones', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    describe('resolveZone', () => {
        it('gives each Settings section its own zone', () => {
            // All eight sections share one scroll container; without this each
            // one fell back to that shared container as its zone, so visiting
            // Metadata silently discarded whatever was remembered for EPG —
            // reported by the user, confirmed on the reference device.
            build(`
                <main>
                    <section id="epg" class="settings-group"><button id="epgBtn"></button></section>
                    <section id="tmdb" class="settings-group"><button id="tmdbBtn"></button></section>
                </main>
            `);

            const epgZone = resolveZone(byId('epgBtn'));
            const tmdbZone = resolveZone(byId('tmdbBtn'));

            expect(epgZone).toBe(document.getElementById('epg'));
            expect(tmdbZone).toBe(document.getElementById('tmdb'));
            expect(epgZone).not.toBe(tmdbZone);
        });

        it('keeps each Settings section remembering its own position', () => {
            build(`
                <main>
                    <section id="epg" class="settings-group"><button id="epgBtn"></button></section>
                    <section id="tmdb" class="settings-group"><button id="tmdbBtn"></button></section>
                </main>
            `);
            const epgBtn = withSize(byId('epgBtn'));
            const tmdbBtn = withSize(byId('tmdbBtn'));
            const memory = new ZoneMemory();

            memory.remember(epgBtn);
            memory.remember(tmdbBtn);

            // Visiting tmdb must not have overwritten epg's remembered slot —
            // the pre-fix behaviour, since both shared one zone.
            expect(memory.recall(resolveZone(epgBtn))).toBe(epgBtn);
            expect(memory.recall(resolveZone(tmdbBtn))).toBe(tmdbBtn);
        });

        it('lets an explicit tag win over a nav nested inside it', () => {
            // This is what unifies the rail: it is tagged, but its sections are
            // separate <nav> islands, and <nav> matches the landmark selector
            // too. Without this priority, the nearer <nav> would still win the
            // walk before reaching the tagged ancestor.
            build(`
                <div data-tv-zone="rail">
                    <a id="orphan"></a>
                    <nav><button id="in-nav"></button></nav>
                </div>
            `);

            const zoneRoot = document.querySelector('[data-tv-zone="rail"]');

            expect(resolveZone(byId('orphan'))).toBe(zoneRoot);
            expect(resolveZone(byId('in-nav'))).toBe(zoneRoot);
        });


        it('groups elements under their nearest landmark', () => {
            build(`
                <nav id="rail"><button id="a"></button></nav>
                <aside id="panel"><button id="b"></button></aside>
            `);

            const rail = byId('rail');
            const panel = byId('panel');

            expect(resolveZone(byId('a'))).toBe(rail);
            expect(resolveZone(byId('b'))).toBe(panel);
        });

        it('honours an explicit data-tv-zone over an outer landmark', () => {
            build(`
                <nav id="outer">
                    <div data-tv-zone="groups" id="inner">
                        <button id="a"></button>
                    </div>
                </nav>
            `);

            expect(resolveZone(byId('a'))).toBe(
                byId('inner')
            );
        });

        it('falls back to the body so every element has exactly one zone', () => {
            build('<div><button id="a"></button></div>');

            expect(resolveZone(byId('a'))).toBe(document.body);
        });
    });

    describe('ZoneMemory', () => {
        it('marks the remembered element and moves the mark within a zone', () => {
            build('<nav><button id="a"></button><button id="b"></button></nav>');
            const a = withSize(byId('a'));
            const b = withSize(byId('b'));
            const memory = new ZoneMemory();

            memory.remember(a);
            expect(a.hasAttribute(SELECTED_ATTRIBUTE)).toBe(true);

            memory.remember(b);
            expect(a.hasAttribute(SELECTED_ATTRIBUTE)).toBe(false);
            expect(b.hasAttribute(SELECTED_ATTRIBUTE)).toBe(true);
        });

        it('keeps one selection per zone simultaneously', () => {
            build(`
                <nav id="rail"><button id="a"></button></nav>
                <aside id="panel"><button id="b"></button></aside>
            `);
            const a = withSize(byId('a'));
            const b = withSize(byId('b'));
            const memory = new ZoneMemory();

            memory.remember(a);
            memory.remember(b);

            // The rail keeps its mark while focus lives in the panel — this is
            // what makes returning to a panel land where you left it.
            expect(a.hasAttribute(SELECTED_ATTRIBUTE)).toBe(true);
            expect(b.hasAttribute(SELECTED_ATTRIBUTE)).toBe(true);
            expect(memory.recall(byId('rail'))).toBe(a);
            expect(memory.recall(byId('panel'))).toBe(b);
        });

        it('recalls nothing for a zone never visited', () => {
            build('<nav id="rail"><button id="a"></button></nav>');

            expect(new ZoneMemory().recall(byId('rail'))).toBeNull();
        });

        it('forgets an element detached by virtual scrolling', () => {
            build('<nav id="rail"><button id="a"></button></nav>');
            const rail = byId('rail');
            const a = withSize(byId('a'));
            const memory = new ZoneMemory();

            memory.remember(a);
            a.remove();

            // Falling back to geometry beats focusing a node that is gone.
            expect(memory.recall(rail)).toBeNull();
        });

        it('ignores a remembered element that has collapsed to zero size', () => {
            build('<nav id="rail"><button id="a"></button></nav>');
            const rail = byId('rail');
            const a = withSize(byId('a'), 0, 0);
            const memory = new ZoneMemory();

            memory.remember(a);

            expect(memory.recall(rail)).toBeNull();
        });

        it('ignores a remembered element scrolled out of view within its own zone', () => {
            // Regression: Settings' content pane is one big scroll container
            // (scrollHeight 5496 / clientHeight 484 on the reference device)
            // shared by all eight of its sections. Clicking a different
            // category anchor-scrolls that SAME zone to a different section
            // without detaching or resizing anything, so a remembered element
            // from the section visited last still passed every check above
            // while sitting far outside the viewport — confirmed on-device:
            // selecting Metadaten then pressing right recalled a button from
            // the EPG section instead of Metadaten's own content.
            build('<main id="content"><button id="epgButton"></button></main>');
            const content = byId('content');
            const epgButton = byId('epgButton');
            epgButton.getBoundingClientRect = () =>
                ({
                    width: 100,
                    height: 40,
                    left: 50,
                    top: -2000,
                    right: 150,
                    bottom: -1960,
                }) as DOMRect;
            const memory = new ZoneMemory();

            memory.remember(epgButton);

            expect(memory.recall(content)).toBeNull();
        });

        it('still recalls a remembered element that is genuinely on screen', () => {
            build('<nav id="rail"><button id="a"></button></nav>');
            const rail = byId('rail');
            const a = withSize(byId('a'));
            const memory = new ZoneMemory();

            memory.remember(a);

            expect(memory.recall(rail)).toBe(a);
        });
    });
});
