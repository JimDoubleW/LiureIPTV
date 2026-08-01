import { inject, Injectable, Injector } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    PlaylistBackupImportSummary,
    PlaylistBackupService,
} from '@iptvnator/services';

/**
 * Applies an already-read playlist backup JSON payload: import, Xtream
 * restore reconciliation, playlist reload, and a user-facing summary.
 *
 * Shared by two entry points that both hand the app a backup to restore:
 * the Settings page's file picker (`SettingsBackupFacade.importData`) and,
 * on Android, a backup shared in from outside the app
 * (`AndroidBackupImportService`) — see CLAUDE.android.md's "Fixed Bug:
 * playlist backup import unreachable on Android".
 */
@Injectable({ providedIn: 'root' })
export class PlaylistBackupImportApplyService {
    private readonly playlistBackupService = inject(PlaylistBackupService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly injector = inject(Injector);

    async apply(
        json: string,
        onImported: () => void = () => undefined
    ): Promise<void> {
        try {
            const summary =
                await this.playlistBackupService.importBackup(json);
            this.injector
                .get(XtreamStore, null)
                ?.reconcilePendingRestoreBlock();

            if (summary.imported > 0 || summary.merged > 0) {
                this.store.dispatch(PlaylistActions.removeAllPlaylists());
                this.store.dispatch(PlaylistActions.loadPlaylists());
            }

            onImported();
            this.openSnackbar(this.buildSummaryMessage(summary));

            if (summary.errors.length > 0) {
                console.error(
                    'Playlist backup import completed with issues:',
                    summary.errors
                );
            }
        } catch (error) {
            console.error('Failed to import playlist backup:', error);
            this.openSnackbar(
                error instanceof Error
                    ? error.message
                    : this.translate.instant('SETTINGS.IMPORT_ERROR')
            );
        }
    }

    private openSnackbar(message: string): void {
        this.snackBar.open(message, undefined, {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['settings-snackbar'],
        });
    }

    private buildSummaryMessage(
        summary: PlaylistBackupImportSummary
    ): string {
        return `Backup import finished: ${summary.imported} imported, ${summary.merged} merged, ${summary.skipped} skipped, ${summary.failed} failed.`;
    }
}
