import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../config/api-base-url.token';
import { Publication } from '../models/publication.models';
import { PublicationPayload, PublicationListResponse, FacetListResponse } from '../models/publication.models';

export interface PublicationListOptions {
    page?: number;
    search?: string;
    pageSize?: number;
    journalSlug?: string;
    journalId?: number;
    ordering?: string;
    issuedFrom?: string;
    issuedTo?: string;
    subject?: string;
    authors?: string[];
    issuedYears?: Array<number | string>;
}

@Injectable({ providedIn: 'root' })
export class PublicationApiService {
    private readonly http = inject(HttpClient);
    private readonly baseUrl = inject(API_BASE_URL);

    list(options?: PublicationListOptions): Observable<PublicationListResponse> {
        const {
            page = 1,
            search,
            pageSize,
            journalSlug,
            journalId,
            ordering,
            issuedFrom,
            issuedTo,
            subject,
            authors,
            issuedYears
        } = options ?? {};

        let params = new HttpParams().set('page', page.toString());
        if (search) {
            params = params.set('search', search);
        }
        if (pageSize && pageSize > 0) {
            params = params.set('page_size', pageSize.toString());
        }
        if (journalSlug) {
            params = params.set('journal', journalSlug);
        } else if (typeof journalId === 'number') {
            params = params.set('journal_id', journalId.toString());
        }
        if (ordering) {
            params = params.set('ordering', ordering);
        }
        if (issuedFrom) {
            params = params.set('issued_from', issuedFrom);
        }
        if (issuedTo) {
            params = params.set('issued_to', issuedTo);
        }
        if (subject) {
            params = params.set('subject', subject);
        }
        if (Array.isArray(authors)) {
            authors
                .map(author => author?.trim())
                .filter((author): author is string => Boolean(author))
                .forEach(author => {
                    params = params.append('author', author);
                });
        }
        if (Array.isArray(issuedYears)) {
            issuedYears
                .map(year => typeof year === 'number' ? year : Number.parseInt(String(year), 10))
                .filter(year => Number.isFinite(year))
                .forEach(year => {
                    params = params.append('issued_year', String(year));
                });
        }
        return this.http.get<PublicationListResponse>(`${this.baseUrl}/publications/`, { params });
    }

    retrieve(slug: string): Observable<Publication> {
        return this.http.get<Publication>(`${this.baseUrl}/publications/${slug}/`);
    }

    search(query: string, options?: PublicationListOptions): Observable<PublicationListResponse> {
        const {
            page = 1,
            pageSize,
            journalSlug,
            ordering,
            issuedFrom,
            issuedTo,
            subject,
            authors,
            issuedYears,
        } = options ?? {};

        let params = new HttpParams().set('page', page.toString()).set('q', query);
        if (pageSize && pageSize > 0) {
            params = params.set('page_size', pageSize.toString());
        }
        if (journalSlug) {
            params = params.set('journal', journalSlug);
        }
        if (ordering) {
            params = params.set('ordering', ordering);
        }
        if (issuedFrom) {
            params = params.set('issued_from', issuedFrom);
        }
        if (issuedTo) {
            params = params.set('issued_to', issuedTo);
        }
        if (subject) {
            params = params.set('subject', subject);
        }
        if (Array.isArray(authors)) {
            authors
                .map(author => author?.trim())
                .filter((author): author is string => Boolean(author))
                .forEach(author => {
                    params = params.append('author', author);
                });
        }
        if (Array.isArray(issuedYears)) {
            issuedYears
                .map(year => typeof year === 'number' ? year : Number.parseInt(String(year), 10))
                .filter(year => Number.isFinite(year))
                .forEach(year => {
                    params = params.append('issued_year', String(year));
                });
        }
        return this.http.get<PublicationListResponse>(`${this.baseUrl}/publications/search/`, { params });
    }

    listFacet(facetName: string, options?: PublicationListOptions): Observable<FacetListResponse> {
        const params = this.buildFacetParams(options);
        return this.http.get<FacetListResponse>(`${this.baseUrl}/publications/facets/${encodeURIComponent(facetName)}/`, { params });
    }

    searchFacet(query: string, facetName: string, options?: PublicationListOptions): Observable<FacetListResponse> {
        const params = this.buildFacetParams({ ...options, search: undefined });
        let nextParams = params.set('q', query);
        return this.http.get<FacetListResponse>(`${this.baseUrl}/publications/search/facets/${encodeURIComponent(facetName)}/`, { params: nextParams });
    }

    private buildFacetParams(options?: PublicationListOptions): HttpParams {
        const {
            page = 1,
            pageSize,
            journalSlug,
            journalId,
            ordering,
            issuedFrom,
            issuedTo,
            subject,
            authors,
            issuedYears,
        } = options ?? {};

        let params = new HttpParams().set('page', page.toString());
        if (pageSize && pageSize > 0) {
            params = params.set('page_size', pageSize.toString());
        }
        if (journalSlug) {
            params = params.set('journal', journalSlug);
        } else if (typeof journalId === 'number') {
            params = params.set('journal_id', journalId.toString());
        }
        if (ordering) {
            params = params.set('ordering', ordering);
        }
        if (issuedFrom) {
            params = params.set('issued_from', issuedFrom);
        }
        if (issuedTo) {
            params = params.set('issued_to', issuedTo);
        }
        if (subject) {
            params = params.set('subject', subject);
        }
        if (Array.isArray(authors)) {
            authors
                .map(author => author?.trim())
                .filter((author): author is string => Boolean(author))
                .forEach(author => {
                    params = params.append('author', author);
                });
        }
        if (Array.isArray(issuedYears)) {
            issuedYears
                .map(year => typeof year === 'number' ? year : Number.parseInt(String(year), 10))
                .filter(year => Number.isFinite(year))
                .forEach(year => {
                    params = params.append('issued_year', String(year));
                });
        }
        return params;
    }

    create(payload: PublicationPayload): Observable<Publication> {
        return this.http.post<Publication>(`${this.baseUrl}/publications/`, payload);
    }

    update(slug: string, payload: PublicationPayload): Observable<Publication> {
        return this.http.patch<Publication>(`${this.baseUrl}/publications/${slug}/`, payload);
    }

    delete(slug: string): Observable<void> {
        return this.http.delete<void>(`${this.baseUrl}/publications/${slug}/`);
    }
}
