import { TestBed } from '@angular/core/testing';
import { UntypedFormBuilder } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from '../services/settings.service';
import { SettingsFormFacade } from './settings-form.facade';
import { SettingsSnackbarService } from './settings-snackbar.service';
import {
    createElectronStub,
    createEpgBridgeStub,
    MatSnackBarStub,
    MockSettingsService,
    MockSettingsStore,
} from './test-stubs/settings-test-harness.stub';

describe('SettingsFormFacade save', () => {
    let facade: SettingsFormFacade;
    let settingsStore: MockSettingsStore;
    const originalElectron = window.electron;

    beforeEach(() => {
        window.electron = createElectronStub();

        TestBed.configureTestingModule({
            providers: [
                UntypedFormBuilder,
                SettingsFormFacade,
                SettingsSnackbarService,
                RuntimeCapabilitiesService,
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: createEpgBridgeStub(),
                },
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: SettingsService, useClass: MockSettingsService },
                { provide: SettingsStore, useClass: MockSettingsStore },
            ],
            imports: [TranslateModule.forRoot()],
        });

        facade = TestBed.inject(SettingsFormFacade);
        settingsStore = TestBed.inject(
            SettingsStore
        ) as unknown as MockSettingsStore;
        jest.spyOn(
            TestBed.inject(TranslateService),
            'instant'
        ).mockImplementation((key) => key);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('ignores a second save that arrives while the first is still in flight', async () => {
        // A remote's IR receiver reporting one physical OK press as two
        // discrete key events would otherwise fire two concurrent writes of
        // the same form to storage — confirmed as a real possibility on the
        // reference device while investigating an intermittent "settings
        // could not be saved" report.
        let resolveUpdate: () => void = () => undefined;
        settingsStore.updateSettings.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveUpdate = resolve;
            })
        );
        const firstOnSaved = jest.fn();
        const secondOnSaved = jest.fn();

        const firstSave = facade.save(firstOnSaved);
        const secondSave = facade.save(secondOnSaved);

        expect(settingsStore.updateSettings).toHaveBeenCalledTimes(1);

        resolveUpdate();
        await Promise.all([firstSave, secondSave]);

        expect(settingsStore.updateSettings).toHaveBeenCalledTimes(1);
        expect(firstOnSaved).toHaveBeenCalledTimes(1);
        expect(secondOnSaved).not.toHaveBeenCalled();
    });

    it('allows a new save once the previous one has finished', async () => {
        const onSaved = jest.fn();

        await facade.save(onSaved);
        await facade.save(onSaved);

        expect(settingsStore.updateSettings).toHaveBeenCalledTimes(2);
        expect(onSaved).toHaveBeenCalledTimes(2);
    });

    it('releases the guard even when the save rejects', async () => {
        settingsStore.updateSettings.mockRejectedValueOnce(
            new Error('storage unavailable')
        );
        const onSaved = jest.fn();

        await expect(facade.save(onSaved)).rejects.toThrow(
            'storage unavailable'
        );
        expect(onSaved).not.toHaveBeenCalled();

        await facade.save(onSaved);

        expect(settingsStore.updateSettings).toHaveBeenCalledTimes(2);
        expect(onSaved).toHaveBeenCalledTimes(1);
    });
});

describe('SettingsFormFacade save on the Android partial bridge', () => {
    // window.electron is truthy on Android too (android-epg-bridge.ts installs
    // a partial, EPG-only object so duck-typed capability probes light up),
    // but it has no updateSettings/setMpvPlayerPath/setVlcPlayerPath. save()
    // used to gate the desktop-mirroring calls on `!window.electron` alone,
    // so it called the missing updateSettings unconditionally — throwing
    // *after* the store write and onSaved() had already succeeded, which is
    // what actually produced the user-reported "settings could not be saved"
    // banner on a save that had, in fact, saved. Confirmed live on the
    // reference device: the persisted value and pristine form both showed
    // success while the failure snackbar was still on screen.
    let facade: SettingsFormFacade;
    let settingsStore: MockSettingsStore;
    const originalElectron = window.electron;
    const originalCapacitor = (
        globalThis as unknown as { Capacitor?: unknown }
    ).Capacitor;

    beforeEach(() => {
        window.electron = {
            fetchEpg: jest.fn(),
        } as unknown as typeof window.electron;
        (
            globalThis as unknown as { Capacitor: { getPlatform(): string } }
        ).Capacitor = { getPlatform: () => 'android' };

        TestBed.configureTestingModule({
            providers: [
                UntypedFormBuilder,
                SettingsFormFacade,
                SettingsSnackbarService,
                RuntimeCapabilitiesService,
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: createEpgBridgeStub(),
                },
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: SettingsService, useClass: MockSettingsService },
                { provide: SettingsStore, useClass: MockSettingsStore },
            ],
            imports: [TranslateModule.forRoot()],
        });

        facade = TestBed.inject(SettingsFormFacade);
        settingsStore = TestBed.inject(
            SettingsStore
        ) as unknown as MockSettingsStore;
        jest.spyOn(
            TestBed.inject(TranslateService),
            'instant'
        ).mockImplementation((key) => key);
    });

    afterEach(() => {
        window.electron = originalElectron;
        (globalThis as unknown as { Capacitor?: unknown }).Capacitor =
            originalCapacitor;
    });

    it('does not call the missing desktop-mirror methods and resolves cleanly', async () => {
        const onSaved = jest.fn();

        await expect(facade.save(onSaved)).resolves.toBeUndefined();

        expect(settingsStore.updateSettings).toHaveBeenCalledTimes(1);
        expect(onSaved).toHaveBeenCalledTimes(1);
    });
});
