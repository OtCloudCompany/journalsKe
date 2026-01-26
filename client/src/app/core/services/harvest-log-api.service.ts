import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../config/api-base-url.token';
import { PaginatedResponse } from '../models/pagination.models';
import { HarvestLog, HarvestStatus } from '../models/harvest-log.models';

export interface HarvestLogQuery {
    page?: number;
    pageSize?: number;
    journal?: string;
    journalId?: string;
    status?: HarvestStatus;
}

@Injectable({ providedIn: 'root' })
export class HarvestLogApiService {
    private readonly http = inject(HttpClient);
    private readonly baseUrl = inject(API_BASE_URL);

    list(query: HarvestLogQuery = {}): Observable<PaginatedResponse<HarvestLog>> {
        let params = new HttpParams();
        const page = query.page ?? 1;
        params = params.set('page', Math.max(1, page).toString());

        if (query.pageSize && query.pageSize > 0) {
            params = params.set('page_size', Math.max(1, Math.floor(query.pageSize)).toString());
        }
        if (query.journal) {
            params = params.set('journal', query.journal);
        }
        if (query.journalId) {
            params = params.set('journal_id', query.journalId);
        }
        if (query.status) {
            params = params.set('status', query.status);
        }

        return this.http.get<PaginatedResponse<HarvestLog>>(`${this.baseUrl}/harvest-logs/`, { params });
    }
}
