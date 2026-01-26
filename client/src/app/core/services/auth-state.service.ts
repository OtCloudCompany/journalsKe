import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { tap, map, switchMap } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';

import { AccountApiService } from './account-api.service';
import { ApiMessageResponse, ProfileResponse, ProfileUpdatePayload, RegistrationRequest, TokenResponse } from '../models/auth.models';

interface StoredTokens {
    access: string;
    refresh: string;
}

@Injectable({ providedIn: 'root' })
export class AuthStateService {
    private readonly storageKey = 'ubengwa-auth-tokens';
    private readonly accountApi = inject(AccountApiService);
    private readonly router = inject(Router);

    private readonly tokensSignal = signal<StoredTokens | null>(this.readTokensFromStorage());
    private readonly profileSignal = signal<ProfileResponse | null>(null);
    private readonly hydratedSignal = signal(false);
    private readonly inactivityLimitMs = 2 * 60 * 60 * 1000;
    private inactivityTimer: number | null = null;
    private readonly activityEvents: Array<keyof WindowEventMap> = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
    private readonly activityHandler = () => this.resetInactivityTimer();

    constructor() {
        this.ensureTokensLoaded();

        if (this.isAuthenticated) {
            this.startInactivityTracking();
            this.loadProfile(true).subscribe({
                next: () => { },
                error: (error) => {
                    if (error instanceof HttpErrorResponse && error.status === 401) {
                        this.logout();
                    }
                }
            });
        }
    }

    readonly tokens$ = toObservable(this.tokensSignal);
    readonly profile$ = toObservable(this.profileSignal);
    readonly hydrated$ = toObservable(this.hydratedSignal);

    get accessToken(): string | null {
        const tokens = this.tokensSignal();
        return tokens?.access ?? null;
    }

    get refreshToken(): string | null {
        const tokens = this.tokensSignal();
        return tokens?.refresh ?? null;
    }

    get profile(): ProfileResponse | null {
        return this.profileSignal();
    }

    get isAuthenticated(): boolean {
        return Boolean(this.accessToken && this.refreshToken);
    }

    get isHydrated(): boolean {
        return this.hydratedSignal();
    }

    login(email: string, password: string): Observable<void> {
        return this.accountApi.login({ email, password }).pipe(
            tap(tokens => this.persistTokens(tokens)),
            switchMap(() => this.loadProfile()),
            tap(() => this.startInactivityTracking()),
            map(() => void 0)
        );
    }

    register(payload: RegistrationRequest): Observable<ApiMessageResponse> {
        return this.accountApi.register(payload);
    }

    verifyEmail(token: string): Observable<ApiMessageResponse> {
        return this.accountApi.verifyEmail({ token });
    }

    resendVerification(email: string): Observable<ApiMessageResponse> {
        return this.accountApi.resendVerification(email);
    }

    requestPasswordReset(email: string): Observable<ApiMessageResponse> {
        return this.accountApi.requestPasswordReset({ email });
    }

    resetPassword(token: string, password: string): Observable<ApiMessageResponse> {
        return this.accountApi.resetPassword({ token, password });
    }

    completeInvite(token: string, password: string): Observable<ApiMessageResponse> {
        return this.accountApi.completeInvite({ token, password });
    }

    loadProfile(force = false): Observable<ProfileResponse> {
        if (!this.isAuthenticated) {
            return throwError(() => new Error('Not authenticated'));
        }
        if (!force) {
            const cached = this.profileSignal();
            if (cached) {
                return of(cached);
            }
        }
        return this.accountApi.getProfile().pipe(
            tap(profile => this.profileSignal.set(profile))
        );
    }

    updateProfile(payload: ProfileUpdatePayload): Observable<ProfileResponse> {
        return this.accountApi.updateProfile(payload).pipe(
            tap(profile => this.profileSignal.set(profile))
        );
    }

    changePassword(oldPassword: string, newPassword: string): Observable<ApiMessageResponse> {
        return this.accountApi.changePassword({ old_password: oldPassword, new_password: newPassword });
    }

    deleteAccount(): Observable<ApiMessageResponse> {
        return this.accountApi.deleteAccount().pipe(
            tap(() => {
                this.tokensSignal.set(null);
                this.profileSignal.set(null);
                this.clearTokens();
                this.stopInactivityTracking();
            })
        );
    }

    logout(): void {
        this.stopInactivityTracking();
        this.tokensSignal.set(null);
        this.profileSignal.set(null);
        this.clearTokens();
        void this.router.navigate(['/auth/login']);
    }

    refreshTokens(): Observable<TokenResponse> {
        const refresh = this.refreshToken;
        if (!refresh) {
            return throwError(() => new Error('No refresh token'));
        }
        return this.accountApi.refresh(refresh).pipe(
            tap(tokens => this.persistTokens(tokens)),
            tap(() => this.resetInactivityTimer())
        );
    }

    ensureTokensLoaded(): void {
        if (this.isBrowserEnvironment()) {
            if (!this.tokensSignal()) {
                const tokens = this.readTokensFromStorage();
                if (tokens) {
                    this.tokensSignal.set(tokens);
                }
            }
        }

        if (!this.hydratedSignal()) {
            this.hydratedSignal.set(true);
        }
    }

    private startInactivityTracking(): void {
        if (!this.isBrowserEnvironment()) {
            return;
        }
        this.stopInactivityTracking();
        if (!this.isAuthenticated) {
            return;
        }
        this.activityEvents.forEach(event => window.addEventListener(event, this.activityHandler, true));
        this.resetInactivityTimer();
    }

    private stopInactivityTracking(): void {
        if (!this.isBrowserEnvironment()) {
            return;
        }
        this.activityEvents.forEach(event => window.removeEventListener(event, this.activityHandler, true));
        if (this.inactivityTimer !== null) {
            window.clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    private resetInactivityTimer(): void {
        if (!this.isBrowserEnvironment()) {
            return;
        }
        if (!this.isAuthenticated) {
            this.stopInactivityTracking();
            return;
        }
        if (this.inactivityTimer !== null) {
            window.clearTimeout(this.inactivityTimer);
        }
        this.inactivityTimer = window.setTimeout(() => {
            this.logout();
        }, this.inactivityLimitMs);
    }

    private readTokensFromStorage(): StoredTokens | null {
        if (!this.isBrowserEnvironment()) {
            return null;
        }

        const raw = localStorage.getItem(this.storageKey);
        if (!raw) {
            return null;
        }

        try {
            const parsed = JSON.parse(raw) as StoredTokens;
            if (parsed.access && parsed.refresh) {
                return parsed;
            }
        } catch (error) {
            console.warn('Failed to parse stored auth tokens', error);
        }

        localStorage.removeItem(this.storageKey);
        return null;
    }

    private persistTokens(tokens: TokenResponse) {
        this.tokensSignal.set(tokens);
        if (this.isBrowserEnvironment()) {
            localStorage.setItem(this.storageKey, JSON.stringify(tokens));
        }
    }

    private clearTokens() {
        if (this.isBrowserEnvironment()) {
            localStorage.removeItem(this.storageKey);
        }
    }

    private isBrowserEnvironment(): boolean {
        if (typeof window === 'undefined') {
            return false;
        }
        try {
            return typeof window.localStorage !== 'undefined';
        } catch {
            return false;
        }
    }
}
