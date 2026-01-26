import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';

import { AuthStateService } from '../services/auth-state.service';

const AUTH_EXCLUDED_ENDPOINTS = [/\/auth\/token\//, /\/auth\/token\/refresh\//];

function needsAuthHeader(req: HttpRequest<unknown>): boolean {
    return !AUTH_EXCLUDED_ENDPOINTS.some(regex => regex.test(req.url));
}

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> => {
    const authState = inject(AuthStateService);
    let authReq = req;
    const accessToken = authState.accessToken;

    if (accessToken && needsAuthHeader(req)) {
        authReq = req.clone({
            setHeaders: {
                Authorization: `Bearer ${accessToken}`
            }
        });
    }

    return next(authReq).pipe(
        catchError((error: HttpErrorResponse) => {
            if (error.status === 401 && authState.refreshToken && needsAuthHeader(req)) {
                return authState.refreshTokens().pipe(
                    switchMap(tokens => {
                        const retryReq = req.clone({
                            setHeaders: {
                                Authorization: `Bearer ${tokens.access}`
                            }
                        });
                        return next(retryReq);
                    }),
                    catchError(refreshError => {
                        authState.logout();
                        return throwError(() => refreshError);
                    })
                );
            }
            return throwError(() => error);
        })
    );
};
