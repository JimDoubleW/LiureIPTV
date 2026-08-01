import { inject, Injectable, InjectionToken } from '@angular/core';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { PlaylistBackupImportApplyService } from '../playlist-backup-import-apply.service';
import { isAndroidRuntime } from './android-runtime';

interface BackupImportReceivedEvent {
    json: string;
}

interface BackupImportNativePlugin {
    addListener(
        eventName: 'backupImportReceived',
        listenerFunc: (event: BackupImportReceivedEvent) => void
    ): Promise<PluginListenerHandle>;
}

/**
 * Isolated behind a token so tests can substitute a fake without exercising
 * Capacitor's real plugin-resolution proxy, which rejects any method call
 * when no native or web implementation is registered for it — there is no
 * 'web' implementation here, this plugin is Android-only.
 */
export const BACKUP_IMPORT_PLUGIN =
    new InjectionToken<BackupImportNativePlugin>('BACKUP_IMPORT_PLUGIN', {
        factory: () =>
            registerPlugin<BackupImportNativePlugin>('BackupImport'),
    });

/**
 * Applies a playlist backup shared into the app from outside — a file
 * manager's "Share" action, the native counterpart of the Android share-sheet
 * export in `SettingsBackupFacade`.
 *
 * This is the only way to hand this app a backup file on Android: opening
 * Settings' native file chooser needs genuine user activation, which the
 * D-pad engine's synthetic key dispatch to the WebView cannot provide (see
 * MainActivity.dispatchKeyEvent's doc comment). A share intent instead
 * arrives with real OS-level activation, sidestepping the chooser entirely.
 *
 * `BackupImportPlugin#handleOnNewIntent`
 * (android/app/.../BackupImportPlugin.java) fires for both a cold start —
 * Capacitor's own BridgeActivity#load() replays the launch intent through
 * onNewIntent — and a share arriving while the app is already running, and
 * retains the event natively until a JS listener registers
 * (`notifyListeners(..., true)`), so subscribing here once, at app start,
 * never misses a share that landed before Angular finished bootstrapping.
 */
@Injectable({ providedIn: 'root' })
export class AndroidBackupImportService {
    private readonly plugin = inject(BACKUP_IMPORT_PLUGIN);
    private readonly applyService = inject(PlaylistBackupImportApplyService);
    private started = false;

    start(): void {
        if (this.started || !isAndroidRuntime()) {
            return;
        }

        this.started = true;
        this.plugin
            .addListener('backupImportReceived', (event) => {
                void this.applyService.apply(event.json);
            })
            .catch((error) => {
                console.error(
                    'Failed to listen for shared playlist backups:',
                    error
                );
            });
    }
}
