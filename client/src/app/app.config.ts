import { ApplicationConfig, APP_INITIALIZER, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthStateService } from './core/services/auth-state.service';
import { catchError, firstValueFrom, of } from 'rxjs';

function authInitializerFactory(authState: AuthStateService) {
  return () => {
    authState.ensureTokensLoaded();

    if (authState.isAuthenticated && !authState.profile) {
      return firstValueFrom(
        authState.loadProfile(true).pipe(
          catchError(() => {
            // Defer logout to the guard/interceptor; just resolve so bootstrap can continue.
            return of(null);
          })
        )
      ).then(() => void 0);
    }

    return Promise.resolve();
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideClientHydration(withEventReplay()),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: authInitializerFactory,
      deps: [AuthStateService]
    }
  ]
};
