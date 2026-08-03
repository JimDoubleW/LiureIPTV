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

## Fixed Bug: MatDialog action buttons unreachable by remote

Reported by the user while adding Xtream credentials: impossible to reach
Clear, Cancel, Test Connection, or Add in the Add Playlist dialog with the
D-pad.

Root cause, in `focus-zones.ts`: `mat-dialog-content` only got its own
position-memory zone by accident, when its fields happened to overflow
(`isScrollContainer`) — a short dialog's fields would not — and
`mat-dialog-actions` never did, since it has no overflow of its own. Both fell
through to the same `document.body` catch-all zone shared by anything else on
the page with no landmark — the same shape as the rail-zone and Settings-zone
bugs above, on a third kind of container.

Confirmed on the reference device: pressing DOWN from the Password field
correctly found the geometrically-nearest button (Cancel) — `move()`'s
overlay-scoped `collectCandidates` (see the previous fix) worked as intended —
but since Cancel's zone (`document.body`) differed from Password's
(`mat-dialog-content`), the destination came from `memory.recall(body-zone)`
instead of Cancel itself, recalling whatever unrelated element had been
remembered there last (the active method-selector card, in this case). Every
button was unreachable in favour of a stale, unrelated recall — geometry was
finding the right answer and zone-memory was overriding it.

Fix: add `mat-dialog-content` and `mat-dialog-actions` — genuine Angular
Material custom element tags, not app-specific classes — to the landmark
selector, so every dialog's content and its action-button row each get their
own zone regardless of whether the content happens to overflow. This fixes
the same shape in every `MatDialog` with an actions row, not just this one.

Verified end to end on the reference device with genuine D-pad key presses:
DOWN from Password now correctly reaches Cancel, LEFT/RIGHT moves between
Cancel and Clear, and OK on Cancel closes the dialog. Separately noticed but
NOT a bug: with Test Connection/Add still disabled (required fields empty),
RIGHT from Cancel lands on a distant method-selector card instead of stopping
— disabled buttons are correctly excluded from candidates, and once nothing
usable remains in the same row, the engine's general "best remaining
candidate anywhere" fallback picks whatever scores least-bad, which happens to
be a tab card here. Once the form is actually filled in and Test
Connection/Add are enabled, they win normally on proximity.

General lesson, worth checking any time a "can't reach button X" report names
a dialog or panel with actions at the bottom: `resolveZone`'s reliance on
`isScrollContainer` as an implicit landmark is fragile — it only fires when a
container happens to overflow, so anything that doesn't overflow (a short
form, a fixed action row) silently falls back to the global `document.body`
zone and inherits whatever unrelated thing was last remembered there.
Structural, always-present tags (`mat-dialog-content`, `mat-dialog-actions`,
and likely `mat-expansion-panel`, `mat-tab-body`, or similar Material
containers if the same report recurs elsewhere) are the fix, not another
scroll-container special case.

## Fixed Bug: Settings checkboxes unreachable and non-toggling

Reported by the user: "checkboxes don't work" in Settings — checked broadly
rather than chasing one instance, since the report named no specific control.
Confirmed on the reference device: all 16 `mat-checkbox`es across every
Settings section (General, Playback, EPG, Dashboard, Metadata) were either
unreachable or silently failed to toggle. Two separate bugs stacked in
`spatial-candidates.ts`'s `collectCandidates()`:

1. **Unreachable at all.** `mat-checkbox` (and `mat-radio-button`,
   `mat-slide-toggle` — the same Material pattern) renders its real, tabbable
   native `<input>` at `opacity: 0` and paints the visible mark on a sibling —
   a standard technique for a custom-styled native control, not a sign it is
   actually hidden. The outer `<mat-checkbox>` has `cursor: auto` (not
   `pointer`) and no tabindex, so only that transparent input could ever
   qualify as a candidate, and the opacity check rejected it exactly like a
   genuinely hidden element. A real browser's own Tab order does not exclude
   `opacity: 0` either — only `display: none`/`visibility: hidden` remove an
   element from it. Fix: `isVisible()` now only applies the opacity check to
   elements the browser does not already focus natively
   (`isNativelyFocusable`); layout presence and `visibility`/`display` still
   gate every element, native or not.
2. **Reachable but silently failed to toggle.** Once (1) was fixed, the
   checkbox's internal `div.mdc-checkbox` — `cursor: pointer`, `tabindex="-1"`,
   exactly overlapping the real input — still qualified as its *own*
   candidate via `isPointerWidgetRoot`. Document order lists a parent before
   its children, so this wrapper was always discovered before the input it
   wraps, and `findBestCandidate` keeps the first candidate on a score tie —
   it always won at the identical spot. Clicking it did not toggle anything.
   Fix: `collectCandidates()` now also skips a pointer-widget-root when a
   natively-focusable descendant exactly fills its rect
   (`wrapsFullyOverlappingFocusableDescendant`) — a card that is *larger*
   than its own inner button (e.g. a VOD card and its Play button) still
   legitimately keeps both reachable, since the two rects do not coincide.

Verified end to end on the reference device with genuine D-pad presses:
toggled all 16 checkboxes across every section. General lesson: `tabindex="-1"`
on an element is **not** treated as an exclusion signal anywhere in this
engine, deliberately — `ensureFocusable` stamps that exact value onto every
clickable div it has ever focused, so using it to mean "author opted this out
of focus" would make previously-focused tiles unreachable on a second visit.
The overlap check above is what actually distinguishes Material's own
non-focusable styling shell from this engine's bookkeeping.

## Fixed Bug: playlist backup export failed on Android

Reported by the user: "Export playlist backups fails". Two stacked problems,
fixed in separate commits.

**1. The export crashed before it could save.** Confirmed on the reference
device: exporting a backup with an Xtream playlist threw
`window.electron.dbGetAllCategories is not a function`. Root cause:
`PlaylistBackupService.hasElectronApi()` gated on bare `!!window.electron`
instead of `RuntimeCapabilitiesService.isElectron` — the same trap fixed
twice already this session (settings save, Xtream favorites/recent items).
`window.electron` is truthy on Android too (the partial, EPG-only bridge), so
`buildXtreamEntry()`/`applyXtreamRestoreState()` both skipped their designed
non-Electron branch and called straight into `getAllXtreamCategories()`,
which calls `window.electron.dbGetAllCategories` with no guard of its own.
Fix: gate on `runtime.isElectron` instead.

