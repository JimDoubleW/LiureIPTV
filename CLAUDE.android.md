# CLAUDE.android.md

Rules for the Android TV port. `CLAUDE.md` stays canonical for upstream
IPTVnator; this file only covers what the port adds or overrides.

Written from scratch against this tree (originally `androidtv/tvm-ui`, renamed
to `androidtv/main`; based on `master` at v0.23.0). Every claim below was
verified here, not carried over.

## Fork And Branch Model

| Branch | Role |
| --- | --- |
| `master` | Exact mirror of `upstream/master` (`4gray/iptvnator`). Never commit here. |
| `androidtv/main` | Port work. Branched from `master` (v0.23.0); renamed from `androidtv/tvm-ui`. |

`androidtv/main` used to name a different, abandoned first attempt (10 commits,
based on `v0.22.0`) — that branch was deleted and the name reused for the
current port line once the restart was confirmed done. Its tip is preserved at
tag `archive/androidtv-main-abandoned`, not the branch name `androidtv/main`
(see below).

Remotes: `origin` = the fork (`JimDoubleW/LiureIPTV`), `upstream` =
`4gray/iptvnator` with pushes disabled.

Refresh `master` with a fast-forward only — if it ever fails, something was
committed there by mistake:

```bash
git fetch upstream
git checkout master
git merge --ff-only upstream/master
git push origin master
```

Bring upstream into the port with **merge, never rebase**. The port branch is
long-lived; rebasing replays the same conflicts on every sync.

### Do not trigger upstream's release pipeline

Tag port builds `androidtv-v*`, **never** `v*`. Three workflows react to
upstream's release shape:

| Workflow | Fires on |
| --- | --- |
| `docker.yml` | tags `v*`, pushes to `master`, and **PRs touching `apps/web/**`, `libs/**`, `package.json`** |
| `build-and-make.yaml` | tags `v*.*.*` (creates a draft release), pushes to `master`, **PRs targeting `master`** |
| `publish-snap.yaml` | a release being *published* |

Note the second column: opening a PR from the port branch **into `master`**
fires the Docker image build and the desktop make/release job. Keep port PRs
off `master`, or expect those runs.

### The abandoned attempt

`archive/androidtv-main-abandoned` (a tag, **not** a branch — the branch name
`androidtv/main` was reused for the current port line, see above) carries an
earlier port (10 commits, based on tag `v0.22.0`): Capacitor shell, native HTTP
transport, D-pad spatial navigation, focus treatment, per-panel position
memory, progressive panel collapse. It was deliberately **not** carried
over — the restart is intentional.

Its documentation stayed there too and is worth reading before re-deriving
anything, since it records device measurements that cost real time — notably
`docs/android-port/epg-storage-load-test.md` (SQLite-in-WebView carrying a
million-row week of guide data with the JS heap flat at 20 MB):

```bash
git show archive/androidtv-main-abandoned:docs/android-port/epg-storage-load-test.md
```

The reference-player interaction benchmark was **re-observed on the device for
this branch** and lives here: [`docs/android-port/tv-navigation-reference.md`](./docs/android-port/tv-navigation-reference.md).
Prefer it over the `archive/androidtv-main-abandoned` copy, which is less
accurate.

## Fixed Bug: mat-select dropdowns unusable from a remote

Reported by the user for the language picker specifically, but the cause is
generic to every `mat-select` in the app (theme, cover size, startup view,
etc.) and worth understanding before touching key dispatch again.

`mat-select`'s open panel uses the ARIA 1.1 "activedescendant" combobox
pattern: real DOM focus never leaves the trigger (`document.activeElement`
stays `MAT-SELECT`), and an Angular `(keydown)` binding on that host element
moves `aria-activedescendant` in response to a genuine keydown event — it does
not rely on focus moving into option elements. Once the native key layer began
consuming every D-pad press before the WebView saw one, that binding stopped
firing entirely. Confirmed on-device: pressing DOWN in the open language list
left `aria-activedescendant` untouched and silently moved *real* focus onto an
unrelated "Visual theme" button via this engine's own geometric search, while
the dropdown itself never reacted.

Fix follows the same pattern already used for BACK/Escape: detect that a
native/Material control currently owns the keys, and dispatch a **real**
`KeyboardEvent` to it instead of running this engine's own logic —
`dispatchRealKey()` / `isNativeControlOpen()` in `tv-navigation.ts`.

