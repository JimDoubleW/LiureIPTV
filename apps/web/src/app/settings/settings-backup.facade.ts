import { inject, Injectable, signal } from '@angular/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
    PlaylistBackupService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { isAndroidRuntime } from '../services/android/android-runtime';
import { PlaylistBackupImportApplyService } from '../services/playlist-backup-import-apply.service';
import { SettingsSnackbarService } from './settings-snackbar.service';

@Injectable()
export class SettingsBackupFacade {
    private readonly playlistBackupService = inject(PlaylistBackupService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsSnackbar = inject(SettingsSnackbarService);
    private readonly backupImportApply = inject(
        PlaylistBackupImportApplyService
    );

    readonly isExportingData = signal(false);
    readonly isAndroid = isAndroidRuntime();

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
        if (this.isAndroid) {
            // <input type="file">.click() cannot open Android's native file
            // chooser here: it requires genuine user activation, and a D-pad
            // OK press only reaches this button via
            // WebView#evaluateJavascript (MainActivity.dispatchKeyEvent),
            // which carries none. Before this message, pressing the button
            // did nothing at all — confirmed on the reference device with a
            // real remote press, not just a CDP click, and reported by the
            // user as "import ne marche pas" once the silent failure looked
            // identical to a totally broken feature. The real, working path
            // is BackupImportPlugin's share-intent receiver (see
            // AndroidBackupImportService), reachable only from outside the
            // app, so the button's only job on this platform is to say so.
            this.settingsSnackbar.error(
                'To import a backup on Android, open your file manager, select the backup .json file, and share it into this app.',
                'OK'
            );
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';

        input.addEventListener('change', async (event: Event) => {
            const target = event.target as HTMLInputElement;
            const file = target.files?.[0];

            if (!file) {
                return;
            }

            await this.backupImportApply.apply(await file.text(), onImported);
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
}