**2. Even once export succeeded, no file reached anywhere findable.** The
browser download fallback (`Blob` + `<a download>`) has no native
`DownloadListener` registered to catch it in the Capacitor WebView, and no
`Filesystem`-backed write to a shared Downloads folder is possible without a
permission prompt on modern Android — confirmed on the reference device by
checking `/sdcard/Download` and the app's own storage after a "successful"
export: nothing was there. Fix: added `@capacitor/filesystem` and
`@capacitor/share`. On Android, `exportData()` now writes the backup into the
app's own cache dir (no permission needed) and hands it to the native share
sheet, so the user can actually put the file somewhere (a files app,
LocalSend, email, Drive) — the same reason other TV IPTV apps hand backups
off to a share sheet rather than a Downloads folder that is not reliably
browsable on a TV. Verified end to end: exporting opens the native Android
share sheet with the backup file ready to hand off.

**Testing note for next time a Capacitor plugin needs mocking**:
`jest.unstable_mockModule` — the ESM-correct API this project otherwise uses
for `apps/web`'s ESM jest preset — did not reliably intercept
`@capacitor/filesystem`/`@capacitor/share` here, even called before a dynamic
`import()` of the module under test (the documented-safe pattern). Fell back
to the same static `moduleNameMapper` stub mechanism already used for
`video.js` (`apps/web/src/test-stubs/capacitor-*.js`), which worked
immediately. Try `moduleNameMapper` first for a Capacitor plugin, not
`unstable_mockModule`.

## Fixed Bug: playlist backup import unreachable on Android

Follow-up to the export fix above. The user asked "Et le Import alors ?" after
export was fixed — same feature, opposite direction.

Confirmed on the reference device with two independent input methods, to rule
out a CDP-specific artifact before treating it as a real bug: a CDP `.click()`
on Settings' Import button, and (separately) seeding real DOM focus on that
button and sending a genuine ADB hardware key event
(`input keyevent KEYCODE_DPAD_CENTER`). Both produced the identical result — the
button visibly focused, nothing else happened, no file chooser ever appeared.

Root cause: `importData()` opens Android's native file picker via
`<input type="file">.click()`, which — like the Fullscreen API and the IME
before it (see the EPG section and the base-facts entry on text input) —
requires genuine user activation. A click dispatched from
`WebView#evaluateJavascript` (how `MainActivity.dispatchKeyEvent` forwards every
D-pad OK press to the JS engine) carries none, so the picker silently refuses
to open. This makes Import structurally unreachable by remote regardless of how
good D-pad navigation gets — no focus-engine fix could have solved this, unlike
every other bug in this section.

Fix, symmetric to the export share-sheet: register the app as an Android share
target instead of asking for a picker. A file manager's "Share" action carries
real OS-level user activation, sidestepping the chooser entirely.

- `AndroidManifest.xml`: a second `<intent-filter>` on `MainActivity` for
  `android.intent.action.SEND` + `application/json`, so the app appears in the
  system share sheet for JSON files (matching exactly what `@capacitor/share`
  produces for our own exported backup — the export→import round trip stays
  internally consistent).
- New custom Capacitor plugin, `BackupImportPlugin.java`
  (`android/app/src/main/java/com/liureiptv/tv/`): overrides
  `handleOnNewIntent(Intent)`, reads the shared file via
  `ContentResolver#openInputStream` on `EXTRA_STREAM`, and calls
  `notifyListeners("backupImportReceived", data, true)`. The `true`
  (`retainUntilConsumed`) is what makes this simpler than it looks: Capacitor's
  own `Plugin` base class buffers the event until a JS listener registers, so
  there is no need to hand-roll Electron's pending/awaitingAck queue
  (`playlist-open-request.ts`) — that machinery exists there because a
  renderer can reload or crash independently of the main process; this
  WebView has no equivalent failure mode to guard against.
- One registration call, `registerPlugin(BackupImportPlugin.class)` in
  `MainActivity.onCreate()` before `super.onCreate()` — no
  `capacitor.plugins.json` entry needed, that mechanism is only for
  auto-discovering npm-installed plugins during `cap sync`.
- Cold start is covered for free: `BridgeActivity.load()` (Capacitor's own
  base class, `capacitor/src/main/java/com/getcapacitor/BridgeActivity.java`)
  replays the launch intent through `onNewIntent()` at the end of `onCreate()`,
  so a share that cold-starts the app reaches the same
  `handleOnNewIntent` override as one arriving while the app is already
  running. Safe to treat both cases identically because `MainActivity` is
  already `android:launchMode="singleTask"` — there is only ever one Activity
  instance to receive either.
- JS side: `AndroidBackupImportService` (`services/android/`), constructed
  eagerly from `AppComponent`'s constructor next to `PlaylistOpenRequestService`
  — same "start listening before anything can arrive" reasoning, same
  `.start()`-is-a-no-op-off-platform shape. It subscribes to the plugin's
  `backupImportReceived` event exactly once and hands the JSON straight to a
  new shared `PlaylistBackupImportApplyService` (`services/`), which now holds
  the import → Xtream-restore-reconcile → playlist-reload → summary-snackbar
  logic previously inlined in `SettingsBackupFacade.importData()`'s file-input
  handler — extracted so both entry points (the file picker and the share
  intent) apply an imported backup identically, matching how
  `PlaylistOpenRequestService` talks straight to the service layer rather than
  through a page-scoped facade for the same "OS handed us content" shape.
- The native plugin call is isolated behind an `InjectionToken`
  (`BACKUP_IMPORT_PLUGIN`) rather than importing `registerPlugin` from
  `@capacitor/core` directly into the service: calling a Capacitor plugin
  method with no native or web implementation registered rejects
  (`CapacitorException`), which is exactly what happens under Jest/jsdom
  regardless of which platform `Capacitor.getPlatform()` is mocked to return —
  there is no 'web' implementation for this plugin, so mocking the platform
  alone does not fix it. The token lets `AndroidBackupImportService.spec.ts`
  substitute a plain `jest.fn()`-based fake via `useValue`, never touching
  Capacitor's real plugin-resolution proxy.

Verified end to end on the reference device, both directions:

- **Warm start**: with the app already open, `adb shell am start -a
  android.intent.action.SEND -t application/json --eu
  android.intent.extra.STREAM <content-uri> --grant-read-uri-permission -n
  com.liureiptv.tv/.MainActivity` logged `Warning: Activity not started, intent
  has been delivered to currently running top-most instance` (confirms
  `onNewIntent`, not a new Activity) and the WebView console showed
  `BackupImport.addListener` firing with the real file content, followed by
  `PlaylistBackupImportApplyService`'s own summary/error logging.
