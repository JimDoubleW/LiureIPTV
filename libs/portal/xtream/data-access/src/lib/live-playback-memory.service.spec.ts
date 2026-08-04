import { TestBed } from '@angular/core/testing';
import { LivePlaybackMemoryService } from './live-playback-memory.service';

function playback(streamUrl: string) {
    return { streamUrl, title: 'Channel' };
}

describe('LivePlaybackMemoryService', () => {
    let service: LivePlaybackMemoryService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(LivePlaybackMemoryService);
    });

    it('keeps the playback across route changes', () => {
        // The point of the service: the live layout is routed, so a
        // component-local signal lost the channel on the way to Movies.
        service.remember('portal-1');
        service.playback.set(playback('http://example.com/1.ts'));

        service.forgetIfOtherPlaylist('portal-1');

        expect(service.playback()?.streamUrl).toBe('http://example.com/1.ts');
    });

    it('drops it when the portal changed', () => {
        // Resuming another provider's stream would play the wrong channel or a
        // dead URL.
        service.remember('portal-1');
        service.playback.set(playback('http://example.com/1.ts'));

        service.forgetIfOtherPlaylist('portal-2');

        expect(service.playback()).toBeNull();
    });

    it('treats a missing playlist id as its own portal', () => {
        service.remember(undefined);
        service.playback.set(playback('http://example.com/1.ts'));

        service.forgetIfOtherPlaylist(undefined);

        expect(service.playback()).not.toBeNull();
    });

    it('only drops once, so a second visit to the new portal keeps playing', () => {
        service.remember('portal-1');
        service.playback.set(playback('http://example.com/1.ts'));

        service.forgetIfOtherPlaylist('portal-2');
        service.playback.set(playback('http://example.com/2.ts'));
        service.forgetIfOtherPlaylist('portal-2');

        expect(service.playback()?.streamUrl).toBe('http://example.com/2.ts');
    });

    it('remembers the category the channel airs in', () => {
        service.remember('portal-1', 170);

        expect(service.categoryId).toBe(170);
    });

    it('normalizes a string category id, matching the API shape', () => {
        service.remember('portal-1', '170');

        expect(service.categoryId).toBe(170);
    });

    it('leaves the category id untouched when the caller does not pass one', () => {
        // forgetIfOtherPlaylist calls remember() indirectly with no category
        // in some paths; it must not silently wipe a value set moments ago.
        service.remember('portal-1', 170);

        service.remember('portal-1');

        expect(service.categoryId).toBe(170);
    });

    it('clears the category id when the portal changes', () => {
        service.remember('portal-1', 170);

        service.forgetIfOtherPlaylist('portal-2');

        expect(service.categoryId).toBeNull();
    });

    it('discards a non-numeric category id', () => {
        service.remember('portal-1', 'not-a-number');

        expect(service.categoryId).toBeNull();
    });
});