Two traps, both worth remembering:

- **`onKeyDown`'s fallback listener must check this before Enter, not just
  before the direction branch.** An earlier version only guarded the arrow-key
  path; Enter went through `activate()` first, which calls
  `stopPropagation()` on success. Since `dispatchRealKey()` dispatches into the
  normal DOM event flow, that same document-level capture listener intercepts
  its OWN synthetic Enter before it ever reaches the mat-select trigger —
  caught by a unit test exercising `dispatchFromNative` end to end, not by
  testing the smaller helpers in isolation.
- **Do not assume Angular CDK's overlay lives under a global
  `.cdk-overlay-container`.** This app's mat-select renders its panel
  (`.cdk-overlay-pane`) as a direct child of the trigger itself
  (`cdk-overlay-popover`). A selector requiring that ancestor container never
  matched anything, so the first fix attempt passed its own (wrongly-assumed)
  unit tests yet still failed on the device — confirmed the pane is genuinely
  removed from the DOM on close (not just hidden), so matching
  `.cdk-overlay-pane` anywhere in the document is both simpler and safe.

Verified on the reference device: opening the language list, DOWN/DOWN/UP walks
`aria-activedescendant` through option 4 → 5 → 6 → 5 with focus staying on the
trigger throughout, and OK commits the highlighted option ("Français") and
closes the panel.

## Fixed Bug: Settings category list collapsed to 0×0

The user reported the search bar "seemed to prevent navigation" into the
Settings menu. It didn't — but something adjacent did, and it is worth reading
before reusing `aside.context-panel` styling/collapse logic elsewhere.

`aside.context-panel` is a shared workspace-shell wrapper, not something unique
to Live/VOD/Series browsing. The Settings page's own category list
(General/Playback/EPG/.../About) renders inside the identical wrapper class.
The progressive-collapse feature (`panel-region.ts`, `tv-focus.styles.ts`) used
to target that class unscoped, so as soon as focus had last resolved to the
'content' region — which happens almost immediately on most pages — it
collapsed the Settings category column to 0 width and marked it `inert`,
taking it out of the focus order entirely. Confirmed on-device:
`width=0 inert=true` on a fresh settings page load.

Fix: both the CSS collapse rule and `getContextPanel()`'s selector are now
`aside.context-panel:has(.category-item)`. `.category-item` is the class the
Live/VOD/Series category rows actually render with
(`workspace-context-category-view.component.html`); Settings' own
`.settings-section-item` rows don't carry it, so the Settings panel is excluded
from collapse/inert entirely and behaves like ordinary content. Verified on
device: `width=284 inert=false`, and once positioned on a category
(EPG/Playback/Dashboard/...), UP/DOWN walk the list correctly.

`:has()` needed checking against jsdom (used by the unit tests): confirmed
supported as of the workspace's jsdom 26.1.0.

## Fixed Bug: "Open settings" unreachable in the rail

Root cause and fix are worth reading before touching `focus-zones.ts` or the
rail markup again, because the failure mode is silent and only shows up as
"DOWN sometimes teleports backward" after enough real usage.

`resolveZone()` (per-panel position memory) walks up to the nearest `<nav>` or
`<aside>`. The rail's items are split across several small `<nav>` islands
(one per section grouping), but two links sit outside every island — the brand
link at the top, the settings link in the footer — so both fell through to the
same outer `<aside class="app-rail">` as their only landmark, aliasing them to
one shared memory slot. Whichever was focused more recently silently
overwrote the other's remembered position, so a `DOWN` press crossing into that
shared zone got redirected to it instead of the geometric target — reproduced
end to end as a deterministic 4-item cycle that skipped "Open settings"
entirely.

Fix: `resolveZone` now honours an explicit `[data-tv-zone]` ancestor before
falling back to the generic `<nav>`/`<aside>` walk, and `panel-region.ts` tags
`aside.app-rail` with one such zone on every focus move — unifying the whole
rail into a single memory slot, matching the mental model of "one vertical
list", not several independent panels.

## Fixed Bug: Settings sections aliased to one shared position memory

Reported by the user: selecting EPG in Settings then pressing RIGHT could show
unrelated content from a different section (Metadata) instead of EPG's own,
and separately — asked directly — Settings had no real per-section memory at
all.

