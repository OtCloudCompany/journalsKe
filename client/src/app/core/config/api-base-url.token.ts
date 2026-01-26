import { InjectionToken, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { environment } from '../../../environments/environment';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
    providedIn: 'root',
    factory: () => {
        const platformId = inject(PLATFORM_ID);
        if (isPlatformServer(platformId)) {
            return process.env['API_BASE_URL'] ?? environment.API_BASE_URL;
        }
        const globalValue = (globalThis as Record<string, unknown>)['__API_BASE_URL__'];
        return typeof globalValue === 'string' && globalValue.length > 0
            ? globalValue
            : environment.API_BASE_URL;
    }
});
