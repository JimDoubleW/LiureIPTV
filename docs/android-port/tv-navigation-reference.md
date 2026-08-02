# TV Navigation Reference

Interaction patterns observed on a reference IPTV player app running on the
reference device (Xiaomi TV Box S 3rd Gen, Android TV 14, 1920×1080 @ density
320 → **960×540 dp** of logical surface), used as a benchmark for the Android TV
port.

## Method and scope

Everything below was **read off the screen**: the app was driven over ADB with
`input keyevent`, and each state captured with `screencap`. Colours and
geometries are pixel measurements taken from those captures.

Nothing here comes from decompilation, or from inspecting the other
application's code, resources or assets. These are conventions of the Android TV
platform and observable behaviour, not anyone's implementation.

## Four surfaces, not one screen

The single biggest structural finding. The app is not "a screen with panels" —
it has four distinct surfaces reached by different keys:

| Surface | Reached by | Contents |
| --- | --- | --- |
| **Playback** | app launch, or `BACK` from anywhere | fullscreen video, no chrome |
| **Channel overlay** | `DPAD_LEFT` from playback | two translucent columns over still-playing video |
| **Guide** | `BACK` from playback | opaque: nav rail + groups + timeline grid + video preview |
| **Transport OSD** | `OK` from playback | now-playing card + seek bar + quick-access rail |
| **Context menu** | `MENU` | right-hand sheet, sectioned by focused item |

The app **starts in playback**, not in a menu. `BACK` is a global "step back /
close", never a menu opener.

There is **no single "menu" — one key per intent**, each opening a surface built
for that intent. This is the deepest structural lesson of the benchmark, and the
hardest to retrofit: our app funnels everything through one navigation shell.

Note the asymmetry that cost the most time to establish: **the navigation rail
exists only on the Guide surface.** The channel overlay has no rail. Treating
them as one screen with a collapsing rail is wrong.

## Channel overlay: a sliding two-column master–detail

`DPAD_LEFT` from playback opens a translucent overlay. Exactly **two columns are
ever visible**, and they slide over a three-level hierarchy:

| Focus | Left column | Right column |
| --- | --- | --- |
| after 1× `LEFT` | **channels** (focused) | EPG schedule of the focused channel |
| after 2× `LEFT` | **groups** (focused) | channel list of the focused group |

So the focused level is always the *left* column and the right column is its
detail/preview. Moving left reveals the parent and sheds the detail; moving
right does the reverse. The video keeps playing behind, unobscured on the right
third.

A floating card at the top right shows the current programme with a progress bar
and remaining time ("23 min").

## Guide: rail + groups + timeline grid

`BACK` from playback opens an opaque guide:

- **nav rail** — collapsed to a ~56 dp icon strip when unfocused; **expands to
  ~220 dp with labels when focused** (the app's own home entry, Rechercher, TV,
  Films, Séries, Enregistrements, Ma liste, and Paramètres pinned at the
  bottom). Expanding pushes the whole content right, and the grid visibly loses
  time slots.
- **groups column** — the same list as in the overlay.
- **timeline grid** — channels as rows, time as columns, a ruler
  (`ven. 31 juil., 16:45 | 16:30 | 17:00`) and a blue vertical *now* line.
- **video preview** — a thumbnail of the running channel, top left, with the
  programme title and progress beside it.

This is the progressive-collapse pattern: screen width is the scarce resource on
a TV, and a panel only pays for its labels while it is being used.

## Focus treatment: one mechanism, three states

The most transferable detail, and the one most often mis-described. Measured
fills:

| State | Fill | Panel background | Δ luminance |
| --- | --- | --- | --- |
| **Focused** | `#DEDFE1` near-white, dark text | any | maximal |
| **Selected, not focused** (groups column) | `#1B1B1B` | `#060606` | +21 |
| **Selected, not focused** (guide grid) | `#454545` | `#1D1D1D` | +40 |
| Neutral | no fill | — | — |

The rule: **every panel keeps its own selection marked with a very low-contrast
fill computed against that panel's own background; only the focused panel
promotes its selection to the near-white pill.**

"Three visual states" and "per-panel position memory" are therefore *not two
features* — they are one mechanism. Implementing the selected-but-not-focused
fill is what makes position memory visible, and position memory is what makes
the fill meaningful.

Two further details:

- A **filled shape, not a ring.** At three metres an outline competes with
  artwork and card borders; a filled pill reads instantly.
- In the guide the highlight is **two-level**: the focused *row* takes the
  subtle wash and, inside it, the focused *cell* takes the near-white pill.

## Transport OSD: `OK` from playback

`OK` over fullscreen video raises a three-band layer without interrupting
playback:

1. **Now-playing card** (top) — channel number, logo and name; programme title;
   time range, progress bar and remaining time; group name; the **next**
   programme on its own line; and **inline technical badges** (`1280x720`,
   `25 FPS`, `STÉRÉO`).
2. **Seek bar** (middle) — full-width, with a position marker; the timeshift
   affordance.
3. **Quick-access rail** (bottom) — a horizontal strip that mixes **actions
   first, then content**: `Guide TV`, `Historique`, followed by
   recently-watched channels as tiles, each showing its logo, name and current
   programme in blue. A chevron indicates further rows below.

