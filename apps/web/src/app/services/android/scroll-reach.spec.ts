import { canScrollFurther } from './scroll-reach';

function box(props: Partial<Record<string, number>>): Element {
    return {
        scrollTop: 0,
        scrollLeft: 0,
        clientHeight: 100,
        clientWidth: 100,
        scrollHeight: 100,
        scrollWidth: 100,
        ...props,
    } as unknown as Element;
}

describe('scroll reach', () => {
    describe('canScrollFurther', () => {
        it('reports room below when content overflows', () => {
            expect(canScrollFurther(box({ scrollHeight: 400 }), 'down')).toBe(true);
        });

        it('reports no room below once at the end', () => {
            expect(
                canScrollFurther(box({ scrollHeight: 400, scrollTop: 300 }), 'down')
            ).toBe(false);
        });

        it('ignores sub-pixel overflow, which is layout noise not content', () => {
            // Otherwise every page claims it can scroll and the engine keeps
            // "revealing" nothing instead of stopping at the edge.
            expect(canScrollFurther(box({ scrollHeight: 101 }), 'down')).toBe(false);
        });

        it('reports room above only when actually scrolled', () => {
            expect(canScrollFurther(box({ scrollTop: 50 }), 'up')).toBe(true);
            expect(canScrollFurther(box({ scrollTop: 0 }), 'up')).toBe(false);
        });

        it('handles the horizontal axis independently', () => {
            expect(canScrollFurther(box({ scrollWidth: 400 }), 'right')).toBe(true);
            expect(canScrollFurther(box({ scrollWidth: 400 }), 'left')).toBe(false);
        });
    });
});
