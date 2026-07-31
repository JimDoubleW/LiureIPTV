import { SELECTED_ATTRIBUTE } from './focus-zones';
import { REGION_ATTRIBUTE } from './panel-region';
import { VIRTUAL_FOCUS_ATTRIBUTE } from './virtual-focus';

/**
 * The three focus states, measured off the TiviMate benchmark.
 * See docs/android-port/tv-navigation-reference.md.
 *
 * | state                   | rendering                                  |
 * | ----------------------- | ------------------------------------------ |
 * | focused                 | near-white fill, dark text, ring            |
 * | selected, not focused   | low-contrast fill over the panel background |
 * | neutral                 | nothing                                     |
 *
 * The "selected" fill is a translucent white rather than a fixed grey. That is
 * a faithful translation of what was measured: the benchmark's fill is defined
 * relative to each panel's own background (+21 over #060606 in one column,
 * +40 over #1D1D1D in another), and a translucent overlay reproduces that
 * automatically instead of hard-coding one grey per panel.
 *
 * A filled shape, not a ring, is the point: at three metres an outline competes
 * with artwork and card borders, while a filled shape reads instantly. The ring
 * is kept as well because it is the only cue that survives on media tiles,
 * where a background fill sits behind the artwork and is invisible.
 */
const TV_FOCUS_CSS = `
:root {
    --tv-focus-fill: #dedfe1;
    --tv-focus-ink: #0a0a0a;
    --tv-selected-fill: rgba(255, 255, 255, 0.1);
    --tv-focus-radius: 8px;
    --tv-collapsed-panel: 0px;
    --tv-rail-expanded: 210px;
}

/*
 * Everything below is declared !important, which is deliberate and not
 * laziness.
 *
 * This is an override layer injected at bootstrap, before Angular emits any
 * component styles. \`[data-tv-nav] :focus\` weighs exactly as much as a class
 * such as \`.mat-mdc-raised-button\`, so on that tie the cascade decides — and
 * Material, loading later, wins every time. The first version of this file lost
 * silently that way: the ring showed because nothing competed for \`outline\`,
 * while the fill never applied at all.
 *
 * Programmatic focus() does not reliably satisfy :focus-visible either, and
 * every move here is programmatic, so these key off :focus.
 *
 * Text fields never take real focus while navigating — that would open the
 * Android keyboard — so they carry a marker attribute instead and are styled
 * identically here. See virtual-focus.ts.
 */
[data-tv-nav] :focus,
[data-tv-nav] [${VIRTUAL_FOCUS_ATTRIBUTE}] {
    background-color: var(--tv-focus-fill) !important;
    color: var(--tv-focus-ink) !important;
    outline: 3px solid var(--tv-focus-fill) !important;
    outline-offset: 2px !important;
    border-radius: var(--tv-focus-radius) !important;
}

/*
 * Descendants carry their own colour, so the dark ink has to be pushed down for
 * the filled pill to stay legible. Media is left alone: a poster or a channel
 * logo must not be repainted.
 */
[data-tv-nav] :focus *:not(img):not(video):not(svg):not(svg *),
[data-tv-nav] [${VIRTUAL_FOCUS_ATTRIBUTE}] *:not(img):not(video):not(svg):not(svg *) {
    color: var(--tv-focus-ink) !important;
}

/*
 * Material paints button and list backgrounds on inner ripple layers rather
 * than on the element itself. Those sit above our fill and would hide it.
 */
[data-tv-nav] :focus .mat-mdc-button-persistent-ripple::before,
[data-tv-nav] :focus .mat-mdc-button-ripple,
[data-tv-nav] :focus .mdc-button__ripple,
[data-tv-nav] :focus .mat-mdc-list-item-unscoped-content,
[data-tv-nav] :focus .mat-ripple {
    background-color: transparent !important;
}

/*
 * The selection each panel keeps while focus is elsewhere. Translucent white so
 * the lift is computed against whatever that panel's own background happens to
 * be, which is how the benchmark behaves.
 */
[data-tv-nav] [${SELECTED_ATTRIBUTE}]:not(:focus) {
    background-color: var(--tv-selected-fill) !important;
    border-radius: var(--tv-focus-radius) !important;
}

/*
 * Progressive panel collapse.
 *
 * On a 960 dp-wide TV the category column takes a third of the screen and keeps
 * it even while the user is three panels away. Once focus reaches the content,
 * the column narrows and the content takes the space back.
 *
 * The column folds away completely. Width alone would not be safe — clipped
 * children keep their layout box and stay focusable while invisible — so
 * panel-region.ts marks the collapsed panel \`inert\`, and tv-navigation.ts
 * unfolds it when the user presses left with nowhere else to go.
 *
 * The selector names the category column explicitly because the rail is an
 * \`<aside>\` too: a bare \`aside\` collapsed both, the rail included.
 */
[data-tv-nav][${REGION_ATTRIBUTE}="content"] aside.context-panel {
    max-width: var(--tv-collapsed-panel) !important;
    min-width: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
    border: 0 !important;
    overflow: hidden !important;
}

[data-tv-nav] aside.context-panel {
    transition: max-width 180ms ease-out !important;
}

/*
 * The rail is the mirror image: it earns its labels while it is being used and
 * gives the width back the moment focus leaves.
 *
 * The labels are synthesised from \`aria-label\`, because there is nothing to
 * reveal — the links hold an icon and an accessible name, with no visible text
 * node anywhere. That also means the wording is whatever the accessible name
 * says ("Open dashboard" rather than "Dashboard"); shortening it belongs in the
 * component, not in an override layer.
 */
/*
 * The shell is a grid whose first column is pinned at 60px. Widening the rail
 * element alone changed nothing visible: it simply overflowed its cell and was
 * painted underneath the next column, so the labels appeared clipped to two
 * characters. The column is what has to grow.
 */
[data-tv-nav] div.workspace-shell {
    transition: grid-template-columns 180ms ease-out !important;
}

[data-tv-nav][${REGION_ATTRIBUTE}="rail"] div.workspace-shell {
    grid-template-columns: var(--tv-rail-expanded) 1fr !important;
}

[data-tv-nav][${REGION_ATTRIBUTE}="rail"] aside.app-rail {
    width: 100% !important;
    max-width: none !important;
}

/*
 * Widening the <nav> groups is not enough on its own: the lower two live inside
 * a \`.rail-context-region\` wrapper that carries its own narrow width, so they
 * kept their icon-sized column and truncated their labels while the top group
 * expanded normally.
 */
[data-tv-nav][${REGION_ATTRIBUTE}="rail"] aside.app-rail nav,
[data-tv-nav][${REGION_ATTRIBUTE}="rail"] aside.app-rail div.rail-context-region {
    width: 100% !important;
    max-width: none !important;
    align-items: stretch !important;
}

[data-tv-nav][${REGION_ATTRIBUTE}="rail"] aside.app-rail a[aria-label],
[data-tv-nav][${REGION_ATTRIBUTE}="rail"] aside.app-rail button[aria-label] {
    display: flex !important;
    align-items: center !important;
    gap: 12px !important;
    justify-content: flex-start !important;
    width: 100% !important;
    padding-left: 10px !important;
}

[data-tv-nav][${REGION_ATTRIBUTE}="rail"] aside.app-rail a[aria-label]::after,
[data-tv-nav][${REGION_ATTRIBUTE}="rail"] aside.app-rail button[aria-label]::after {
    content: attr(aria-label);
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
`;

const STYLE_ELEMENT_ID = 'tv-focus-styles';

/**
 * Installs the focus styling and flags the document so the rules apply. The
 * `[data-tv-nav]` gate means nothing changes for the PWA or Electron builds
 * even if this module is ever loaded there.
 */
export function installTvFocusStyles(): void {
    if (document.getElementById(STYLE_ELEMENT_ID)) {
        return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = TV_FOCUS_CSS;
    document.head.appendChild(style);

    document.documentElement.setAttribute('data-tv-nav', '');
}
