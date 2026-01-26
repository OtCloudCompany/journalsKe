import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../config/api-base-url.token';
import { PaginatedResponse } from '../models/pagination.models';
import {
    InstitutionalEmailVerificationResponse,
    ResearcherProfile,
    ResearcherProfilePayload
} from '../models/researcher.models';

@Injectable({ providedIn: 'root' })
export class ResearcherApiService {
    private readonly http = inject(HttpClient);
    private readonly baseUrl = inject(API_BASE_URL);

    list(page = 1, search?: string, pageSize?: number, ordering?: string): Observable<PaginatedResponse<ResearcherProfile>> {
        let params = new HttpParams().set('page', page.toString());
        if (search) {
            params = params.set('search', search);
        }
        if (pageSize && pageSize > 0) {
            params = params.set('page_size', pageSize.toString());
        }
        if (ordering) {
            params = params.set('ordering', ordering);
        }
        return this.http.get<PaginatedResponse<ResearcherProfile>>(`${this.baseUrl}/researchers/`, { params });
    }

    retrieve(slug: string): Observable<ResearcherProfile> {
        return this.http.get<ResearcherProfile>(`${this.baseUrl}/researchers/${slug}/`);
    }

    create(payload: ResearcherProfilePayload): Observable<ResearcherProfile> {
        return this.http.post<ResearcherProfile>(`${this.baseUrl}/researchers/`, payload);
    }

    update(slug: string, payload: ResearcherProfilePayload): Observable<ResearcherProfile> {
        return this.http.patch<ResearcherProfile>(`${this.baseUrl}/researchers/${slug}/`, payload);
    }

    delete(slug: string): Observable<void> {
        return this.http.delete<void>(`${this.baseUrl}/researchers/${slug}/`);
    }

    getMe(): Observable<ResearcherProfile> {
        return this.http.get<ResearcherProfile>(`${this.baseUrl}/researchers/me/`);
    }

    updateMe(payload: ResearcherProfilePayload): Observable<ResearcherProfile> {
        return this.http.patch<ResearcherProfile>(`${this.baseUrl}/researchers/me/`, payload);
    }

    uploadProfilePhoto(file: File): Observable<ResearcherProfile> {
        const formData = new FormData();
        formData.append('profile_photo', file);
        return this.http.post<ResearcherProfile>(`${this.baseUrl}/researchers/me/profile-photo/`, formData);
    }

    removeProfilePhoto(): Observable<void> {
        return this.http.delete<void>(`${this.baseUrl}/researchers/me/profile-photo/`);
    }

    resendInstitutionalEmail(): Observable<{ detail: string }> {
        return this.http.post<{ detail: string }>(`${this.baseUrl}/researchers/me/institutional-email/resend/`, {});
    }

    verifyInstitutionalEmail(token: string): Observable<InstitutionalEmailVerificationResponse> {
        return this.http.post<InstitutionalEmailVerificationResponse>(
            `${this.baseUrl}/researchers/verify-institutional-email/`,
            { token }
        );
    }
}
