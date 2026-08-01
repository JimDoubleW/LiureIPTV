import { TestBed } from '@angular/core/testing';
import { MockProvider } from 'ng-mocks';
import { PlaylistBackupImportApplyService } from '../playlist-backup-import-apply.service';
import {
    AndroidBackupImportService,
    BACKUP_IMPORT_PLUGIN,
} from './android-backup-import.service';

describe('AndroidBackupImportService', () => {
    let service: AndroidBackupImportService;
    let applyService: PlaylistBackupImportApplyService;
    let plugin: { addListener: jest.Mock };
    const originalCapacitor = (
        globalThis as unknown as { Capacitor?: unknown }
    ).Capacitor;

    function configure(): void {
        plugin = { addListener: jest.fn().mockResolvedValue({ remove: jest.fn() }) };

        TestBed.configureTestingModule({
            providers: [
                { provide: BACKUP_IMPORT_PLUGIN, useValue: plugin },
                MockProvider(PlaylistBackupImportApplyService, {
                    apply: jest.fn().mockResolvedValue(undefined),
                }),
            ],
        });

        service = TestBed.inject(AndroidBackupImportService);
        applyService = TestBed.inject(PlaylistBackupImportApplyService);
    }

    afterEach(() => {
        (globalThis as { Capacitor?: unknown }).Capacitor = originalCapacitor;
    });

    it('does not register a listener off the Android runtime', () => {
        configure();

        service.start();

        expect(plugin.addListener).not.toHaveBeenCalled();
    });

    it('registers a listener exactly once on Android and applies a received backup', () => {
        (
            globalThis as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };
        configure();

        service.start();
        service.start();

        expect(plugin.addListener).toHaveBeenCalledTimes(1);
        expect(plugin.addListener).toHaveBeenCalledWith(
            'backupImportReceived',
            expect.any(Function)
        );

        const listener = plugin.addListener.mock.calls[0][1] as (event: {
            json: string;
        }) => void;
        listener({ json: '{"playlists":[]}' });

        expect(applyService.apply).toHaveBeenCalledWith(
            '{"playlists":[]}'
        );
    });
});
