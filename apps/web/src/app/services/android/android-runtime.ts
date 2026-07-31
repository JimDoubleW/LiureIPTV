/**
 * Runtime identity for the Android TV port.
 *
 * Kept as a standalone file with no imports from app code: it is read from
 * `DataFactory()` and from styling/navigation entry points, and must stay
 * cheap enough to call during bootstrap.
 *
 * See CLAUDE.android.md — the port's rule is to add files and hook them at
 * existing injection points rather than scattering `if (isAndroid)` through
 * components.
 */

interface CapacitorGlobal {
    readonly getPlatform?: () => string;
    readonly isNativePlatform?: () => boolean;
}

function getCapacitor(): CapacitorGlobal | undefined {
    return (globalThis.window as (Window & { Capacitor?: CapacitorGlobal }) | undefined)
        ?.Capacitor;
}

/**
 * True when running inside the Capacitor Android shell (not a browser, not
 * Electron).
 *
 * This doubles as the "is this a TV?" answer: the Android build is declared
 * leanback-only in `AndroidManifest.xml` and is never shipped to handsets, so
 * there is no second Android form factor to distinguish. Resist adding a
 * media-query heuristic for it — `(hover: none) and (pointer: coarse)` matches
 * phones and TVs alike and would silently misclassify both.
 */
export function isAndroidRuntime(): boolean {
    return getCapacitor()?.getPlatform?.() === 'android';
}