- **Cold start**: `am force-stop` followed by the identical `am start` command
  launched a fresh process, and the same console sequence appeared once
  Angular finished bootstrapping — proving `notifyListeners(..., true)`'s
  retain-until-consumed behavior actually covers the gap between the native
  intent landing and the JS listener registering.

The `content://` URI in both tests came from this app's own already-declared
`FileProvider` (`cache-path name="my_cache_images" path="."` in
`file_paths.xml`, which maps the whole cache dir) pointing at a real backup
already sitting there from the export fix's own on-device verification —
exercising a genuine export→share→import round trip end to end, not a
synthetic fixture.

**Testing note, extending the one from the export fix**: the same
`moduleNameMapper`-over-`unstable_mockModule` lesson applies here too, but
manifests differently — this is a plugin this repo defines itself, not a
third-party npm package, so there is no package specifier to redirect via
`jest.config.ts`. The `InjectionToken` approach above solves the equivalent
problem through ordinary Angular DI substitution instead, which generalises
better for an in-repo plugin than adding a new stub file per custom plugin
would.

## Fixed Bug: Import button on Android silently did nothing

Follow-up to the share-intent fix above, reported immediately after it shipped:
"import ne marche pas". Confirmed on the reference device that the report was
about the Settings **Import button itself**, not the new share-intent path —
`adb shell dumpsys package` confirmed the share-target `<intent-filter>` was
correctly registered, and CDP showed the app sitting on
`/workspace/settings` with the Import button genuinely focused, no console
errors.

This was a real, if predictable, gap in the previous fix: the share-intent
mechanism adds a **second**, working way to import, but does nothing to the
**first**, obvious one — the button a user actually presses. It still calls
`<input type="file">.click()`, which — for the exact reason the whole feature
needed a share-intent workaround — cannot open Android's native picker from a
D-pad-synthesized click. Before this fix, pressing it produced total silence:
no error, no snackbar, nothing, which reads exactly like "the feature is
broken" rather than "this button doesn't apply here, use the share sheet
instead."

Fix: `SettingsBackupFacade.importData()` now checks `isAndroidRuntime()` first
and, on Android, skips the file input entirely — showing an instructional
snackbar ("open your file manager, select the backup .json file, and share it
into this app") via `SettingsSnackbarService.error()` (10s, dismissible, so
it's readable at TV distance) instead of attempting a picker that can never
open.

**Verification note, worth remembering for this exact class of bug**: a first
attempt to verify this on-device via a genuine `KEYCODE_DPAD_CENTER` appeared
to fail — no snackbar showed. The real cause was test sequencing, not the
fix: the previous test's snackbar was almost certainly still on screen (10s
duration) and absorbed that OK press as its own dismiss action, rather than
the Import button doing nothing. Reproduced cleanly after a full page reload:
navigated the ENTIRE path with genuine hardware D-pad presses (not a
CDP-forced `.focus()`) — General → UP ×3 to the Backup category → OK to
select it → UP once more to reach the Import button, confirmed by a real
visible focus ring in a screenshot — then a single genuine
`KEYCODE_DPAD_CENTER` produced the instructional snackbar. General lesson:
when re-testing a snackbar-driven interaction back to back, either wait out
its duration or dismiss it explicitly before concluding the next press did
nothing.

## Fixed Bug: LiureIPTV absent from the file manager's share sheet

Second immediate follow-up: after the Import-button guidance landed, the
user did the thing the guidance itself asked for — open a file manager,
select the backup, share it — and reported "mon gestionnaire ne propose pas
de partager vers LiureIPTV" (the app isn't even offered as a share target).

Root cause, found by driving the reference device's actual installed file
manager ("Gestionnaire de fichiers +", `com.alphainventor.filemanager`)
through its real UI (`input tap`/`input swipe` long-press, not a shortcut)
and reading `adb logcat` for the resulting `ChooserActivity` line: its Share
action sends the file with `clip={text/x-json ...}` — **`text/x-json`, not
`application/json`**. The manifest's intent-filter only declared
`application/json`, so Android's intent resolution — which requires an exact
(or wildcard) MIME type match, no fuzzy comparison — never considered this
app a candidate at all. The OS's own `MimeTypeMap`/MediaStore scanner
resolves `.json` to `application/json` correctly on this device (checked via
`content query --uri content://media/external/file`), so this isn't a
system-wide mime.types gap — this specific file manager just builds its own
share `Intent` with a different, legacy-but-real type.