The rail does not expand further — the chevron is a scroll affordance for that
strip, not a second row. `OK` on a history tile zaps straight to that channel.

Two things worth stealing: the technical badges (we surface stream diagnostics
nowhere), and the zap history as a first-class rail — returning to a recent
channel is one press away, without opening any list.

## Zapping needs no surface at all

From fullscreen, with no overlay open:

| Key | Effect |
| --- | --- |
| `DPAD_UP` | next channel (higher number) |
| `DPAD_DOWN` | previous channel (lower number) |

This is the cheapest interaction in the app and the one users spend the most
presses on. It costs no layout, no route change and no list — worth wiring
before any of the panel work.

## Blue marks the focused row; ▶ marks playing

These are two different signals and it is easy to conflate them, because in the
first states you land on they coincide — the channel you are playing is also the
row you are on.

Isolated by moving one row down in the guide: the previous row's channel name
returned to white and the new row's turned blue, while playback did not change.
So:

- **`#2196F3` (Material Blue 500) on the channel number and name = the focused
  row**, an identity cue for "the row these programme cells belong to".
- **`▶` = the channel currently playing.** No colour of its own; it survives
  being scrolled past and never competes with the focus pill.
- **`⟲`** marks channels with catch-up available.

In the channel overlay the *subtitle* also carries state, and this one is
semantic: the current programme in blue when EPG is known, a grey "Pas
d'information" when it is not.

## `OK` commits a level and sheds the chrome

Focus movement alone does not produce the widest layout — **`OK` does**.
Pressing `OK` on a group in the guide:

- **collapses the rail *and* the groups column away entirely**, giving the grid
  the full width — it went from 2 visible time slots to 5 (16:30 → 18:30);
- repopulates the grid with that group's channels;
- moves focus into the grid, onto the current programme of the first channel;
- turns the top band into a **rich detail panel**: preview thumbnail, title,
  time range, progress bar, remaining time, **full synopsis**, group name, and a
  ★ favourite glyph.

So there are two distinct width-recovery mechanisms: *focus* expands and
collapses the rail continuously, and *`OK`* commits to a level and drops the
navigation chrome wholesale. `BACK` brings it back.

### `OK` is contextual

`OK` does not mean one thing — it is dispatched on the type of the focused item:

| Focused item | Effect of `OK` |
| --- | --- |
| a **group** | commit the level, collapse rail + groups, grid takes full width |
| an airing cell, channel **not** playing | tune to that channel and **keep the guide open** |
| an airing cell, channel **already** playing | **go fullscreen**, close the guide |

The last two rows are the same key on the same cell: `OK` is a **two-step
gesture**. The first press tunes without leaving the guide; only the second
commits to fullscreen.

This is the single most important interaction to copy, because it inverts the
web reflex. In our app, activating a channel navigates and destroys the list. In
the reference player the first activation **previews in place** and the list
survives, so comparing three channels costs three presses instead of three
round trips through a route.

The unifying rule across all three rows: **`OK` advances one step deeper; when
the focused item is already the active one, `OK` commits to the deepest state.**

Tuning from the grid never leaves the guide: the preview thumbnail and the
detail panel follow the new channel, a `▶` appears on its row, and browsing
continues uninterrupted. This is the "preview keeps playing" pattern doing real
work — zapping is not a mode change.

One layout detail worth copying: the channel label truncates to make room for
the `▶` ("|FR| FRANCE 2 HD" → "|FR| FRANCE 2") rather than the channel column
widening. Column widths stay fixed; content yields.

## Guide fill ladder

Measured in the grid, four steps:

| Element | Fill |
| --- | --- |
| grid background | `#060606` |
| ordinary programme cell | `#151515` |
| cell in the **focused row** | `#3E3E3E` |
| the **focused cell** | `#DEDFE1` (dark text) |

Programme cells left of the *now* line are additionally dimmed.

## Search and settings are destinations

`MENU` opens a right-hand sheet, **sectioned by the focused item**:

| Section | Entries |
| --- | --- |
| global | Rechercher (as a field-shaped entry), Paramètres |
| focused *programme* | Ouvrir dans un lecteur externe, Enregistrer, Enregistrement personnalisé |
| focused *channel* | Retirer des Favoris, Bloquer, Masquer, Attribuer EPG, Options de Chaîne |

Search is also a first-class rail entry. It is **never an inline text field in a
header**. This independently confirms the conclusion the port reached the hard
way: focusing a text input opens the Android IME, which halves the viewport and
swallows the remote's key events before the WebView sees them. A search
*destination* is the platform-idiomatic answer.

The section headers are the *names* of the focused programme and channel, which
is what makes a single menu key sufficient for every context.

## The preview keeps playing

**Where our app already matches, measured on the device:** playback survives
every move *inside* the live section — walking the grid, crossing into the
category column, even switching category. That is where nearly all browsing
happens, so the pattern is largely already in place.

