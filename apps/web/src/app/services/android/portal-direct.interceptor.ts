import {
    HttpEvent,
    HttpHandler,
    HttpInterceptor,
    HttpParams,
    HttpRequest,
    HttpResponse,
} from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable, of } from 'rxjs';
import { isAndroidRuntime } from './android-runtime';
import {
    buildPlayerApiUrl,
    forwardableParams,
    ProviderTargetRegistry,
    TARGET_ID_PARAM,
    wrapProviderPayload,
} from './portal-direct-request';

/**
 * Redirects portal traffic away from the `web-backend` CORS proxy and straight
 * at the provider, so the Android shell needs no server of its own.
 *
 * Implemented as an interceptor rather than a `DataService` subclass on
 * purpose: `PwaService` owns a lot of error normalisation, debug logging and
 * result shaping for these calls, and all of it stays correct as long as the
 * responses keep the proxy's envelope. Intercepting at the HTTP layer reuses
 * every bit of that, and keeps the port additive — no existing class changes.
 *
 * Requests are only rewritten inside the Capacitor shell; the PWA and Electron
 * builds pass straight through.
 */
@Injectable()
export class PortalDirectInterceptor implements HttpInterceptor {
    private readonly targets = new ProviderTargetRegistry();

    intercept(
        request: HttpRequest<unknown>,
        next: HttpHandler
    ): Observable<HttpEvent<unknown>> {
        if (!isAndroidRuntime()) {
            return next.handle(request);
        }

        if (request.method === 'POST' && this.isRoute(request, 'provider-targets')) {
            return this.registerTarget(request);
        }

        if (request.method === 'GET' && this.isRoute(request, 'xtream')) {
            return this.forwardToProvider(request, next);
        }

        return next.handle(request);
    }

    private isRoute(request: HttpRequest<unknown>, route: string): boolean {
        // The proxy base is configurable at runtime, so match on the route
        // rather than on a fixed origin.
        return new URL(request.url, 'http://localhost').pathname.endsWith(
            `/${route}`
        );
    }

    /**
     * Answers the registration locally. The app only ever treats the returned
     * id as opaque, so nothing downstream can tell that no server was involved.
     */
    private registerTarget(
        request: HttpRequest<unknown>
    ): Observable<HttpEvent<unknown>> {
        const body = request.body as { url?: unknown } | null;
        const providerUrl = typeof body?.url === 'string' ? body.url : null;

        if (!providerUrl) {
            return of(
                new HttpResponse({
                    status: 400,
                    body: { message: 'Missing url', status: 400 },
                })
            );
        }

        return of(
            new HttpResponse({
                status: 200,
                body: { targetId: this.targets.register(providerUrl) },
            })
        );
    }

    private forwardToProvider(
        request: HttpRequest<unknown>,
        next: HttpHandler
    ): Observable<HttpEvent<unknown>> {
        const targetId = request.params.get(TARGET_ID_PARAM);
        const providerUrl = targetId ? this.targets.resolve(targetId) : null;

        if (!providerUrl) {
            // Nothing sensible to call. Falling through would hit the proxy
            // that may not exist; a shaped error keeps PwaService's handling.
            return of(
                new HttpResponse({
                    status: 400,
                    body: {
                        message: 'Unknown provider target',
                        status: 400,
                    },
                })
            );
        }

        const params = forwardableParams(this.asRecord(request.params));
        const action = params['action'];

        const providerRequest = request.clone({
            url: buildPlayerApiUrl(providerUrl),
            params: new HttpParams({ fromObject: params }),
        });

        return next.handle(providerRequest).pipe(
            map((event) =>
                event instanceof HttpResponse
                    ? event.clone({ body: wrapProviderPayload(action, event.body) })
                    : event
            )
        );
    }

    private asRecord(params: HttpParams): Record<string, string> {
        const record: Record<string, string> = {};

        for (const key of params.keys()) {
            const value = params.get(key);
            if (value !== null) {
                record[key] = value;
            }
        }

        return record;
    }
}
