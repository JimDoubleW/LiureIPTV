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
    });
});
