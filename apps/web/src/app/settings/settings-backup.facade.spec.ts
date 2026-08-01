import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { PlaylistBackupService } from '@iptvnator/services';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockProvider } from 'ng-mocks';
import { SettingsBackupFacade } from './settings-backup.facade';
import { SettingsSnackbarService } from './settings-snackbar.service';
import {
    BACKUP_EXPORT_RESULT,
    createElectronStub,
    MatSnackBarStub,
} from './test-stubs/settings-test-harness.stub';

// @capacitor/filesystem's real web fallback needs IndexedDB, unavailable in
// jsdom; @capacitor/share has no meaningful web behavior either. Both are
// redirected to controllable jest.fn()-based stubs via jest.config.ts's
// moduleNameMapper (see apps/web/src/test-stubs/capacitor-*.js) — the same
// mechanism already used for video.js, and more reliable here than
// jest.unstable_mockModule, which did not intercept these packages under
// this project's ESM jest preset.

describe('SettingsBackupFacade', () => {
    let facade: SettingsBackupFacade;
    let playlistBackupService: PlaylistBackupService;
    const originalElectron = window.electron;

    /** The component normally supplies a paint frame; tests skip the wait */
    const noWait = () => Promise.resolve();

    function configure(): void {
        TestBed.configureTestingModule({
            providers: [
                SettingsBackupFacade,
                SettingsSnackbarService,
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                MockProvider(PlaylistBackupService, {
                    exportBackup: jest
                        .fn()
                        .mockResolvedValue(BACKUP_EXPORT_RESULT),
                    importBackup: jest.fn(),
                }),
                MockProvider(XtreamStore, {
                    reconcilePendingRestoreBlock: jest.fn(),
                }),
                provideMockStore({
                    selectors: [
                        { selector: selectAllPlaylistsMeta, value: [] },
                        { selector: selectIsEpgAvailable, value: false },
                    ],
                }),
            ],
            imports: [TranslateModule.forRoot()],
        });

        facade = TestBed.inject(SettingsBackupFacade);
        playlistBackupService = TestBed.inject(PlaylistBackupService);
    }

    beforeEach(() => {
        window.electron = createElectronStub();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('shows an export busy state until the backup file has been written', async () => {
        configure();
        let resolveExport: (value: typeof BACKUP_EXPORT_RESULT) => void = () =>
            undefined;
        (playlistBackupService.exportBackup as jest.Mock).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveExport = resolve;
            })
        );

        const exportPromise = facade.exportData(noWait);

        expect(facade.isExportingData()).toBe(true);

        resolveExport(BACKUP_EXPORT_RESULT);
        await exportPromise;

        expect(window.electron.saveFileDialog).toHaveBeenCalledWith(
            BACKUP_EXPORT_RESULT.defaultFileName,
            [
                {
                    extensions: ['json'],
                    name: 'JSON',
                },
            ]
        );
        expect(window.electron.writeFile).toHaveBeenCalledWith(
            '/tmp/backup.json',
            '{}'
        );
        expect(facade.isExportingData()).toBe(false);
    });

    it('falls back to browser backup download when desktop file-save preload is incomplete', async () => {
        const saveFileDialog = jest.fn().mockResolvedValue('/tmp/backup.json');
        window.electron = {
            platform: 'linux',
            saveFileDialog,
        } as unknown as typeof window.electron;
        configure();

        const createObjectURL = jest.fn().mockReturnValue('blob:backup');
        const revokeObjectURL = jest.fn();
        const originalCreateObjectURL = window.URL.createObjectURL;
        const originalRevokeObjectURL = window.URL.revokeObjectURL;
        Object.defineProperty(window.URL, 'createObjectURL', {
            configurable: true,
            value: createObjectURL,
        });
        Object.defineProperty(window.URL, 'revokeObjectURL', {
            configurable: true,
            value: revokeObjectURL,
        });
        const clickSpy = jest
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation();

        try {
            await facade.exportData(noWait);

            expect(saveFileDialog).not.toHaveBeenCalled();
            expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
            expect(clickSpy).toHaveBeenCalled();
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup');
        } finally {
            clickSpy.mockRestore();
            Object.defineProperty(window.URL, 'createObjectURL', {
                configurable: true,
                value: originalCreateObjectURL,
            });
            Object.defineProperty(window.URL, 'revokeObjectURL', {
                configurable: true,
                value: originalRevokeObjectURL,
            });
        }
    });

    it('shares the backup via the native share sheet on Android instead of the browser download', async () => {
        // Reported by the user: exporting a playlist backup failed on
        // Android. That crash (window.electron.dbGetAllCategories is not a
        // function, in PlaylistBackupService) is fixed separately; this
        // covers what must happen once the export itself succeeds. Two
        // things must NOT happen: window.electron is truthy on Android too
        // (the partial, EPG-only bridge), so this must not take the
        // Electron save-dialog branch; and the Blob + <a download> browser
        // fallback has no native download manager to catch it in the
        // Capacitor WebView, so it must not take that branch either.
        // Confirmed on the reference device: before this fix, the click ran,
        // exportData() reported success, and no file ever reached anywhere
        // the user could find it.
        (
            globalThis as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };
        // The real Android bridge (android-epg-bridge.ts) has no
        // saveFileDialog/writeFile — using the full Electron stub here would
        // make supportsDesktopFileSave true regardless of platform and hide
        // exactly the bug this test exists for.
        window.electron = {
            fetchEpg: jest.fn(),
        } as unknown as typeof window.electron;
        (Filesystem.writeFile as jest.Mock).mockResolvedValueOnce({
            uri: 'file:///cache/iptvnator-playlist-backup-2026-04-21.json',
        });
        configure();

        const createObjectURL = jest.fn();
        Object.defineProperty(window.URL, 'createObjectURL', {
            configurable: true,
            value: createObjectURL,
        });

        try {
            await facade.exportData(noWait);

            expect(window.electron.saveFileDialog).toBeUndefined();
            expect(createObjectURL).not.toHaveBeenCalled();
            expect(Filesystem.writeFile).toHaveBeenCalledWith({
                path: BACKUP_EXPORT_RESULT.defaultFileName,
                data: BACKUP_EXPORT_RESULT.json,
                directory: 'CACHE',
                encoding: 'utf8',
            });
            expect(Share.share).toHaveBeenCalledWith({
                title: BACKUP_EXPORT_RESULT.defaultFileName,
                files: [
                    'file:///cache/iptvnator-playlist-backup-2026-04-21.json',
                ],
            });
        } finally {
            delete (globalThis as { Capacitor?: unknown }).Capacitor;
        }
    });

    it('reports a failed export and clears the busy state', async () => {
        configure();
        (playlistBackupService.exportBackup as jest.Mock).mockRejectedValueOnce(
            new Error('disk full')
        );
        jest.spyOn(console, 'error').mockImplementation();
        const snackBar = TestBed.inject(
            MatSnackBar
        ) as unknown as MatSnackBarStub;

        await facade.exportData(noWait);

        expect(facade.isExportingData()).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'Playlist backup export failed.',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
    });

    it('reconciles a pending Xtream restore before completing an import', async () => {
        configure();
        const input = document.createElement('input');
        const file = {
            text: jest.fn().mockResolvedValue('{}'),
        } as unknown as File;
        Object.defineProperty(input, 'files', { value: [file] });
        const addEventListener = jest.spyOn(input, 'addEventListener');
        const createElement = jest
            .spyOn(document, 'createElement')
            .mockReturnValue(input);
        jest.spyOn(input, 'click').mockImplementation();
        const summary = {
            imported: 0,
            merged: 0,
            skipped: 0,
            failed: 1,
            errors: ['pending restore state could not be consumed'],
        };
        (playlistBackupService.importBackup as jest.Mock).mockResolvedValue(
            summary
        );
        const onImported = jest.fn();
        const xtreamStore = TestBed.inject(XtreamStore);

        facade.importData(onImported);
        const changeListener = addEventListener.mock.calls.find(
            ([type]) => type === 'change'
        )?.[1] as (event: Event) => Promise<void>;
        await changeListener({ target: input } as unknown as Event);

        expect(xtreamStore.reconcilePendingRestoreBlock).toHaveBeenCalledTimes(
            1
        );
        expect(onImported).toHaveBeenCalledTimes(1);
        expect(
            (xtreamStore.reconcilePendingRestoreBlock as jest.Mock).mock
                .invocationCallOrder[0]
        ).toBeLessThan(onImported.mock.invocationCallOrder[0]);
        createElement.mockRestore();
    });
});
