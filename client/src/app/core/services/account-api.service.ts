import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../config/api-base-url.token';
import {
    ApiMessageResponse,
    ChangePasswordPayload,
    EmailTokenRequest,
    InviteCompletionPayload,
    LoginRequest,
    PasswordResetPayload,
    PasswordResetRequest,
    ProfileResponse,
    ProfileUpdatePayload,
    RegistrationRequest,
    TokenResponse
} from '../models/auth.models';

@Injectable({ providedIn: 'root' })
export class AccountApiService {
    private readonly baseUrl: string;

    constructor(private readonly http: HttpClient, @Inject(API_BASE_URL) apiBaseUrl: string) {
        this.baseUrl = apiBaseUrl.replace(/\/$/, '');
    }

    register(payload: RegistrationRequest): Observable<ApiMessageResponse> {
        return this.http.post<ApiMessageResponse>(`${this.baseUrl}/auth/register/`, payload);
    }

    verifyEmail(payload: EmailTokenRequest): Observable<ApiMessageResponse> {
        return this.http.post<ApiMessageResponse>(`${this.baseUrl}/auth/verify-email/`, payload);
    }

    resendVerification(email: string): Observable<ApiMessageResponse> {
        return this.http.post<ApiMessageResponse>(`${this.baseUrl}/auth/resend-verification/`, { email });
    }

    login(payload: LoginRequest): Observable<TokenResponse> {
        return this.http.post<TokenResponse>(`${this.baseUrl}/auth/token/`, payload);
    }

    refresh(refresh: string): Observable<TokenResponse> {
        return this.http.post<TokenResponse>(`${this.baseUrl}/auth/token/refresh/`, { refresh });
    }

    requestPasswordReset(payload: PasswordResetRequest): Observable<ApiMessageResponse> {
        return this.http.post<ApiMessageResponse>(`${this.baseUrl}/auth/password/forgot/`, payload);
    }

    resetPassword(payload: PasswordResetPayload): Observable<ApiMessageResponse> {
        return this.http.post<ApiMessageResponse>(`${this.baseUrl}/auth/password/reset/`, payload);
    }

    completeInvite(payload: InviteCompletionPayload): Observable<ApiMessageResponse> {
        return this.http.post<ApiMessageResponse>(`${this.baseUrl}/auth/invite/complete/`, payload);
    }

    getProfile(): Observable<ProfileResponse> {
        return this.http.get<ProfileResponse>(`${this.baseUrl}/me/`);
    }

    updateProfile(payload: ProfileUpdatePayload): Observable<ProfileResponse> {
        return this.http.patch<ProfileResponse>(`${this.baseUrl}/me/`, payload);
    }

    changePassword(payload: ChangePasswordPayload): Observable<ApiMessageResponse> {
        return this.http.post<ApiMessageResponse>(`${this.baseUrl}/me/change-password/`, payload);
    }

    deleteAccount(): Observable<ApiMessageResponse> {
        return this.http.delete<ApiMessageResponse>(`${this.baseUrl}/me/`);
    }
}
