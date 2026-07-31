import { SELECTED_ATTRIBUTE } from './focus-zones';

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
}

/*
 * Programmatic focus() does not always satisfy :focus-visible, and every focus
 * move here is programmatic, so this keys off :focus.
 */
[data-tv-nav] :focus {
    outline: 3px solid var(--tv-focus-fill);
    outline-offset: 2px;
    border-radius: var(--tv-focus-radius);
    background-color: var(--tv-focus-fill);
    color: var(--tv-focus-ink);
}

/*
 * Descendants normally carry their own colour, so the dark ink has to be
 * pushed down for the filled pill to stay legible. Media keeps its own
 * rendering: a poster must not be repainted.
 */
[data-tv-nav] :focus :not(img):not(video):not(svg):not(svg *) {
    color: var(--tv-focus-ink);
}

[data-tv-nav] [${SELECTED_ATTRIBUTE}]:not(:focus) {
    background-color: var(--tv-selected-fill);
    border-radius: var(--tv-focus-radius);
}

/*
 * The browser's own focus ring would otherwise double up with ours.
 */
[data-tv-nav] :focus:not(:focus-visible) {
    outline: 3px solid var(--tv-focus-fill);
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