Fix: added a second `<data android:mimeType="text/x-json" />` inside the same
`<intent-filter>` (multiple `<data>` elements under one filter OR together,
they don't multiply against action/category). One-line manifest change, no
Java or JS involved — `BackupImportPlugin` reads bytes via
`ContentResolver#openInputStream`, which never inspected the MIME type
anyway.

Verified by repeating the exact real user flow end to end: pushed a test
`.json` to `/sdcard/Download/`, drove "Gestionnaire de fichiers +" through
its real long-press → Plus → Partager UI, and confirmed **LiureIPTV now
appears** in the resulting share sheet alongside Bluetooth/LocalSend/VLC —
tapping it cold-started the app (fresh PID) and the WebView console showed
`BackupImport.addListener` firing with no errors.

**General lesson for this exact bug shape**: when a share-target
intent-filter mysteriously excludes an app, don't guess at alternate MIME
strings — reproduce through the REAL sending app's actual UI and read
`ChooserActivity`'s logcat line for `clip={...}`, which shows the type the
system actually resolved. Guessing (`application/octet-stream`, `text/plain`
were the leading candidates before checking) would likely have missed
`text/x-json` entirely and looked like a fix while remaining broken for this
device's actual file manager. Other file managers may use yet other
variants — the same reproduce-via-real-UI-then-read-logcat method applies if
this recurs with a different one.

## Fixed Bug: first native video playback attempt crashed with a CoordinatorLayout ClassCastException

Found during on-device verification of the native ExoPlayer/Media3 player
(Phase 1, see Decisions below), the moment a channel was actually clicked —
the app had cold-started fine and the plugin had registered fine; only
attaching the video surface crashed it. Logcat's crash buffer
(`logcat -b crash -d`, more reliable than the main buffer once the app dies —
the main ring buffer keeps filling with unrelated system noise and evicts the
actual stack trace within seconds on a shared TV box) showed:

```
FATAL EXCEPTION: main
java.lang.ClassCastException: android.widget.FrameLayout$LayoutParams cannot be cast to androidx.coordinatorlayout.widget.CoordinatorLayout$LayoutParams
	at androidx.coordinatorlayout.widget.CoordinatorLayout.getResolvedLayoutParams(CoordinatorLayout.java:696)
	at androidx.coordinatorlayout.widget.CoordinatorLayout.prepareChildren(CoordinatorLayout.java:737)
```

Root cause: `NativePlayerSurface.attach()` adds the `SurfaceView` into
`(ViewGroup) getBridge().getWebView().getParent()` — correct, per the plan,
since that parent (`capacitor_bridge_layout_main.xml`) is what lets a sibling
view composite behind the WebView — but built its `LayoutParams` as plain
`FrameLayout.LayoutParams`. The parent is actually a `CoordinatorLayout`,
which casts *every* child's `LayoutParams` to its own type during
measure/layout (`CoordinatorLayout.getResolvedLayoutParams`), regardless of
what type the child's *view* is. This crashed on the very first
`prepareChildren()` pass after `addView()`, i.e. immediately, every time.

Fix: `NativePlayerSurface.toLayoutParams()` now builds
`CoordinatorLayout.LayoutParams` instead (still just `leftMargin`/`topMargin`
+ explicit width/height — `CoordinatorLayout.LayoutParams` extends
`ViewGroup.MarginLayoutParams` the same as `FrameLayout.LayoutParams` does, so
no other call site needed to change). The `androidx.coordinatorlayout`
dependency was already present in `app/build.gradle` (pulled in by Capacitor
itself), so this was a one-file fix.

Verified on the reference device after the fix: clicking a live channel no
longer crashes (`adb shell pidof com.liureiptv.tv` kept returning the same
PID across playback start, channel switches, and navigating away).

## Fixed Bug: native video was actually invisible — `dumpsys SurfaceFlinger` alone is not proof, only the user's own eyes are

**This entry has been wrong twice.** It first corrected a bad reading of
`dumpsys SurfaceFlinger`, then shipped a second wrong root cause — also as
"verified." Worth reading in full before concluding anything about this
device's compositor.

**Current, confirmed root cause: an opaque DOM ancestor.** Punch-through
works fine on this silicon. The workspace shell's `.workspace-shell`,
`.workspace-body` and `.workspace-content` each paint an opaque background
across the player's rect, so the WebView never had a single transparent
pixel for the SurfaceView behind it to show through. `background:
transparent` on the player's own placeholder does nothing about this —
transparency reveals the *parent*, it does not punch a hole. Making those
three transparent for the session's lifetime
(`.native-video-punchthrough` on `<html>`, see
`workspace-shell.component.scss`) makes the picture appear with the surface
in its default position, behind the window. The `setZOrderOnTop` toggle
described below has been removed.

The rest of this entry is kept because the reasoning that produced the wrong
answer is the useful part.

After the crash fix above, the first playback attempt showed audio
(`positionSeconds` advancing, `status: "playing"`) but `adb exec-out
screencap -p` showed flat black where video should be. `dumpsys
SurfaceFlinger` on the same frame showed the SurfaceView layer with
`composition type=DEVICE` (hardware-overlay composition) and a real
`activeBuffer=[1280x720:...]` at the correct position — this was reasoned to
mean the video was genuinely compositing, just invisible to `screencap`
specifically because it reads the GPU framebuffer and a hardware-overlay
plane bypasses it. That reasoning was recorded here as fact.

**It was wrong.** The user then watched the actual physical screen and
reported plainly: "No video, only sound!" `dumpsys SurfaceFlinger` proves a
layer exists with a real decoded buffer at the right position — it does
**not** prove the hardware composer successfully blended that layer with
whatever is on top of it. Those are different questions, and only the
physical display (or, short of that, a capture method that actually goes
through the same compositor path the display does) answers the second one.

Root cause, found by elimination across two follow-up attempts:

1. **TextureView follow-up** — the standard fix for "SurfaceView doesn't
   composite behind a transparent overlay" is TextureView, since it draws
   through the ordinary GPU pass instead of a separate hardware plane.
   Rebuilt `NativePlayerSurface` around it, added temporary logging, and
   confirmed on-device that `onSurfaceTextureAvailable` fired with correct
   bounds/alpha/visibility and `onSurfaceTextureUpdated` fired repeatedly —
   real decoded frames genuinely reaching the texture, composited in the
   same draw pass as the (correctly rendering) surrounding UI. **Still
   black.** This ruled out positioning, visibility, and hardware-plane
   blending as the cause for this path, and pointed at a GL `external OES`
   texture-sampling incompatibility between this vendor's decoder buffer
   format and this Mali-G310 driver — a different failure at a different
   layer than the SurfaceView case, not fixable by switching view types.
2. **`setZOrderOnTop(true)` diagnostic** — reverted to SurfaceView, but
   forced it fully above the entire window instead of blending behind the
   WebView. **This showed a real picture** (confirmed via screenshot: an
   actual TFou cartoon frame on TF1, not black). This was read as
   conclusive: the vendor HWC supposedly cannot alpha-blend the transparent
   WebView's layer over a separate video overlay plane, so only removing the
   blend requirement entirely could work on this silicon.

   **That inference was invalid**, and the flaw is worth naming because it
   looks airtight. Going on top changes *two* things at once: the surface
   stops needing a blend, **and** it stops being covered by the DOM. The
   experiment cannot distinguish them, yet only the first was considered —
   the DOM was assumed transparent because the *placeholder* element had
   `background: transparent` and `webView.setBackgroundColor(TRANSPARENT)`
   had been called. Neither says anything about the ancestors in between.
   The controlled version of this test holds the surface behind the window
   and changes only the DOM: from the WebView's own DevTools console, walk
   the placeholder's `parentElement` chain and clear every non-transparent
   `backgroundColor` (re-applying on an interval, since Angular re-renders).
   Only three elements had one; with those cleared the picture appears with
   the surface behind, which falsifies the HWC-blending theory outright.
   (At the time this was run, the z-order could be forced from the console
   through the plugin's since-removed `setControlsVisible`; today the
   surface is always behind, so no such lever is needed.)

**The withdrawn fix** (kept here so it is recognisable if it reappears):
keep SurfaceView, keep `setZOrderOnTop`, but toggle it live —
`NativePlayerSurface.setControlsVisible(boolean)` flipping
`setZOrderOnTop(!controlsVisible)`, driven from
`PlayerControlsComponent`'s own `controlsAreVisible` signal so the surface
sat on top exactly while the DOM controls were hidden. It was verified on
the device and it did show video, which is why it shipped.

It was still a bad trade, for reasons visible without any hardware:

- **The video covered the app's own controls.** The transport bar, EPG
  timeline and back button were unreachable *by construction* whenever
  video was visible. Combined with `MainActivity.dispatchKeyEvent`
  consuming every D-pad key for `__tvKeyDispatch`, and the controls
  reappearing only via that same auto-hide timer, the practical result was
  that the controls were reachable for the first 2.5s of a session and
  never again.
- **It destroyed and recreated the Surface mid-playback.** `setZOrderOnTop`
  after the containing window is attached recreates the underlying Surface,
  so every controls show/hide invalidated ExoPlayer's render target — for
  the entire lifetime of every session.
- **It made the auto-hide delay load-bearing for video visibility**, so
  raising the 2.5s delay to something reasonable for a 10-foot UI would
  have directly lengthened the black-screen window.

**The shipped fix**: SurfaceView in its default position (no `setZOrder*`
call at all), plus the DOM half of the punch-through —
`AndroidNativePlayerComponent` adds `.native-video-punchthrough` to
`<html>` for the session's lifetime, and `workspace-shell.component.scss`
turns off exactly the three backgrounds that covered the rect. The whole
`setControlsVisible` chain (plugin method, command runner, session
controller, component effect) is deleted. Controls now draw *over* the
video like every other engine's, and no Surface is ever recreated.

Regression coverage:
`android-native-player.component.punchthrough.spec.ts` asserts the class is
added for an active session and removed on teardown — the teardown half
matters because the class makes the app's own backgrounds transparent
app-wide, so leaking it shows the black Android window everywhere.

**General lessons**, in the order they were learned the hard way:

1. `dumpsys SurfaceFlinger` showing a correctly-positioned, correctly-typed,
   non-empty buffer is evidence decode and layer registration are healthy —
   it is not evidence of what actually reaches the panel. Only a physical
   look at the screen (or `screencap` once you've confirmed the surface is
   *not* on a bypassed plane) settles whether compositing succeeded.
2. **When a layer is invisible, suspect the app before the driver.** Both
   wrong conclusions here blamed the vendor, and the actual cause was three
   CSS backgrounds. A driver limitation is the most expensive explanation
   available — it justifies shipping a workaround — so it needs the
   strongest evidence, not the weakest.
3. **A fix that works is not the same as a diagnosis that holds.**
   `setZOrderOnTop(true)` genuinely made video appear, which felt like
   proof; it changed two variables at once and proved nothing about which
   one mattered. Before concluding from an experiment, ask what *else* it
   changed.
4. **Verify the console is attached to the app.** A long stretch of this
   investigation ran against `chrome://inspect`'s own page — snippets
   returned success while touching nothing, because the DOM query failed
   silently. Check `location.href` first; on Android the app's target is
   the `inspect` link under the package entry, or
   `http://localhost:9222/json/list`.

## Partial in-app rebrand: launcher, splash, and welcome screen

The native Android identity (`applicationId com.liureiptv.tv`, launcher label,
task-switcher title — `android/app/src/main/res/values/strings.xml`) was
already "LiureIPTV" from the earlier fork rebrand. The Angular app's own UI
text, shared verbatim across the Electron, PWA, and Android builds via
`apps/web/src/index.html` and `apps/web/src/assets/i18n/*.json`, still said
"IPTVnator" everywhere — deliberately left alone at the time, since renaming
it is a separate decision from renaming the native shell.

User asked to change what appears on screen to "LiureIPTV" and explicitly
chose the narrowest option: the splash screen plus the two most-visible,
purely-branding strings, in English and French only (the languages that
matter for this device) — not a global find-replace across all 19 locale
files.

Changed:

- `android/app/src/main/res/mipmap-*/ic_launcher*.png`: the Android-only
  launcher artwork uses the LiureIPTV Puy de Dôme icon for the standard,
  round, and adaptive-foreground resources at every existing density. Keep
  each resource's current dimensions (48–192 px for standard/round and
  108–432 px for adaptive foreground); do not replace the shared Web/PWA
  icons under `apps/web/src/assets/icons/` as part of an Android-only rebrand.