Root cause: all eight Settings sections (General, Playback, EPG, Dashboard,
Metadata, Backup, Reset, About) render inside one shared scrollable zone
(`MAIN.workspace-content`, `scrollHeight 5496 / clientHeight 484`). Clicking a
category anchor-scrolls that SAME zone to a different section without
detaching or resizing anything, so `ZoneMemory.recall()`'s existing checks
(attached, non-zero size) both still passed for an element remembered from a
previous section, and there was only ever one memory slot for the whole page.

Two-part fix in `focus-zones.ts`: `recall()` now also requires the remembered
element to still intersect the viewport (attached-and-sized is not the same
as "still what's on screen" when one zone shows several sections one at a
time by scrolling itself rather than mounting/unmounting); and the landmark
selector now includes `section.settings-group` so each of the eight sections
resolves to its own zone — no `data-tv-zone` attribute needed, since
`zoneIdFor`'s WeakMap fallback already assigns distinct ids to distinct DOM
nodes. Verified on the reference device: EPG and Metadata now keep
independent remembered positions instead of aliasing to one shared slot.

## Fixed Bug: settings save silently failing on a rebounded remote

Reported by the user as a genuine, reproducible failure in normal use (not a
side effect of ADB testing, which was the first — wrong — hypothesis):
"Settings could not be saved. Your changes will be lost when the app is
restarted." First suspected to be from repeated `am force-stop` calls during
testing, but the user explicitly rejected that: the same banner blocks saving
config in ordinary use.

Two contributing gaps found while chasing this, both in the settings save
path:

1. `SettingsFormFacade.save()` had no re-entrancy guard. `MainActivity`'s
   `dispatchKeyEvent` fires `window.__tvKeyDispatch('ok')` once per
   `ACTION_DOWN` with `repeatCount == 0` — correct per the Android key-event
   contract — but a physical remote's IR receiver reporting one press as two
   discrete `ACTION_DOWN` events (a real possibility with cheap TV-box
   remotes) would still reach the app as two separate `'ok'` dispatches,
   firing two concurrent writes of the same form to IndexedDB.
2. `SettingsStore.updateSettings()` treated any single `storage.set()`
   rejection as final. `@ngx-pwa/local-storage`'s `IndexedDBDatabase` opens
   its connection once at construction and latches that outcome permanently
   in a `ReplaySubject`, but each `set()`/`get()` call still opens its own
   fresh transaction — so a single transient hiccup (the Android WebView
   backing store under load) only ever broke that one call, and a plain retry
   moments later reliably succeeded when reproduced on the reference device.

Fix: `SettingsFormFacade.save()` now ignores a second call while the first is
still in flight (`isSaving` flag, released in a `finally`), and
`SettingsStore.updateSettings()` retries once after a 200ms pause before
surfacing `storageFailure('save')`. Regression coverage:
`settings-form.facade.spec.ts` (concurrent-save guard) and
`settings-store.service.spec.ts` (`'recovers from a single transient save
failure without surfacing it'`).

