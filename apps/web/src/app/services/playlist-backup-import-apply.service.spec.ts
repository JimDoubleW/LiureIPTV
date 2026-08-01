import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaylistBackupService } from '@iptvnator/services';
import { Store } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockProvider } from 'ng-mocks';
import { PlaylistBackupImportApplyService } from './playlist-backup-import-apply.service';

describe('PlaylistBackupImportApplyService', () => {
    let service: PlaylistBackupImportApplyService;
    let playlistBackupService: PlaylistBackupService;
    let store: MockStore;
    let xtreamStore: XtreamStore;
    let snackBar: MatSnackBar;

    function configure(): void {
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                MockProvider(PlaylistBackupService, {
                    importBackup: jest.fn(),
                }),
                MockProvider(XtreamStore, {
                    reconcilePendingRestoreBlock: jest.fn(),
                }),
                MockProvider(MatSnackBar, {
                    open: jest.fn(),
                }),
                provideMockStore(),
            ],
        });

        service = TestBed.inject(PlaylistBackupImportApplyService);
        playlistBackupService = TestBed.inject(PlaylistBackupService);
        store = TestBed.inject(Store) as MockStore;
        xtreamStore = TestBed.inject(XtreamStore);
        snackBar = TestBed.inject(MatSnackBar);
    }

    beforeEach(() => {
        configure();
        jest.spyOn(console, 'error').mockImplementation();
    });

    it('imports, reconciles the pending Xtream restore, and reports a summary', async () => {
        const summary = {
            imported: 2,
            merged: 1,
            skipped: 0,
            failed: 0,
            errors: [] as string[],
        };
        (playlistBackupService.importBackup as jest.Mock).mockResolvedValue(
            summary
        );
        const dispatchSpy = jest.spyOn(store, 'dispatch');
        const onImported = jest.fn();

        await service.apply('{}', onImported);

        expect(playlistBackupService.importBackup).toHaveBeenCalledWith('{}');
        expect(xtreamStore.reconcilePendingRestoreBlock).toHaveBeenCalledTimes(
            1
        );
        expect(dispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.removeAllPlaylists()
        );
        expect(dispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.loadPlaylists()
        );
        expect(onImported).toHaveBeenCalledTimes(1);
        expect(snackBar.open).toHaveBeenCalledWith(
            'Backup import finished: 2 imported, 1 merged, 0 skipped, 0 failed.',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
    });

    it('does not reload playlists when nothing was imported or merged', async () => {
        const summary = {
            imported: 0,
            merged: 0,
            skipped: 3,
            failed: 0,
            errors: [] as string[],
        };
        (playlistBackupService.importBackup as jest.Mock).mockResolvedValue(
            summary
        );
        const dispatchSpy = jest.spyOn(store, 'dispatch');

        await service.apply('{}');

        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('defaults onImported to a no-op when the caller does not supply one', async () => {
        (playlistBackupService.importBackup as jest.Mock).mockResolvedValue({
            imported: 0,
            merged: 0,
            skipped: 0,
            failed: 0,
            errors: [],
        });

        await expect(service.apply('{}')).resolves.toBeUndefined();
    });

    it('reports a failed import without throwing', async () => {
        (playlistBackupService.importBackup as jest.Mock).mockRejectedValue(
            new Error('invalid backup')
        );

        await service.apply('not json');

        expect(snackBar.open).toHaveBeenCalledWith(
            'invalid backup',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
    });
});