- `android/app/src/main/res/drawable/tv_banner.png`: the 1672×941 Leanback
  banner referenced by `AndroidManifest.xml` uses the same Puy de Dôme mark
  with the LiureIPTV wordmark. Keep the basename and 16:9 proportions:
  launchers that prefer `android:banner` do not fall back to the square mipmap
  icon.
- `apps/web/src/index.html`: `<title>`, the splash's `aria-label`, and the
  branded `assets/icons/liureiptv-splash.png` image. The full-bleed 16:9
  artwork is generated from Android's `drawable/tv_banner.png`; its matching
  `#02131D` fallback keeps the Android TV WebView bootstrap screen visually
  continuous with the native launch screen instead of flashing back to the
  old text-and-spinner branding.
- `android/app/src/main/res/drawable*/splash.png`: the same LiureIPTV artwork
  is generated from `drawable/tv_banner.png` at every existing
  landscape/portrait density. Landscape assets use a centre crop without
  distortion; portrait assets preserve the complete 16:9 banner on the
  matching dark canvas. Android 12+ owns the first launch frame and only
  accepts a solid `windowSplashScreenBackground` plus a centred
  `windowSplashScreenAnimatedIcon`, so `drawable/liureiptv_splash_icon.png`
  contains the banner's rounded-square mark and `values/colors.xml` supplies
  the matching `#02131D`. `MainActivity` must call
  `SplashScreen.installSplashScreen(this)` before `super.onCreate()`.
