import {
    buildPlayerApiUrl,
    forwardableParams,
    parseProviderData,
    ProviderTargetRegistry,
    wrapProviderPayload,
} from './portal-direct-request';

describe('portal direct request', () => {
    describe('buildPlayerApiUrl', () => {
        it('appends the API path to a bare host', () => {
            expect(buildPlayerApiUrl('http://example.com')).toBe(
                'http://example.com/player_api.php'
            );
        });

        it('does not double the separator when the URL ends in a slash', () => {
            // Provider URLs are typed by hand and arrive both ways; `//` makes
            // some providers answer with an HTML error page instead of JSON.
            expect(buildPlayerApiUrl('http://example.com/')).toBe(
                'http://example.com/player_api.php'
            );
        });

        it('keeps an existing path segment', () => {
            expect(buildPlayerApiUrl('http://example.com/iptv')).toBe(
                'http://example.com/iptv/player_api.php'
            );
        });

        it('preserves a non-default port', () => {
            expect(buildPlayerApiUrl('http://example.com:8080')).toBe(
                'http://example.com:8080/player_api.php'
            );
        });
    });

    describe('ProviderTargetRegistry', () => {
        it('round-trips a registered provider URL', () => {
            const registry = new ProviderTargetRegistry();
            const id = registry.register('http://example.com');

            expect(registry.resolve(id)).toBe('http://example.com');
        });

        it('returns a stable id for the same URL', () => {
            const registry = new ProviderTargetRegistry();

            expect(registry.register('http://example.com')).toBe(
                registry.register('http://example.com')
            );
        });

        it('keeps distinct providers apart', () => {
            const registry = new ProviderTargetRegistry();
            const first = registry.register('http://one.example');
            const second = registry.register('http://two.example');

            expect(first).not.toBe(second);
            expect(registry.resolve(second)).toBe('http://two.example');
        });

        it('resolves an unknown id to null', () => {
            expect(new ProviderTargetRegistry().resolve('nope')).toBeNull();
        });
    });

    describe('forwardableParams', () => {
        it('drops targetId, which means nothing to the provider', () => {
            expect(
                forwardableParams({
                    targetId: 'android-target-0',
                    action: 'get_live_categories',
                    username: 'u',
                })
            ).toEqual({ action: 'get_live_categories', username: 'u' });
        });

        it('leaves untouched params that carry no targetId', () => {
            expect(forwardableParams({ action: 'get_series' })).toEqual({
                action: 'get_series',
            });
        });
    });

    describe('parseProviderData', () => {
        // Native HTTP parses the body only when the provider sets a JSON
        // content type, and IPTV providers are inconsistent about that.
        it('parses a JSON string body', () => {
            expect(parseProviderData('[{"id":1}]')).toEqual([{ id: 1 }]);
        });

        it('passes an already-parsed body through', () => {
            const parsed = [{ id: 1 }];
            expect(parseProviderData(parsed)).toBe(parsed);
        });

        it('returns unparseable bodies untouched for the caller to handle', () => {
            // Providers answer errors with an HTML page; throwing here would
            // hide the real message from PwaService's error normalisation.
            expect(parseProviderData('<html>denied</html>')).toBe(
                '<html>denied</html>'
            );
        });
    });

    describe('wrapProviderPayload', () => {
        it('matches the envelope PwaService expects from the proxy', () => {
            expect(wrapProviderPayload('get_live_streams', [{ id: 1 }])).toEqual({
                action: 'get_live_streams',
                payload: [{ id: 1 }],
            });
        });
    });
});