**Where it does not:** the player lives in the routed live layout, so leaving
for Movies or Series destroys it. Returning now resumes the channel
automatically (`LivePlaybackMemoryService`), but video does stop while the user
is in another section. True cross-section persistence needs the player hoisted
into the workspace shell, which touches components upstream rewrites often — a
deliberate trade, not an oversight.


Video runs continuously throughout browsing — the overlay is translucent over
it, and the guide keeps it as a thumbnail. Exploring never stops playback.
Expensive for us, since our player is tied to the route, but it is the expected
behaviour on this platform.

## Adoption order

Ranked by value against cost for this port:

1. **Filled-pill focus** (`#DEDFE1`, dark text) instead of an outline ring —
   pure styling.
2. **Per-panel selection fill** at +20–40 luminance over each panel's own
   background — this is position memory made visible, and the biggest single
   gain in how the app *feels*.
3. **"Playing" as blue text + ▶**, not a badge.
4. **Search as a destination** — also removes a known dead end (the IME trap).
5. **Two-column sliding master–detail** for the channel overlay.
6. **Rail that expands on focus** — touches the workspace shell layout.
7. **Persistent video preview** — touches routing and the player host.

Items 1–3 are additive styling and state, so they stay clear of the shared
components upstream keeps changing.

## Implemented in the port

The playback side of this contract now exists in the Android engine
(`apps/web/src/app/services/android/player-keys.ts`):

| Gesture | Status |
| --- | --- |
| OK first press on a channel — tune, list survives | done (was already the app's click behaviour) |
| OK second press on the playing channel, or on the player — fullscreen | done, as *layout* fullscreen: key presses arrive via `evaluateJavascript`, which carries no user activation, so `requestFullscreen` rejects — the player host is pinned `fixed inset:0` behind a `data-tv-fullscreen` attribute instead. `enterFullscreen()` refuses when nothing is playing, and that test must name **every** engine's surface: the Android native engine has no `<video>` at all (ExoPlayer draws into a SurfaceView; the DOM holds only a bounds placeholder), so a `video`-only check silently made fullscreen unreachable on the port's default engine |
| UP/DOWN over fullscreen video — next/previous channel | done, by activating the adjacent `.channel-list-item` row; no-op when virtual scrolling has dropped the active row |
| LEFT over fullscreen video — reveal the channel list | done (exits the layout fullscreen) |
| BACK over fullscreen video — step back to the list | done; runs before the overlay/history branches, or BACK would leave the page |
| OK over fullscreen video — raise the transport layer | partly: OK focuses the first transport button, which is what reveals the shared controls bar (it reveals on `focusin` and stays up while focus is inside). Directions then move between the buttons and OK activates one. Not the benchmark's three-band OSD — no now-playing card, no technical badges — but the transport itself is reachable. **Live and on-demand behave the same here.** While the bar has focus the directions belong to it, so live stops zapping until the idle timeout drops focus and gives the channel keys back |

**On-demand playback is not live playback.** A locked fullscreen (movies and
series, see `TV_FULLSCREEN_LOCKED_ATTRIBUTE`) has no channel list to zap
through and no list layout to return to, so `handleFullscreenDirection` yields
every direction to the ordinary spatial search instead of claiming it. Claiming
them was worse than doing nothing: each press was consumed and nothing moved,
leaving the remote inert apart from BACK. Two traps found on the device while
fixing that:

- **OK must focus a button, never "the first focusable thing".** The seek bar
  is an `<input type="range">`, and focusing an input raises the soft keyboard
  on the reference device — at which point `MainActivity` hands every D-pad key
  to the IME and the remote stops reaching the app at all. The symptom looks
  exactly like a dead remote.
- **`enterFullscreen()` reports success when already fullscreen**, so the
  existing `isInsidePlayer` branch swallowed OK and left Pause unpressable —
  every transport control sits inside the player view. That branch now runs
  only *before* fullscreen. Scoping it to the on-demand lock instead was not
  enough and regressed live: the same swallow, on the same branch, for the
  same reason.
- **The bar never went away again.** It hides on a timer but pins itself open
  while focus is inside — right for a pointer, which moves on by itself, but a
  remote's focus has nowhere else to go while the shell is blanked, so the
  controls sat over the film for good. `armPlayerControlsIdleHide` drops focus
  after 5s of remote silence, which releases the pin and lets the bar's own
  `focusout` handler schedule the hide it always would have. Re-armed on every
  press, so it measures idleness rather than age.

## Raw key map observed

| Key | From playback | From overlay | From guide |
| --- | --- | --- | --- |
| `DPAD_UP` | next channel | move focus up | move focus up |
| `DPAD_DOWN` | previous channel | move focus down | move focus down |
| `DPAD_LEFT` | open channel overlay | move to parent level | move focus left; onto rail → rail expands |
| `DPAD_RIGHT` | — | move to detail level | move focus right |
| `OK` | open transport OSD | activate (two-step) | activate (two-step) |
| `BACK` | open guide | close overlay → playback | close guide → playback |
| `MENU` | context menu | context menu | context menu |

Returning to a surface **restores where you were**: leaving the guide for
fullscreen and coming back reopens it on the group you had committed to, not on
the first group, with the playing channel still marked.