- `HOME.PLAYLISTS.WELCOME_TITLE` in `en.json`/`fr.json` — the big headline on
  the empty-dashboard "add your first playlist" screen
  (`empty-state.component.html`'s `'welcome-dashboard'` case), the first
  screen a fresh install shows.
- `apps/web-e2e/src/basic.e2e.ts`'s literal `page.title()` assertion, updated
  to match.

Deliberately left as "IPTVnator" — these strings name a specific, different
thing, not "this app", and renaming them would make them wrong rather than
on-brand:

- `SETTINGS.EPG_NOTE` ("...available only in the electron-based version of
  IPTVnator") — names the real upstream desktop app specifically, a distinct
  product this fork doesn't replace.
- `SETTINGS.ABOUT_SUBTITLE` / `SETTINGS.SUPPORT_DESCRIPTION` — the About
  page's support links (GitHub Sponsors, Ko-fi, the GitHub repo link) all
  point at `4gray`'s real accounts/upstream repo, not this fork's own; the
  surrounding text correctly describes supporting *that* project.
- `ABOUT.TITLE` ("About IPTVnator") — checked via grep, this key is unused by
  any template (the real About page header uses `SETTINGS.ABOUT` = "About").
  Left alone rather than "fixed", since it's dead text either way.

**Consequence worth knowing**: `index.html` is the one shared file across all
three build targets. This fork's Electron and PWA builds (if built from this
same branch) will now also show "LiureIPTV" as the page title / splash —
which is consistent with the fork's own identity, not a bug — but a few
Electron-backend E2E tests elsewhere (`smoke.e2e.ts`,
`embedded-mpv-frame-copy-packaged.e2e.ts`,
`electron-test-fixtures.ts`, `xtream-renderer-capture.spec.ts`) still assert
the literal string "IPTVnator" against the desktop window/page title. Left
untouched — out of the Android port's scope per "Out Of Scope" above, and
whether to rebrand the desktop build too is a separate decision nobody has
made yet.

If the broader, all-19-languages rebrand is ever wanted, the correct
approach is NOT a blind `sed` replace: each occurrence needs the same
"does this name *this app* or a specific different thing" judgment call
applied above, repeated per language.

## TV Interaction Reference

D-pad behaviour, the four surfaces, the measured focus palette and the adoption
order are in
[`docs/android-port/tv-navigation-reference.md`](./docs/android-port/tv-navigation-reference.md).

The one rule to carry into every component: **each panel marks its own selection
with a low-contrast fill relative to that panel's background, and only the
focused panel promotes its selection to the near-white pill.** Three visual
states and per-panel position memory are the same mechanism, not two features.

The current navigation contract deliberately uses **OK/BACK for panel
transitions**; LEFT/RIGHT are local to the panel that already owns focus:

1. OK on a Live Category confirms it, folds the category column and focuses the
   first channel. Merely moving over categories does not reload them.
2. OK on a channel starts playback and folds the Channels sidebar. BACK
   restores Channels and returns focus to the previously selected row.
3. Another BACK from Channels restores Live Categories. BACK from Live
   Categories returns to the tray.
4. In fullscreen, LEFT/RIGHT stay inside the player and BACK leaves fullscreen
   before any panel is restored.
5. In the tray, one BACK is consumed; a second consecutive BACK within 650 ms
   calls the native player's id-independent `stop()`, waits for ExoPlayer to be
   muted/stopped/released, then calls Capacitor `App.exitApp()`. Any intervening
   remote key cancels the double-BACK sequence.

The EPG list row is itself the primary focus target. RIGHT enters its
`data-tv-row-action` controls (Watch, then programme information), LEFT walks
back through them and returns to the row. This explicit local traversal is
required because the buttons sit inside the row rectangle and generic spatial
scoring cannot enter them.

Implementation ownership is split to keep the production file-size rule
enforced: `tv-navigation.ts` orchestrates dispatch and spatial movement,
`tv-panel-navigation.ts` owns semantic panel transitions and local row actions,
`tv-native-control-keys.ts` hands real key events to Material/native widgets,
and `tv-app-exit.ts` owns the double-BACK lifecycle sequence.

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

Use the repository script for normal development:

```bash
./tools/android/build-android.sh -b
./tools/android/build-android.sh -b -i -l -a <box>:5555
./tools/android/build-android.sh -s -a <box>:5555
```

`-b/--build` is the only option that builds: it runs
`pnpm nx build web --configuration=pwa`, cleans the copied web assets, runs
`pnpm exec cap sync android`, then assembles the debug APK. Without `-b`, the
ADB-only options use the existing APK or installation: `-i/--install`,
`-l/--launch`, `-s/--screenshot`, and `-a/--address`. If an addressed device is
not already reachable, the script tries `adb connect` before retrying. A bare
invocation is rejected instead of rebuilding implicitly.

Direct equivalent, useful only when diagnosing the script:

```bash
pnpm nx build web --configuration=pwa
pnpm exec cap sync android
cd android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDebug
adb -s <box>:5555 install -r app/build/outputs/apk/debug/app-debug.apk
```

Toolchain and versioning facts:

- **JDK 21 is required.** The helper accepts `JAVA_HOME` when it points at Java
  21+, otherwise probes the usual system JDK 21 locations and fails clearly.
  Running Gradle with Java 17 fails with `invalid source release: 21`.
- **The Android SDK must be configured.** The helper accepts `ANDROID_HOME` or
  `ANDROID_SDK_ROOT`, or derives both from `android/local.properties` when it
  contains `sdk.dir`.
- `android/app/build.gradle` reads the semantic version from `package.json`.
  Development builds use the Git commit count as `versionCode` and
  `<version>-dev.<count>.<short-sha>` as `versionName`; a clean commit tagged
  with `<version>` or `v<version>` keeps the plain semantic version.
  `ANDROID_VERSION_CODE` and `ANDROID_VERSION_NAME` override those values for a
  controlled build.

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

**Phase 1 shipped and verified on the reference device — with a real
mid-flight architecture change; read the fixed-bug entry above
("native video was actually invisible") before touching compositing here.**
Scope: live TS/HLS across all three portal types (M3U, Xtream, Stalker),
capability flags `{volume: true, seek: !isLive, fullscreen: true}` only —
audio tracks, subtitles, playback speed, aspect ratio, recording, PiP, series
navigation and DRM are still unimplemented (adapter reports them `false`; no
UI control renders). The engine is an **unconditional override on Android**,
not a Settings-selectable option — applied through the same `[playerOverride]`
mechanism DASH already uses to force HTML5, with DASH still taking precedence
over it (`.mpd` channels keep routing to the existing Shaka path even on
Android; `isDashStreamUrl` guards it). The override is decided **once**, in
`WebPlayerViewComponent.selectedPlayer`. It began as a copied computed in each
live host, and the VOD/series host (`PortalInlinePlayerComponent`) simply never
got a copy — so movies silently kept using the WebView this whole feature
exists to avoid. An explicit `playerOverride` from a host still wins, which is
what keeps DASH on Shaka.

- **On-demand playback goes straight to a locked fullscreen.** Live plays
  inline beside its channel list, whose panels carry their own backgrounds.
  Movies and series play inside the detail page's theater stage, which stacks
  four opaque layers over the player's rect — the stage black, the ambient
  poster blur, the shell card, and the detail page background — and every one
  of them hides a surface composited behind the WebView. Fullscreen blanks the
  shell with `visibility`, so nothing paints over the video.
  `AndroidNativePlayerComponent` sets `TV_FULLSCREEN_ATTRIBUTE` plus
  `TV_FULLSCREEN_LOCKED_ATTRIBUTE` for the session; `exitFullscreen()` refuses
  while locked, so BACK falls through to history and closes the player instead
  of uncovering a stage with invisible video still playing behind it.
- **Two traps cost real time getting that fullscreen to fill the screen**, both
  in `tv-focus.styles.ts`, and both invisible in the computed style:
  `//` line comments are not CSS — the parser treats one as a bad declaration
  and swallows everything up to the next `;`, which silently ate the `width`
  right after it. And the detail shell's browse-to-watch **animation stays
  attached to `.shell__player`**: an animated or transformed element becomes
  the containing block for its fixed-position descendants, so the player
  reported `position: fixed` with `top: 0` yet laid out at the workspace grid's
  origin. Neither shows up as a wrong computed value — only the measured rect
  disagrees.
- **Audio tracks are in scope, unlike the rest of phase 2.** IPTV VOD is
  largely multi-language — "MULTI" in a title means several dubs — so shipping
  the native engine without a dub picker would have made it a downgrade from
  the WebView it replaces. ExoPlayer addresses a track by (group, index within
  group); the shared controls contract carries one number, so
  `buildAudioTracks()` flattens the groups and numbers by position, and
  `applyAudioTrack()` walks the identical loop back. **Those two loops must
  stay in step.** Tracks arrive well after `load()` — the list is empty until
  the first samples are read — and neither their arrival nor a switch moves
  status or position, so `onTracksChanged` plus a track signature in
  `pushSnapshotIfChanged()` is what stops the snapshot's own change test from
  dropping both. Verified on a three-dub release: labels came from the
  provider's own `Format.label`, and switching kept playback running.
- **The screen stays awake while playing.** `FLAG_KEEP_SCREEN_ON` is held only
  while ExoPlayer reports `isPlaying`, mirroring the desktop engine's
  `powerSaveBlocker`, so a paused film still lets the TV sleep. Without it the
  screensaver takes over mid-film — it interrupted this port's own testing
  twice before being noticed.
- **Teardown silences before release.** Releasing a multi-gigabyte local
  `content://` source can block for several seconds on the reference TV.
  `AndroidNativeSessionController` therefore sends a separate `pause()` before
  `dispose()`, and the native `disposeInternal()` defensively clears
  play-when-ready, mutes, stops, and clears the surface before calling
  `release()`. Do not collapse this back to release-only cleanup: the WebView
  returns to the catalogue immediately, while Media3 may still be dismantling
  the source, which otherwise leaves the film audible behind the UI.

- **Compositing: punch-through, as originally planned.** `attach()` inserts
  the `SurfaceView` at index 0 of
  `(ViewGroup) getBridge().getWebView().getParent()` and flips
  `webView.setBackgroundColor()` transparent for the session's lifetime; no
  `setZOrder*` call is made, so the surface keeps its default position
  behind the window. The WebView half is not sufficient on its own: the DOM
  must also stop painting over the rect, which
  `AndroidNativePlayerComponent` handles by adding
  `.native-video-punchthrough` to `<html>` for the session
  (`workspace-shell.component.scss` then drops the three workspace
  backgrounds, and `tv-focus.styles.ts` drops the TV-fullscreen black
  backdrop, which is an ancestor of the placeholder and would otherwise
  black out the video the instant the player goes fullscreen — the class
  name is shared through `NATIVE_VIDEO_PUNCH_THROUGH_CLASS` in
  `@iptvnator/shared/interfaces`, which lives there rather than beside the
  player because `tv-focus.styles.ts` is reached from `main.ts` and the
  `@iptvnator/ui/playback` barrel would drag every engine into the initial
  bundle). An interim revision instead toggled `setZOrderOnTop` live
  against the DOM controls' visibility, on the mistaken conclusion that the
  vendor HWC (Amlogic S905X5M) could not blend the two layers — see the
  fixed-bug entry above for why that was wrong and why it was withdrawn.
- **Bounds conversion is native-side, round-once-per-edge**, mirroring
  `embedded-mpv-bounds.util.ts`: JS sends unrounded CSS-px bounds plus
  `window.devicePixelRatio`; `NativePlayerViewBounds.toDevicePixels()` scales
  each edge once, after scaling, to avoid 1px seams. Verified correct
  end-to-end via `dumpsys SurfaceFlinger`'s reported `displayFrame`/
  `visibleRegion` matching the CSS bounds × DPR exactly, including through a
  live sidebar-collapse bounds-sync (`[1566,112,1920,691]` →
  `[166,112,1920,691]` when the channel sidebar was hidden).
- **MIME hinting matters.** Xtream/Stalker live URLs routinely have no
  extension; `AndroidNativePlayerPlugin.resolveMimeType()` hints
  `MimeTypes.VIDEO_MP2T` for extensionless/`.ts` URLs and
  `MimeTypes.APPLICATION_M3U8` for `.m3u8` — without this, TS sniffing was
  the actual risk flagged in planning and would have silently failed exactly
  the URLs this feature exists to fix.
- **On-device verification** (Xiaomi TV Box S, live Xtream `.ts` channel,
  "TF1 SD"): hardware decoder confirmed via logcat
  (`c2.amlogic.avc.decoder`, not software fallback); video confirmed
  **actually visible** via a real screenshot showing genuine picture content
  (not just `dumpsys SurfaceFlinger` bookkeeping — see the fixed-bug entry
  above for why that alone was insufficient and misled an earlier pass of
  this file) both immediately after a channel switch and again once controls
  auto-hid a few seconds later; position advancing continuously without
  stalls or decoder recreation for 115+ seconds; bounds-sync verified across
  a live sidebar-collapse UI change; channel switching
  verified clean (`dispose` on the old session id, `create` with a fresh
  one, SurfaceView layer count never grows); navigating away verified clean
  (`dispose` fires, WebView background restores, dashboard renders with no
  transparency leak). Fullscreen bounds-sync, a Stalker MAG channel, and an
  M3U `.m3u8` channel were not separately exercised this pass — worth a spot
  check before relying on them.
- **Known cosmetic quirk, not a bug**: `positionSeconds` for a continuous raw
  TS live stream periodically resets backward by several seconds (TsExtractor
  re-estimating duration from newly received PCR data). Invisible to users in
  Phase 1 scope since `seek` is `false` for live (no scrubber renders), but
  worth knowing before wiring any live-position UI in a later phase.
- **The DOM draws over the video, which is what punch-through buys.**
  Controls, dialogs and overlays composite on top of the picture normally,
  including semi-transparent ones — the WebView layer's alpha is blended
  against the surface behind it. The frame-copy architecture Electron's
  embedded-mpv uses on desktop (render off-screen, copy into shared memory,
  upload as a `<canvas>` texture) is therefore **not** needed here; it was
  only ever considered as an escape from the withdrawn z-order workaround.

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

## Downloads

Android exposes the existing shared downloads UI through a partial
`window.electron.downloads*` bridge installed before Angular bootstrap
(`apps/web/src/app/services/android/downloads/android-downloads-bridge.ts`).
The bridge keeps the renderer contract unchanged while delegating transfers to
the OS `DownloadManager` through `AndroidDownloadsPlugin` and metadata to a
separate WebView SQLite database (`liureiptv-downloads`).

Downloads are staged in the app-private external-files `downloads/` directory:
no broad storage permission is required and transfers survive app restarts and
connectivity loss. Change Folder opens Android's Storage Access Framework tree
picker and persists the returned URI permission. Each new download snapshots
the selected destination; after `DownloadManager` finishes, a background
worker copies the staging file into that tree and the Downloads row remains
active until the export completes. This staging step is required because
`DownloadManager` cannot write directly to an arbitrary `content://` tree.
Removing a row deletes both its staging file and its exported document.
Some Android TV firmware, including the reference Mi Box, exposes only
`com.android.tv.frameworkpackagestubs` for `ACTION_OPEN_DOCUMENT_TREE`; that
activity immediately cancels instead of showing a picker. The plugin detects
that stub before launch and presents a D-pad-native destination dialog instead.
It offers app storage plus `Download/LiureIPTV` on every MediaStore volume
(internal or mounted USB), without requesting broad all-files access.
Request `User-Agent`, `Referer` and `Origin` headers are persisted so retry can
recreate portal requests. The bridge polls all active native ids in one call
and only emits a renderer update when persisted state actually changes.

Android `DownloadManager` has no manual pause API. Pause therefore removes the
native request and resume starts the file again from zero; the UI must not imply
byte-range continuation. File-manager reveal remains unsupported by the bridge.
From an Xtream movie detail, Play Local builds an inline
`ResolvedPortalPlayback` around the persisted `file://` or `content://` URI;
`WebPlayerViewComponent` selects Android native ExoPlayer, whose
`DefaultDataSource` handles both URI schemes. The shared Downloads page still
hides its desktop-only Play and Reveal buttons until generic list-to-player and
episode-local-play routes exist. A newly selected folder applies to future
downloads; already completed files are not moved.

Verified end to end on the reference Mi Box S 3rd (Android 14/API 34): the
native plugin registered at startup, the shared Downloads screen reported the
feature available, and a neutral 129-byte LAN payload transitioned from
`downloading` to `completed` with a local URI before Remove deleted both its
metadata and native file. The test left zero synthetic download rows behind.
The workspace-header shortcut is capability-gated (`supportsDownloads`), not
Electron-gated, so Android users can always open the Downloads screen even
after the active-transfer indicator disappears.

Download rows are explicit `data-tv-action-card`s with a
`data-tv-action-row`. Their Copy/Delete (and active-transfer) controls sit
inside the focused card's rectangle, so generic edge-based spatial scoring
cannot enter them. `moveWithinActionCard()` owns local LEFT/RIGHT traversal:
RIGHT enters and walks the controls, while LEFT from the first returns to the
card. UP/DOWN remain ordinary geometric movement between download rows. OK on
the card opens the source movie or series detail. Android has no
`dbGetContentByXtreamId` bridge, so Xtream navigation uses category `0` when
the category cannot be recovered; the detail API only needs the content id,
and falling back to the catalog list would violate the card's action.

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
`data-tv-region` on the document element. Category rows are explicit OK
targets: confirmation marks `aside.context-panel:has(.category-item)` inert and
moves focus to Channels. Selecting a channel invokes the live layout's real
sidebar toggle and marks the zero-width `.sidebar` inert; BACK invokes its
restore toggle and returns focus to the remembered channel. LEFT/RIGHT never
cross tray/category/channel boundaries, so invisible collapsed panels cannot
capture geometric focus. BACK is the only parent transition and restores one
level at a time.

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

**Xtream catch-up (done).** A channel is replay-capable only when the portal
returns both `tv_archive=1` and a positive `tv_archive_duration`. Those channels
carry a non-focusable `Catchup` badge in the channel sidebar, so the marker does
not add a D-pad stop. Select the channel, move into its EPG timeline/list and
activate a past programme; the resulting playback has `isLive=false` and uses
the native ExoPlayer path. It also carries `presentation: 'inline'`: seekability
must not make the native host treat replay like a film and lock it fullscreen,
because that hides the EPG and its `Return to live` action. The current
programme can also be restarted, and `Return to live` restores the direct
stream.

On 2026-08-03 this was verified against the user's real portal on the reference
Mi Box: HTTP `HEAD` probes were refused for all four URL shapes, but the Android
REST `.ts` timeshift URL reached ExoPlayer's `playing` state with a known
duration. Do not treat a rejected `HEAD` as proof that catch-up is unavailable.
The shared seek slider stays virtually focused on Android TV because real focus
on `<input type="range">` raises the Mi Box soft keyboard even though the
control cannot accept text. A real player button remains focused while the
slider owns virtual focus, which keeps the controls and slider visible without
raising the keyboard. OK enters an explicit adjustment mode, LEFT/RIGHT adjust
and commit the position, and holding either direction progressively accelerates
the adjustment (normal, 2x, 5x, 10x then 30x steps). Repeats are ignored
outside an active slider, and BACK exits that mode and restores the previous
player control without navigating away.
A quick double OK on an archive programme keeps the first activation inline,
then switches its catch-up playback to fullscreen as soon as its player exists.
The Android XMLTV lookup returns programmes whose end falls in the preceding
24 hours, matching the local retention window, so the previous day’s replay
programmes remain selectable when the provider exposes catch-up for the channel.

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
