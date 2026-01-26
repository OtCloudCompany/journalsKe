import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';

import { API_BASE_URL } from '../config/api-base-url.token';
import { HomeMetrics, HomeSummaryResponse } from '../models/home.models';

@Injectable({ providedIn: 'root' })
export class HomeApiService {
    private readonly http = inject(HttpClient);
    private readonly baseUrl = inject(API_BASE_URL);

    getSummary(): Observable<HomeMetrics> {
        return this.http.get<HomeSummaryResponse>(`${this.baseUrl}/home/summary/`).pipe(
            map(response => {
                const metrics = response.metrics ?? {};
                return {
                    verifiedResearchers: metrics.verified_researchers ?? 0,
                    newVerifiedLast30Days: metrics.new_verified_last_30_days ?? 0,
                    totalPublications: metrics.total_publications ?? 0,
                    publicationsAddedLast30Days: metrics.publications_added_last_30_days ?? 0,
                    totalJournals: metrics.total_journals ?? 0,
                    activeJournals: metrics.active_journals ?? 0
                } satisfies HomeMetrics;
            })
        );
    }
}
