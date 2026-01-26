import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../config/api-base-url.token';
import { Journal, JournalPayload, OAIValidationResponse } from '../models/journal.models';
import { PaginatedResponse } from '../models/pagination.models';

@Injectable({ providedIn: 'root' })
export class JournalApiService {
    private readonly http = inject(HttpClient);
    private readonly baseUrl = inject(API_BASE_URL);

    list(page = 1, search?: string, pageSize?: number): Observable<PaginatedResponse<Journal>> {
        let params = new HttpParams().set('page', page.toString());
        if (search) {
            params = params.set('search', search);
        }
        if (pageSize && pageSize > 0) {
            params = params.set('page_size', pageSize.toString());
        }
        return this.http.get<PaginatedResponse<Journal>>(`${this.baseUrl}/journals/`, { params });
    }

    retrieve(slug: string): Observable<Journal> {
        return this.http.get<Journal>(`${this.baseUrl}/journals/${slug}/`);
    }

    create(payload: JournalPayload): Observable<Journal> {
        return this.http.post<Journal>(`${this.baseUrl}/journals/`, payload);
    }

    update(slug: string, payload: JournalPayload): Observable<Journal> {
        return this.http.patch<Journal>(`${this.baseUrl}/journals/${slug}/`, payload);
    }

    delete(slug: string): Observable<void> {
        return this.http.delete<void>(`${this.baseUrl}/journals/${slug}/`);
    }

    validateOai(oaiUrl: string): Observable<OAIValidationResponse> {
        return this.http.post<OAIValidationResponse>(`${this.baseUrl}/journals/validate-oai/`, {
            oai_url: oaiUrl
        });
    }
}
