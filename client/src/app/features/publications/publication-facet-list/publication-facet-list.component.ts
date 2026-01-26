import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PublicationApiService, PublicationListOptions } from '../../../core/services/publication-api.service';
import { FacetItem } from '../../../core/models/publication.models';

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const MAX_PAGE_LINKS = 7;
const DEFAULT_PAGE_SIZE = 50;

type FacetRouteKey = 'authors' | 'subjects' | 'journals' | 'issued_years';

type FacetFilterChip = { label: string; value: string };

const FACET_LABELS: Record<FacetRouteKey, string> = {
    authors: 'Authors',
    subjects: 'Subjects',
    journals: 'Journals',
    issued_years: 'Issued Years'
};

const FACET_PARAM_MAP: Record<FacetRouteKey, string> = {
    authors: 'author',
    subjects: 'subject',
    journals: 'journal',
    issued_years: 'issued_year'
};

function isFacetRouteKey(value: string | null): value is FacetRouteKey {
    return value === 'authors' || value === 'subjects' || value === 'journals' || value === 'issued_years';
}

@Component({
    selector: 'app-publication-facet-list',
    standalone: true,
    imports: [NgIf, NgFor, DecimalPipe],
    templateUrl: './publication-facet-list.component.html',
    styleUrl: './publication-facet-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PublicationFacetListComponent implements OnInit {
    private readonly publicationApi = inject(PublicationApiService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly titleService = inject(Title);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading = signal(true);
    readonly error = signal<string | null>(null);
    readonly items = signal<FacetItem[]>([]);
    readonly total = signal(0);
    readonly page = signal(1);
    readonly totalPages = signal(1);
    readonly pageSize = signal(DEFAULT_PAGE_SIZE);
    readonly facetKey = signal<FacetRouteKey>('authors');
    readonly facetParam = signal(FACET_PARAM_MAP.authors);
    readonly searchMode = signal<'default' | 'elastic'>('default');
    readonly searchTerm = signal('');
    readonly baseQueryParams = signal<Record<string, unknown>>({});
    readonly filterChips = signal<FacetFilterChip[]>([]);

    readonly facetLabel = computed(() => FACET_LABELS[this.facetKey()]);
    readonly pageSizeOptions = PAGE_SIZE_OPTIONS;

    readonly pageNumbers = computed(() => {
        const total = this.totalPages();
        const current = this.page();
        const maxLinks = MAX_PAGE_LINKS;

        if (total <= maxLinks) {
            return Array.from({ length: total }, (_, index) => index + 1);
        }

        const half = Math.floor(maxLinks / 2);
        let start = current - half;
        let end = current + half;

        if (start < 1) {
            start = 1;
            end = start + maxLinks - 1;
        }

        if (end > total) {
            end = total;
            start = end - maxLinks + 1;
        }

        return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    });

    ngOnInit(): void {
        combineLatest([this.route.paramMap, this.route.queryParamMap])
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(([params, queryParams]) => {
                const facetParam = params.get('facet');
                if (!isFacetRouteKey(facetParam)) {
                    void this.router.navigate(['/publications']);
                    return;
                }

                this.facetKey.set(facetParam);
                this.facetParam.set(FACET_PARAM_MAP[facetParam]);

                const context = this.parseQueryParams(queryParams.getAll.bind(queryParams), queryParams.get.bind(queryParams));

                this.page.set(context.page);
                this.pageSize.set(context.pageSize);
                this.searchMode.set(context.searchMode);
                this.searchTerm.set(context.searchTerm);
                this.baseQueryParams.set(context.baseQuery);
                this.filterChips.set(context.filterChips);

                this.fetchFacet(context.options);
                this.updateDocumentTitle();
            });
    }

    trackByFacetValue(_: number, item: FacetItem): string {
        return item.value;
    }

    goBackToResults(): void {
        void this.router.navigate(['/publications'], {
            queryParams: { ...this.baseQueryParams() }
        });
    }

    goToPage(target: number): void {
        if (target === this.page() || target < 1 || target > this.totalPages()) {
            return;
        }
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { page: target > 1 ? target : null },
            queryParamsHandling: 'merge'
        });
    }

    changePageSize(rawValue: string): void {
        const parsed = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return;
        }
        const normalized = Math.max(1, parsed);
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { page_size: normalized, page: null },
            queryParamsHandling: 'merge'
        });
    }

    applyFacetFilter(item: FacetItem): void {
        const value = item.value.trim();
        if (!value) {
            return;
        }

        const params: Record<string, unknown> = { ...this.baseQueryParams() };

        switch (this.facetKey()) {
            case 'authors': {
                params['author'] = [value];
                break;
            }
            case 'subjects': {
                params['subject'] = value;
                break;
            }
            case 'journals': {
                params['journal'] = value;
                params['journal_name'] = item.label;
                break;
            }
            case 'issued_years': {
                params['issued_year'] = [value];
                delete params['issued_from'];
                delete params['issued_to'];
                break;
            }
            default:
                break;
        }

        if (this.facetKey() !== 'journals') {
            delete params['journal_name'];
        }

        params['page'] = null;
        params['page_size'] = null;

        void this.router.navigate(['/publications'], {
            queryParams: params
        });
    }

    private fetchFacet(options: PublicationListOptions): void {
        this.loading.set(true);
        this.error.set(null);

        const facetKey = this.facetKey();
        const searchMode = this.searchMode();
        const searchTerm = this.searchTerm();
        const request$ = searchMode === 'elastic' && searchTerm
            ? this.publicationApi.searchFacet(searchTerm, facetKey, options)
            : this.publicationApi.listFacet(facetKey, options);

        request$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: response => {
                    const results = Array.isArray(response.results) ? response.results : [];
                    const sorted = [...results].sort((a, b) => b.count - a.count);
                    const totalCount = typeof response.count === 'number' ? response.count : sorted.length;
                    const resolvedPage = typeof response.page === 'number' ? response.page : options.page ?? 1;
                    const resolvedPageSize = typeof response.page_size === 'number' ? response.page_size : options.pageSize ?? DEFAULT_PAGE_SIZE;
                    const resolvedTotalPages = typeof response.total_pages === 'number'
                        ? response.total_pages
                        : Math.max(1, Math.ceil(totalCount / resolvedPageSize));

                    this.items.set(sorted);
                    this.total.set(totalCount);
                    this.page.set(resolvedPage);
                    this.pageSize.set(resolvedPageSize);
                    this.totalPages.set(resolvedTotalPages);
                    this.facetParam.set(response.param ?? FACET_PARAM_MAP[facetKey]);
                    this.loading.set(false);
                },
                error: err => {
                    this.loading.set(false);
                    this.items.set([]);
                    this.total.set(0);
                    this.totalPages.set(1);
                    const detail = err?.error?.detail ?? 'Unable to load facet values.';
                    this.error.set(detail);
                }
            });
    }

    private parseQueryParams(
        getAll: (name: string) => string[],
        getSingle: (name: string) => string | null
    ): {
        page: number;
        pageSize: number;
        searchMode: 'default' | 'elastic';
        searchTerm: string;
        baseQuery: Record<string, unknown>;
        filterChips: FacetFilterChip[];
        options: PublicationListOptions;
    } {
        const pageRaw = Number.parseInt(getSingle('page') ?? '', 10);
        const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
        const pageSizeRaw = Number.parseInt(getSingle('page_size') ?? '', 10);
        const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? pageSizeRaw : DEFAULT_PAGE_SIZE;
        const searchTerm = (getSingle('search') ?? '').trim();
        const searchMode = getSingle('search_mode') === 'elastic' ? 'elastic' : 'default';

        const journalSlug = (getSingle('journal') ?? '').trim();
        const journalName = (getSingle('journal_name') ?? '').trim();
        const ordering = (getSingle('ordering') ?? '').trim();
        const issuedFrom = (getSingle('issued_from') ?? '').trim();
        const issuedTo = (getSingle('issued_to') ?? '').trim();
        const subject = (getSingle('subject') ?? '').trim();

        const authors = getAll('author')
            .map(value => value?.trim())
            .filter((value): value is string => Boolean(value));
        const issuedYears = getAll('issued_year')
            .map(value => value?.trim())
            .filter((value): value is string => Boolean(value));

        const baseQuery: Record<string, unknown> = {};
        const chips: FacetFilterChip[] = [];

        if (searchTerm) {
            baseQuery['search'] = searchTerm;
            chips.push({ label: 'Search', value: searchTerm });
        }
        if (journalSlug) {
            baseQuery['journal'] = journalSlug;
            if (journalName) {
                baseQuery['journal_name'] = journalName;
                chips.push({ label: 'Journal', value: journalName });
            } else {
                chips.push({ label: 'Journal', value: journalSlug });
            }
        }
        if (ordering) {
            baseQuery['ordering'] = ordering;
        }
        if (issuedFrom) {
            baseQuery['issued_from'] = issuedFrom;
            chips.push({ label: 'Issued from', value: issuedFrom });
        }
        if (issuedTo) {
            baseQuery['issued_to'] = issuedTo;
            chips.push({ label: 'Issued to', value: issuedTo });
        }
        if (subject) {
            baseQuery['subject'] = subject;
            subject
                .split(',')
                .map(value => value.trim())
                .filter(Boolean)
                .forEach(value => chips.push({ label: 'Subject', value }));
        }
        if (authors.length) {
            baseQuery['author'] = authors;
            authors.forEach(value => chips.push({ label: 'Author', value }));
        }
        if (issuedYears.length) {
            baseQuery['issued_year'] = issuedYears;
            issuedYears.forEach(value => chips.push({ label: 'Issued year', value }));
        }

        const options: PublicationListOptions = {
            page,
            pageSize,
            journalSlug: journalSlug || undefined,
            ordering: ordering || undefined,
            issuedFrom: issuedFrom || undefined,
            issuedTo: issuedTo || undefined,
            subject: subject || undefined,
            authors: authors.length ? authors : undefined,
            issuedYears: issuedYears.length ? issuedYears : undefined
        };

        if (searchMode !== 'elastic' && searchTerm) {
            options.search = searchTerm;
        }

        return {
            page,
            pageSize,
            searchMode,
            searchTerm,
            baseQuery,
            filterChips: chips,
            options
        };
    }

    private updateDocumentTitle(): void {
        const baseTitle = `All ${this.facetLabel()}`;
        this.titleService.setTitle(`${baseTitle} | Publications`);
    }
}
