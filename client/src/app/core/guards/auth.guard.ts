import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';

import { AuthStateService } from '../services/auth-state.service';

export const authGuard: CanActivateFn = (route, state): boolean | UrlTree | Observable<boolean | UrlTree> => {
    const authState = inject(AuthStateService);
    const router = inject(Router);
    const platformId = inject(PLATFORM_ID);

    if (!isPlatformBrowser(platformId)) {
        // During server-side rendering we cannot access browser storage, so defer auth checks to the client.
        return true;
    }

    authState.ensureTokensLoaded();

    if (!authState.isAuthenticated) {
        return router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
    }

    if (!authState.profile) {
        authState.loadProfile(true).pipe(take(1)).subscribe({
            error: (error) => {
                if (error instanceof HttpErrorResponse && error.status === 401) {
                    authState.logout();
                }
            }
        });
    }

    return true;
};
