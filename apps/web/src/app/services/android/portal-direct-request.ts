/**
 * Client-side stand-in for the `web-backend` CORS proxy.
 *
 * In a browser the app cannot call an IPTV provider directly, so `PwaService`
 * routes portal traffic through `web-backend`: it registers the provider URL
 * with `POST /provider-targets`, gets an opaque `targetId` back, and then calls
 * `GET /xtream?targetId=…`. The provider address only ever lives on the server.
 *
 * Inside the Capacitor shell that indirection is not just unnecessary, it is
 * harmful: the proxy has to run on some other machine, and an Android TV app
 * that stops working when a laptop is asleep is not a port. Native HTTP is not
 * subject to CORS, so the shell keeps the registry itself and talks to the
 * provider directly.
 *
 * Pure functions plus a tiny registry, so the request rewriting is unit-testable
 * without Angular's HTTP stack.
 */

/** Query parameter the proxy used to identify a registered provider. */
export const TARGET_ID_PARAM = 'targetId';

/** Xtream's API entry point, appended to the provider's base URL. */
const PLAYER_API_PATH = 'player_api.php';

/**
 * Joins the provider base URL with the Xtream API path.
 *
 * Provider URLs are entered by hand and arrive with or without a trailing
 * slash, sometimes with a path already; naive concatenation produces `//` or
 * silently drops a path segment, and the provider answers with an HTML error
 * page rather than JSON.
 */
export function buildPlayerApiUrl(providerUrl: string): string {
    const url = new URL(providerUrl);
    const base = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    url.pathname = `${base}${PLAYER_API_PATH}`;
    return url.toString();
}

/**
 * Maps the opaque id the app believes the proxy issued back to the provider URL
 * it stands for. Ids stay stable per URL so a re-registration is a no-op.
 */
export class ProviderTargetRegistry {
    private readonly urlById = new Map<string, string>();
    private readonly idByUrl = new Map<string, string>();
    private nextId = 0;

    register(providerUrl: string): string {
        const existing = this.idByUrl.get(providerUrl);
        if (existing) {
            return existing;
        }

        const id = `android-target-${this.nextId++}`;
        this.idByUrl.set(providerUrl, id);
        this.urlById.set(id, providerUrl);
        return id;
    }

    resolve(targetId: string): string | null {
        return this.urlById.get(targetId) ?? null;
    }
}

/**
 * The parameters to forward to the provider: everything the app sent except the
 * `targetId`, which is an artefact of the proxy and means nothing upstream.
 */
export function forwardableParams(
    params: Readonly<Record<string, string>>
): Record<string, string> {
    const forwarded: Record<string, string> = {};

    for (const key of Object.keys(params)) {
        if (key !== TARGET_ID_PARAM) {
            forwarded[key] = params[key];
        }
    }

    return forwarded;
}

/**
 * Shapes a raw provider response the way `PwaService` expects the proxy to have
 * shaped it, so none of its error handling or result mapping has to change.
 */
export function wrapProviderPayload(
    action: string | undefined,
    payload: unknown
): { action: string | undefined; payload: unknown } {
    return { action, payload };
}

/**
 * Normalises what native HTTP hands back.
 *
 * The native stack returns the body already parsed when the provider sets a
 * JSON content type, and as a raw string when it does not — and IPTV providers
 * are inconsistent about that. Downstream code expects an object either way.
 */
export function parseProviderData(data: unknown): unknown {
    if (typeof data !== 'string') {
        return data;
    }

    try {
        return JSON.parse(data);
    } catch {
        // Providers answer errors with an HTML page; leave it for the caller's
        // error handling rather than throwing here.
        return data;
    }
}
