import type { DownloadItem } from '@iptvnator/services';
import { DownloadsComponent } from './downloads.component';

type DownloadsNavigationHarness = {
    dbService: {
        getContentByXtreamId: jest.Mock;
    };
    openXtreamItem(item: DownloadItem): Promise<void>;
    router: {
        navigate: jest.Mock;
    };
};

describe('DownloadsComponent navigation', () => {
    it('opens the movie detail when Electron content lookup is unavailable', async () => {
        const component = Object.create(
            DownloadsComponent.prototype
        ) as DownloadsNavigationHarness;
        component.dbService = {
            getContentByXtreamId: jest.fn().mockResolvedValue(null),
        };
        component.router = {
            navigate: jest.fn().mockResolvedValue(true),
        };
        const item: DownloadItem = {
            id: 1,
            playlistId: 'playlist-1',
            xtreamId: 42,
            contentType: 'vod',
            title: 'Downloaded movie',
            url: 'https://provider.example/movie/42.mp4',
            status: 'completed',
        };

        await component.openXtreamItem(item);

        expect(component.router.navigate).toHaveBeenCalledWith([
            '/workspace',
            'xtreams',
            'playlist-1',
            'vod',
            '0',
            '42',
        ]);
    });
});