**Both of the above were real improvements but not the actual cause** — the
user reproduced the identical banner immediately after this landed. Live CDP
inspection while the user triggered it again (theme → Save) showed the tell:
the theme persisted correctly to IndexedDB and the form ended up `ng-pristine`
(only reachable through `save()`'s success path) *while the failure snackbar
was still on screen*. The real bug: `android-epg-bridge.ts` installs a
partial, EPG-only `window.electron` so duck-typed capability probes
(`RuntimeCapabilitiesService`) light up the EPG paths — this makes
`window.electron` **truthy on Android**, just incomplete. `save()` gated its
desktop-mirroring block on `if (!window.electron)`, which is false on Android,
so it unconditionally called `window.electron.updateSettings(settings)` —
`updateSettings` does not exist on the EPG-only bridge, so this threw
`TypeError: ... is not a function` *after* the real save and `onSaved()` had
already succeeded, and `onSubmit()`'s catch turned that into the same
"could not be saved" banner for a save that, in fact, saved. Fix: gate on
`this.runtime.isElectron` (already Android-aware) instead of raw
`window.electron` truthiness — the same "duck-typed presence ≠ real Electron"
trap the EPG bridge's own doc comment warns about. Regression test:
`'does not call the missing desktop-mirror methods and resolves cleanly'` in
`settings-form.facade.spec.ts`, which sets `window.electron` to an
EPG-methods-only stub plus the Android Capacitor flag. General lesson: any
code that checks `window.electron` truthiness instead of
`RuntimeCapabilitiesService.isElectron` is a latent Android bug — the two are
no longer equivalent since the EPG bridge shipped, and grepping for `!window.electron`/`window.electron &&` outside `RuntimeCapabilitiesService`
is worth doing next time this class of report comes back.

## Fixed Bug: Xtream favorites and recent items silently failing on Android

Follow-up sweep after the settings-save bug above, grepping the codebase for
the same `window.electron` truthiness trap outside `RuntimeCapabilitiesService`.
Found two more real instances, both in the Xtream `signalStoreFeature`s that
back the per-playlist favorites and recently-viewed lists — reachable any time
a user favorites something or clears watch history, since Xtream is the
portal type this port actually routes (see Portal Transport above).

`with-favorites.feature.ts` (`toggleFavorite`, `checkFavoriteStatus`) and
`with-recent-items.ts` (`addRecentItem`) all resolve a `contentId` as
`content?.id ?? (!window.electron ? normalizedXtreamId : null)`. On Android,
`XTREAM_DATA_SOURCE` resolves to `PwaXtreamDataSource` (per-method capability
probes in `supportsXtreamSqliteDataSource` correctly see through the EPG-only
bridge), which returns `null` from `getContentByXtreamId` whenever an item
isn't already hydrated in the in-memory cache — normal on a cold list. The
Xtream-ID fallback exists for exactly this case, but `!window.electron` reads
false on Android, so the fallback resolved to `null` instead, and
`toggleFavorite`/`addRecentItem` silently no-op'd (logged, no visible error)
instead of favoriting or recording the item.

`with-recent-items.ts` (`clearRecentItems`, `clearGlobalRecentlyViewed`) had
the same trap in the other direction: `if (window.electron) { await
dbService.clear...() }` took the DB-backed branch on Android instead of the
`dataSource.clearRecentItems()` branch that actually owns the PWA in-memory
cache. `dbService`'s methods are internally guarded
(`typeof window.electron?.dbClearPlaylistRecentItems !== 'function'`), so
this didn't throw — it just silently cleared nothing, leaving "Clear recently
viewed" a no-op on Android with no error surfaced.

Fix: both files now `inject(RuntimeCapabilitiesService)` and gate on
`runtime.isElectron` instead of raw `window.electron` truthiness, same
pattern as the settings-save fix. Regression coverage: `describe('withFavorites
on the Android partial bridge', ...)` in `with-favorites.feature.spec.ts` and
`describe('withRecentItems on the Android partial bridge', ...)` in
`with-recent-items.feature.spec.ts`, both setting `window.electron` to an
EPG-methods-only stub plus the Android Capacitor flag.

Swept the rest of the codebase for the same shape (`grep` for bare
`window.electron`/`!window.electron` outside
`apps/web/src/app/services/android/**`) and reviewed every hit: everything
else already either checks a specific method
(`typeof window.electron?.methodName === 'function'`, which duck-types
correctly through the EPG-only bridge) or is genuinely Electron-only
functionality not reachable on Android (Embedded MPV, the global-favorites
Xtream aggregation page, which already returns `[]` via a doubly-guarded
`DatabaseService` call and has no other path to populate an Xtream row on
Android). Nothing else in that sweep changed behavior.

## Fixed Bug: "Select playlist" menu unreachable by remote

Reported by the user: opening the "Select playlist" dropdown, then unable to
reach or activate "+ Add playlist" with the D-pad. Confirmed on the reference
device: the menu opens (`aria-expanded="true"`, its `.cdk-overlay-pane`
exists), but arrow keys and OK do nothing inside it.

Root cause: this menu is a `mat-menu` used purely for positioning — its
Search/Add-playlist buttons carry no ARIA role at all, not built from
`[mat-menu-item]`. `isNativeControlOpen()` treated any open
`.cdk-overlay-pane` (and, separately, any element inside a bare
`[role="menu"]` container) as native-controlled and handed its keys to
`document.activeElement`. But real focus never actually leaves the trigger
for this panel — Angular Material only auto-focuses a panel's first item for
a keyboard-*initiated* open, and this engine's OK always synthesizes a
mouse-style click — and nothing inside the panel implements its own keydown
handling either, since it has no registered Material menu items. So both
buttons were being fed arrow keys and Enter meant for a panel they were never
actually inside: completely unreachable.

Fix, in `tv-navigation.ts`: `isNativeControlOpen()` now only defers to an
overlay that actually contains `role="option"`/`"menuitem"`/`"slider"`
descendants (real Material menuitems, mat-select's listbox, a slider) —
`findUnmanagedOverlay()` identifies an open overlay without them, and `move()`
scopes its own geometric search to it (its backdrop does not mark the rest of
the page `aria-hidden`, so an unscoped search would still reach background
content behind the dropdown). A bare `[role="menu"]` ancestor was removed
from the "always defer" check entirely — the role sits on every `mat-menu`
container regardless of what's inside it, so it never actually signalled
whether there was real keyboard handling to defer to.

Also fixed `goBack()`, found stale while investigating: it required an
overlay to sit under a global `.cdk-overlay-container`, which this app's
overlays never do (the same lesson the mat-select fix already recorded) — BACK
could not close this menu, or any overlay, at all, falling straight through to
the history/minimize branches instead.

Verified end to end on the reference device with genuine D-pad key presses:
Select playlist → OK opens the menu → DOWN, DOWN reaches "Add playlist" → OK
opens the Add Playlist dialog. Regression coverage:
`overlay-menu-keys.spec.ts` (new) plus a fixture fix in
`mat-select-keys.spec.ts`, whose "confirm the highlighted option" test had an
empty `.cdk-overlay-pane` that no longer matched real mat-select's actual
shape (a `role="option"` child) once the check became precise about it.

General lesson: `.cdk-overlay-pane` covers several unrelated widgets in this
app (mat-select, real Material menus, and at least one mat-menu used as a
plain positioning shell) — treating "an overlay is open" as one bucket keeps
producing this exact bug shape. What decides whether this engine should hand
off or drive it itself is whether the overlay's *content* has real ARIA roles
Material's own key manager acts on, never the presence of the overlay or a
`role="menu"` wrapper alone.

## TV Interaction Reference

D-pad behaviour, the four surfaces, the measured focus palette and the adoption
order are in
[`docs/android-port/tv-navigation-reference.md`](./docs/android-port/tv-navigation-reference.md).

The one rule to carry into every component: **each panel marks its own selection
with a low-contrast fill relative to that panel's background, and only the
focused panel promotes its selection to the near-white pill.** Three visual
states and per-panel position memory are the same mechanism, not two features.

## Minimize Conflict Surface

This is the rule that decides how expensive every future upstream sync will be.

- **Added files never conflict.** A new Nx app/lib can grow without limit and
  cost nothing at merge time.
- **Modified shared files conflict** every time upstream touches them.

So: prefer a new file plus a one-line hook at an existing injection point over
editing existing code in place. The main injection point is already there —
`DataFactory()` in `apps/web/src/app/app.config.ts:98` selects the environment
implementation at runtime, so an Android data service slots in beside
`ElectronService` and `PwaService` without touching either:

```typescript
export function DataFactory() {
    if (window.electron) {
        return inject(ElectronService);
    }
    return inject(PwaService);
}
```

Concretely: never scatter `if (isAndroid)` through components.

## Base Facts (v0.23.0)

Verified against this tree. **These correct the v0.22.0-era notes on
`archive/androidtv-main-abandoned`, which are stale here** — check before
trusting anything that tag says about repo structure.

- **A release-note gate exists.** `.changes/` is present and `ci.yml` runs a
  `release-note-gate` job: a PR needs a release note or a `no-release-note`
  label. `ci.yml` has 4 jobs — `actionlint`, `release-note-gate`, `lint`,
  `unit-and-typecheck`. 8 workflows total.
- **A `PlayerController` contract exists** (13 files under
  `libs/ui/playback/src/lib/player-controls/`). This is the single biggest
  difference from the old base, where it had zero occurrences repo-wide.
- `docs/architecture/vod-multi-source.md`,
  `docs/architecture/player-controls-contract.md` and
  `docs/architecture/embedded-inline-playback.md` are all present.
- **Capacitor 8.4.2** (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`)
  and the `android/` project are in place — see below.

## Building and running the APK

```bash
pnpm nx build web --configuration=pwa   # must run first: Capacitor copies dist/apps/web
npx cap sync android

cd android
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=$HOME/Android/Sdk
./gradlew assembleDebug
adb -s <box>:5555 install -r app/build/outputs/apk/debug/app-debug.apk
```

Two toolchain traps on this machine:

- **JDK 21 is required.** The default JDK is 25, which AGP 8.13 rejects. Nothing
  in the error message points at the JDK version.
- **`ANDROID_HOME` must be exported.** `android/local.properties` is generated
  per-machine and git-ignored, so a fresh clone has no `sdk.dir`.

`android/.gitignore` (generated) already covers `build/`, `.gradle/`,
`local.properties` and the copied web assets, so only the ~50 source files are
tracked.

### Verifying that a change actually reached the device

Three failure modes here look identical from the UI — the change simply has no
effect — and each cost a debugging cycle:

- **A failed build leaves the previous `dist/` in place.** Filtering the build
  output for `ERROR` is not enough; check the exit code. `nx build` returning 1
  while the pipeline carries on packaging the old bundle is silent.
- **`npx cap sync` copies without cleaning.** Orphan chunks from earlier syncs
  stay in `android/app/src/main/assets/public`, so grepping that directory for a
  new rule gives a false positive — the chunk is there but `index.html` does not
  reference it. Compare against `dist/`, or `rm -rf` the assets directory first.
- **The service worker used to serve a stale bundle**, which is why it is now
  disabled in the shell.

The reliable check is inside the WebView: read back what the app actually
loaded, e.g. `document.getElementById('tv-focus-styles').textContent`.

**The stylesheet is a JS template literal.** Backticks inside its comments end
the string and produce a wall of unrelated type errors far from the real cause.
Escape them.

### Baseline before any navigation work

Measured on the reference device with the first APK from this branch: pressing
`DPAD_DOWN`, `DPAD_DOWN`, `DPAD_RIGHT` produces **no visible focus change
anywhere** — the app has no focus ring and is entirely unnavigable by remote.
That is the zero point the D-pad work has to move.

## Target Hardware

Reference device: **Xiaomi TV Box S (3rd Gen)**, model `MiTV-AFMU0` — Amlogic
S905X5M, 4× Cortex-A55 @ 2.5 GHz, Mali-G310 V2, **2 GB RAM**, 32 GB storage,
Android TV **14 (API 34)**.

Two consequences that should drive design decisions:

- **All cores are in-order efficiency cores.** JavaScript is single-threaded, so
  extra cores do not help the main thread. Heavy SPA work is the worst-case
  profile for this SoC.
- **2 GB RAM shared with the OS** leaves roughly 700 MB–1 GB. Large playlists
  held in NgRx state *and* in storage risk the low-memory killer, not just
  slowness. The JS heap ceiling measured on the device is 497 MB.

Hardware decode (AV1/VP9/HEVC 4K60) is not a concern as long as playback goes
through MSE. Raw MPEG-TS is: it is demuxed in JavaScript by `mpegts.js`, and
that is the workload most likely to fail on an A55.

## Decisions

**Architecture: Capacitor.** The Angular app is wrapped in a Capacitor Android
app; there is no native rewrite. Environment specifics arrive as a third
`DataService` implementation selected by the existing `DataFactory()`.

Settled by measurement on the reference device, running the production PWA build
served from the dev machine:

| Measurement | Result |
| --- | --- |
| Raw MPEG-TS live playback | OK |
| Memory stability, 20 min continuous | OK on 2 GB shared |
| Scrolling 6 000 live + 6 000 VOD entries | OK |
| Cold start | OK |

No hardware ceiling was found. These figures are pessimistic for Capacitor,
which loads assets from local storage, issues native HTTP, and drops the CORS
proxy entirely.

*Test hygiene:* make sure no other client is using the IPTV subscription during
a measurement, or the provider's concurrent-connection limit is what gets
measured. This produced one false "device too slow" result.

**Playback engine: native ExoPlayer/Media3**, behind a Capacitor plugin, from
the start — not as a fallback. On the reference device the WebView plays 4K
streams with audio only, no video, while the SoC decodes HEVC/AV1 4K60 in
hardware. The limit is the WebView plus JavaScript demuxing, not the silicon.
ExoPlayer talks to the platform decoder directly and handles raw TS natively.

**Cost note — cheaper than on the old base.** `PlayerController` now exists, so
ExoPlayer *plugs into* an abstraction instead of having to create one. The shape
to implement is in
`libs/ui/playback/src/lib/player-controls/player-controls.model.ts`: a
`PlayerStatus` union plus a `PlayerControlsCapabilities` flag set (`seek`,
`volume`, `audioTracks`, `subtitles`, `playbackSpeed`, `aspectRatio`,
`recording`, `pictureInPicture`, `fullscreen`, `seriesNavigation`) — a control
renders only when its flag is true, so an engine may legitimately support a
subset. Two adapters already exist as precedent:

- `web-video-controls.adapter.ts` — the in-WebView engines
- `embedded-mpv-controls.adapter.ts` — an out-of-process native engine, the
  closer analogue, including bounds-sync plumbing that an ExoPlayer
  `SurfaceView` under a transparent WebView needs too

Engine *selection* is still an `@if` chain in
`libs/ui/playback/src/lib/web-player-view/web-player-view.component.html`.
Contract: `docs/architecture/player-controls-contract.md`.

## WebView Origin Contract

Serve the app from **`http://localhost`** (`server.androidScheme: 'http'`), not
https. Verified on device — do not "fix" it.

- `http://localhost` is a *potentially trustworthy* origin, so the page still
  gets a **secure context**: `isSecureContext`, `MediaSource`, EME and
  `crypto.subtle` are all present. Nothing the players need is lost.
- Under `https://localhost`, Chromium's mixed-content **autoupgrade** blocks
  `<img src="http://…">` outright, even with `allowMixedContent: true` — which
  hides every provider logo in an ecosystem that is overwhelmingly plain http.
  `fetch`/XHR were unaffected; only images were.
- `allowMixedContent: true` is still required: without it `fetch`/XHR to
  `http://` origins are refused. It pairs with `usesCleartextTraffic="true"` in
  `AndroidManifest.xml`, which is what unblocks the native HTTP stack under a
  modern `targetSdk`.

Two traps found the hard way:

- Capacitor reads the scheme from **`server.androidScheme`**. Putting it under
  `android` is silently ignored (`CapConfig.java:254`) and you get the `https`
  default with no warning.
- Changing the scheme changes the origin, so `localStorage`/IndexedDB written
  under the old origin become unreachable. Run `adb shell pm clear <appId>` when
  switching, and treat any future scheme change as a data migration.

## Out Of Scope

Not ported, and not worth reading when working on Android: Embedded MPV (native
addon, frame-copy helper, Snap/Flatpak/DEB packaging), external MPV/VLC process
control, `electron-updater`, window controls, and native file dialogs.

## Local Test Setup

**The `web-backend` is no longer needed.** It exists only to work around CORS in
a browser; native HTTP is not subject to CORS, so the shell talks to providers
directly and the box is self-contained. `BACKEND_URL` in
`apps/web/src/assets/app-config.js` is now irrelevant on Android — leave it
alone, and never commit a local edit to that tracked file.

Still useful:

- ADB over network does not survive a box reboot: toggle ADB debugging off/on in
  Developer options.
- Inspect the WebView with
  `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then drive
  it over the DevTools websocket. This is the only way to tell a stale bundle,
  a CORS refusal and a dead network apart — all three look identical from the
  UI, and two of them cost a debugging cycle here before the WebView was
  inspected.

## Workspace Landmarks

Verified in the running app, because guessing here cost a debugging cycle:

| Element | x | width (of 960 dp) |
| --- | --- | --- |
| `aside.app-rail` (wraps `nav.rail-links`) | 0 | 60 |
| `header.workspace-header` | 60 | 900 — spans the full content width |
| `aside.context-panel` | 60 | 322 |
| `main.workspace-content` | 382 | 578 |

Two traps in that table. **The rail is an `<aside>` too**, so a bare `aside`
selector collapses the rail along with the category column, and testing
`closest('aside')` before `closest('nav')` puts rail items in the wrong region.
And the header spans everything, so an element's x coordinate says nothing about
which panel it belongs to.

Progressive collapse is driven by `panel-region.ts`, which publishes
`data-tv-region` on the document element; the stylesheet narrows
`aside.context-panel` when the region is `content`. It narrows to a strip rather
than to zero on purpose: a zero-width panel has zero-sized children, candidate
collection drops them, and left would have nothing to move to.

## EPG

Capabilities are duck-typed: `RuntimeCapabilitiesService` asks "is
`window.electron.fetchEpg` a function?", never "is this Electron?". The shell
exploits that with a **partial, EPG-only bridge** installed at `window.electron`
before bootstrap (`services/android/android-epg-bridge.ts`). It lights up the
EPG paths and nothing else, because every other capability probes for methods
the bridge deliberately lacks.

Two injection points carry an explicit Android exception, and both are
load-bearing — a truthy `window.electron` would otherwise select
`ElectronService` (which calls dozens of IPC methods that do not exist) and
relabel the environment as Electron:

- `DataFactory()` in `apps/web/src/app/app.config.ts`
- `RuntimeCapabilitiesService.isElectron`

**Stage 1 (done).** The Xtream EPG's primary source is the portal API
(`get_short_epg`), which already rides the native HTTP transport — the app was
simply refusing to ask, because the UI gates the whole path behind
`supportsEpg`. Programme titles, times and live progress bars now render in the
channel list. Manual channel mappings are real and persist in `localStorage`.

**Stage 2 (done): XMLTV import and storage**, in `services/android/epg/`.
SQLite in the WebView via `@capacitor-community/sqlite`, chosen by measurement
(`git show archive/androidtv-main-abandoned:docs/android-port/epg-storage-load-test.md`:
1M rows, JS heap flat at 20 MB).

Design points that are load-bearing rather than stylistic:

- **Streaming SAX parse, emitting in 500-row batches.** Collecting a million
  programmes before writing would trade the flat heap for hundreds of MB.
- **Multi-row `INSERT ... VALUES`.** Bridge crossings dominate; one statement
  per batch instead of 500 round trips.
- **Indexes dropped for the import and rebuilt after** — maintaining them per
  row costs far more than the measured 14 s rebuild. Rebuilt on failure too, or
  every later query would scan.
- **Never wrap the column in `datetime()`, and bound the window on both sides.**
  Confirmed on-device with `EXPLAIN QUERY PLAN`: our shape reports
  `SEARCH ... USING INDEX idx_epg_programs_channel`, the `datetime()` form
  reports `SCAN`.
- **`connection.execute` takes one statement at a time.** The plugin's own
  multi-statement splitter does not survive statements spanning several lines:
  a semicolon-joined batch of three `CREATE TABLE`s created only the first, and
  failed silently — the missing tables surfaced much later as "no such table".

Both query-shape findings apply to the desktop code as well.

## Portal Transport

Portal traffic bypasses the proxy through `PortalDirectInterceptor`
(`apps/web/src/app/services/android/`), with `CapacitorHttp` enabled in
`capacitor.config.ts` so `fetch`/XHR go through the native stack.

The interceptor keeps the proxy's *contract* while removing the proxy: it
answers `POST /provider-targets` locally from an in-memory registry, and rewrites
`GET /xtream?targetId=…` into a direct `player_api.php` call, re-wrapping the
response in the `{action, payload}` envelope. `PwaService` therefore keeps all
its error normalisation, debug logging and result shaping unchanged.

An interceptor rather than a `DataService` subclass, because `PwaService` marks
`http` private and owns a lot of behaviour worth reusing. Consequence: only
Xtream is routed so far — **Stalker and M3U parsing still point at the proxy**
and need the same treatment.

## Open Questions

- **EPG is Electron-only and unported.** Every `supportsEpg*` capability probes a
  `window.electron` method. The storage route was already settled by measurement
  on `archive/androidtv-main-abandoned` (SQLite in the WebView) — read that load
  test before re-deciding.
- **Catalogue payload headroom is unmeasured.** The bridge can hold several
  copies of a large `get_vod_streams` body on a ~1 GB budget.
- **Stalker transport** was never implemented in the first attempt (it rejected
  explicitly).
- **4K diagnosis deferred.** Not established whether the WebView failure is
  HEVC-specific or resolution-specific, nor whether `mpegts.js` or the WebView's
  exposed decoders are the blocker. Does not affect the decisions above.
- ~~Text inputs and the IME~~ — **solved natively.** `MainActivity.dispatchKeyEvent`
  consumes the D-pad before the WebView can run its own focus search, and
  forwards each press to `window.__tvKeyDispatch`. Fields are traversed with
  virtual focus (no IME), OK promotes to real focus and asks for the keyboard
  through `@capacitor/keyboard` (a JS `focus()` from `evaluateJavascript` is
  not a user gesture, so the IME ignores it), typing works, BACK closes, and
  while the IME is visible the native layer hands every key back to it. A
  search *destination* remains the better long-term UX, but inline fields are
  no longer a trap.
