import { inject, Injectable, Injector, signal } from '@angular/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    PlaylistBackupImportSummary,
    PlaylistBackupService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { isAndroidRuntime } from '../services/android/android-runtime';
import { SettingsSnackbarService } from './settings-snackbar.service';

@Injectable()
export class SettingsBackupFacade {
    private readonly playlistBackupService = inject(PlaylistBackupService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly injector = inject(Injector);

    readonly isExportingData = signal(false);

    async exportData(waitForUiFeedbackFrame: () => Promise<void>) {
        if (this.isExportingData()) {
            return;
        }

        this.isExportingData.set(true);
        await waitForUiFeedbackFrame();

        try {
            const backup = await this.playlistBackupService.exportBackup();

            if (this.runtime.supportsDesktopFileSave && window.electron) {
                const savePath = await window.electron.saveFileDialog(
                    backup.defaultFileName,
                    [
                        {
                            name: 'JSON',
                            extensions: ['json'],
                        },
                    ]
                );

                if (!savePath) {
                    return;
                }

                await window.electron.writeFile(savePath, backup.json);
            } else if (isAndroidRuntime()) {
                // The browser download flow below (Blob + `<a download>`)
                // has no native download manager to catch it in the
                // Capacitor WebView — no DownloadListener is registered, and
                // there is no Filesystem-backed "Downloads" write without a
                // permission prompt on modern Android. Confirmed on the
                // reference device: the click ran, exportData() reported
                // success, and no file ever reached anywhere the user could
                // find it. Writing to the app's own cache dir needs no
                // permission, and the native share sheet is what lets the
                // user actually put the file somewhere (Drive, email, a
                // files app) — the same reason TiviMate and other TV IPTV
                // apps hand backups off to a share sheet instead of a
                // Downloads folder that is not reliably browsable on a TV.
                await this.shareBackupOnAndroid(
                    backup.defaultFileName,
                    backup.json
                );
            } else {
                this.downloadBackupInBrowser(
                    backup.defaultFileName,
                    backup.json
                );
            }

            this.settingsSnackbar.open('Playlist backup exported.');
        } catch (error) {
            console.error('Failed to export playlist backup:', error);
            this.settingsSnackbar.open('Playlist backup export failed.');
        } finally {
            this.isExportingData.set(false);
        }
    }

    importData(onImported: () => void): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.addEventListener('change', async (event: Event) => {
            const target = event.target as HTMLInputElement;
            const file = target.files?.[0];

            if (!file) {
                return;
            }

            try {
                const summary = await this.playlistBackupService.importBackup(
                    await file.text()
                );
                this.injector
                    .get(XtreamStore, null)
                    ?.reconcilePendingRestoreBlock();

                if (summary.imported > 0 || summary.merged > 0) {
                    this.store.dispatch(PlaylistActions.removeAllPlaylists());
                    this.store.dispatch(PlaylistActions.loadPlaylists());
                }

                onImported();
                this.settingsSnackbar.open(
                    this.buildBackupImportSummary(summary)
                );

                if (summary.errors.length > 0) {
                    console.error(
                        'Playlist backup import completed with issues:',
                        summary.errors
                    );
                }
            } catch (error) {
                console.error('Failed to import playlist backup:', error);
                this.settingsSnackbar.open(
                    error instanceof Error
                        ? error.message
                        : this.translate.instant('SETTINGS.IMPORT_ERROR')
                );
            }
        });

        input.click();
    }

    /**
     * Writes the backup into the app's own cache dir (no permission needed)
     * and hands it to the native share sheet, which is what actually lets
     * the user put the file somewhere they can find it again.
     */
    private async shareBackupOnAndroid(
        defaultFileName: string,
        json: string
    ): Promise<void> {
        const { uri } = await Filesystem.writeFile({
            path: defaultFileName,
            data: json,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
        });

        await Share.share({
            title: defaultFileName,
            files: [uri],
        });
    }

    private downloadBackupInBrowser(
        defaultFileName: string,
        json: string
    ): void {
        const blob = new Blob([json], {
            type: 'application/json',
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = defaultFileName;
        link.click();
        window.URL.revokeObjectURL(url);
    }

    private buildBackupImportSummary(
        summary: PlaylistBackupImportSummary
    ): string {
        return `Backup import finished: ${summary.imported} imported, ${summary.merged} merged, ${summary.skipped} skipped, ${summary.failed} failed.`;
    }
}
