import { NgFor, NgIf, NgClass, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';

import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { AuthStateService } from '../../../core/services/auth-state.service';
import { JournalApiService } from '../../../core/services/journal-api.service';
import { PublicationApiService } from '../../../core/services/publication-api.service';
import { FacetItem, PublicationFacetCollection } from '../../../core/models/publication.models';
import { Journal } from '../../../core/models/journal.models';

const DEFAULT_PAGE_SIZE = 10;
const BASE_PAGE_SIZE_OPTIONS = [1, 5, 10, 25, 50];
const PAGE_SIZE_OPTIONS = Array.from(new Set([DEFAULT_PAGE_SIZE, ...BASE_PAGE_SIZE_OPTIONS])).sort((a, b) => a - b);
const DESCRIPTION_WORD_LIMIT = 15;
const MAX_PAGE_LINKS = 7;

@Component({
    selector: 'app-journal-list',
    standalone: true,
    imports: [NgIf, NgFor, NgClass, RouterLink, ReactiveFormsModule, DatePipe],
    templateUrl: './journal-list.component.html',
    styleUrl: './journal-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class JournalListComponent implements OnInit {
    private readonly journalApi = inject(JournalApiService);
    private readonly publicationApi = inject(PublicationApiService);
    private readonly authState = inject(AuthStateService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly formBuilder = inject(FormBuilder);
    private readonly destroyRef = inject(DestroyRef);

    private readonly authTokens = toSignal(this.authState.tokens$, { initialValue: null });
    private hasLoadedInitial = false;
    private lastRouteState = {
        page: 1,
        search: '',
        pageSize: DEFAULT_PAGE_SIZE
    };

    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly journals = signal<Journal[]>([]);
    readonly count = signal(0);
    readonly pageSize = signal(DEFAULT_PAGE_SIZE);
    readonly page = signal(1);
    readonly searchQuery = signal('');
    readonly publicationFacets = signal<PublicationFacetCollection | null>(null);
    readonly facetsLoading = signal(false);
    readonly facetsError = signal<string | null>(null);

    readonly pageSizeOptions = [...PAGE_SIZE_OPTIONS];
    readonly canCreate = computed(() => Boolean(this.authTokens()));
    readonly hasResults = computed(() => this.journals().length > 0);
    readonly isEmpty = computed(() => !this.loading() && !this.error() && this.journals().length === 0);
    readonly hasFacetContent = computed(() => {
        const facets = this.publicationFacets();
        if (!facets) {
            return false;
        }
        return Boolean(
            facets.journals.items.length ||
            facets.authors.items.length ||
            facets.subjects.items.length ||
            facets.issued_years.items.length
        );
    });
    readonly totalPages = computed(() => {
        const total = this.count();
        const size = Math.max(1, this.pageSize());
        return total === 0 ? 1 : Math.ceil(total / size);
    });
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

    readonly searchForm = this.formBuilder.nonNullable.group({
        search: [''],
        pageSize: [DEFAULT_PAGE_SIZE]
    });

    ngOnInit(): void {
        const controls = this.searchForm.controls;

        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const pageParam = Number(params.get('page'));
                const resolvedPage = !Number.isNaN(pageParam) && pageParam > 0 ? pageParam : 1;

                const searchParam = params.get('search') ?? '';

                const pageSizeParamRaw = Number(params.get('page_size'));
                const parsedPageSize = !Number.isNaN(pageSizeParamRaw) && pageSizeParamRaw > 0
                    ? pageSizeParamRaw
                    : DEFAULT_PAGE_SIZE;
                const resolvedPageSize = Math.max(1, Math.floor(parsedPageSize));

                const pageChanged = resolvedPage !== this.lastRouteState.page;
                const searchChanged = searchParam !== this.lastRouteState.search;
                const pageSizeChanged = resolvedPageSize !== this.lastRouteState.pageSize;

                this.page.set(resolvedPage);
                this.searchQuery.set(searchParam);
                this.pageSize.set(resolvedPageSize);

                if (!this.pageSizeOptions.includes(resolvedPageSize)) {
                    this.pageSizeOptions.push(resolvedPageSize);
                    this.pageSizeOptions.sort((a, b) => a - b);
                }

                this.searchForm.patchValue({
                    search: searchParam,
                    pageSize: resolvedPageSize
                }, { emitEvent: false });

                if (!this.hasLoadedInitial || pageChanged || searchChanged || pageSizeChanged) {
                    this.fetchJournals();
                }

                this.hasLoadedInitial = true;
                this.lastRouteState = {
                    page: resolvedPage,
                    search: searchParam,
                    pageSize: resolvedPageSize
                };
            });

        controls.search.valueChanges
            .pipe(
                debounceTime(300),
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(value => {
                const trimmed = value.trim();
                if (trimmed === this.searchQuery()) {
                    return;
                }
                this.searchQuery.set(trimmed);
                if (this.page() !== 1) {
                    this.page.set(1);
                }
                this.hasLoadedInitial = false;
                const navigated = this.updateQueryParams();
                if (!navigated) {
                    this.fetchJournals();
                    this.hasLoadedInitial = true;
                }
            });

        controls.pageSize.valueChanges
            .pipe(
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(size => {
                if (!size || size <= 0) {
                    return;
                }
                const normalizedSize = Math.max(1, Math.floor(size));
                if (normalizedSize === this.pageSize()) {
                    return;
                }
                if (!this.pageSizeOptions.includes(normalizedSize)) {
                    this.pageSizeOptions.push(normalizedSize);
                    this.pageSizeOptions.sort((a, b) => a - b);
                }
                this.pageSize.set(normalizedSize);
                if (this.page() !== 1) {
                    this.page.set(1);
                }
                this.hasLoadedInitial = false;
                const navigated = this.updateQueryParams();
                if (!navigated) {
                    this.fetchJournals();
                    this.hasLoadedInitial = true;
                }
            });

        this.fetchPublicationFacets();
    }

    goToCreate(): void {
        void this.router.navigate(['/journals/new']);
    }

    goToPage(page: number): void {
        if (page === this.page() || page < 1 || page > this.totalPages()) {
            return;
        }
        this.page.set(page);
        this.hasLoadedInitial = false;
        const navigated = this.updateQueryParams();
        if (!navigated) {
            this.fetchJournals();
            this.hasLoadedInitial = true;
        }
    }

    nextPage(): void {
        this.goToPage(this.page() + 1);
    }

    previousPage(): void {
        this.goToPage(this.page() - 1);
    }

    trackBySlug(_: number, journal: Journal): string {
        return journal.slug;
    }

    trackFacetValue(_: number, item: FacetItem): string {
        return item.value;
    }

    buildFacetQuery(facet: 'authors' | 'subjects' | 'journals' | 'issued_years', value: string): Record<string, string> {
        const trimmed = value.trim();
        if (!trimmed) {
            return {};
        }
        switch (facet) {
            case 'authors':
                return { author: trimmed };
            case 'subjects':
                return { subject: trimmed };
            case 'journals':
                return { journal: trimmed };
            case 'issued_years':
                return { issued_year: trimmed };
            default:
                return {};
        }
    }

    formatDescription(description: string | null | undefined): string {
        if (!description) {
            return 'No description available.';
        }

        const words = description.trim().split(/\s+/);
        if (words.length <= DESCRIPTION_WORD_LIMIT) {
            return description.trim();
        }

        const truncated = words.slice(0, DESCRIPTION_WORD_LIMIT).join(' ');
        return `${truncated}…`;
    }

    private updateQueryParams(): boolean {
        const queryParams: Record<string, unknown> = {};
        const page = this.page();
        if (page > 1) {
            queryParams['page'] = page;
        }
        const search = this.searchQuery();
        if (search) {
            queryParams['search'] = search;
        }
        const pageSize = this.pageSize();
        if (pageSize !== DEFAULT_PAGE_SIZE) {
            queryParams['page_size'] = pageSize;
        }

        const currentParams = this.route.snapshot.queryParamMap;
        const currentPage = currentParams.get('page');
        const currentSearch = currentParams.get('search') ?? '';
        const currentPageSize = currentParams.get('page_size');
        const targetPage = Object.prototype.hasOwnProperty.call(queryParams, 'page') ? String(queryParams['page']) : null;
        const targetSearch = Object.prototype.hasOwnProperty.call(queryParams, 'search') ? String(queryParams['search']) : '';
        const targetPageSize = Object.prototype.hasOwnProperty.call(queryParams, 'page_size') ? String(queryParams['page_size']) : null;

        if (currentPage === targetPage && currentSearch === targetSearch && currentPageSize === targetPageSize) {
            return false;
        }

        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            replaceUrl: true
        });
        return true;
    }

    private fetchJournals(): void {
        const currentPage = this.page();
        const currentSearch = this.searchQuery();
        const requestedPageSize = Math.max(1, Math.floor(this.pageSize()));

        this.loading.set(true);
        this.error.set(null);

        this.journalApi.list(currentPage, currentSearch || undefined, requestedPageSize)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (response) => {
                    const results = Array.isArray(response.results) ? response.results : [];
                    const totalCount = typeof response.count === 'number' ? response.count : results.length;
                    const totalPages = totalCount > 0 ? Math.ceil(totalCount / requestedPageSize) : 1;

                    this.count.set(totalCount);

                    if (totalCount === 0) {
                        if (currentPage !== 1) {
                            this.page.set(1);
                            this.hasLoadedInitial = false;
                            const navigated = this.updateQueryParams();
                            if (!navigated) {
                                this.hasLoadedInitial = true;
                            }
                        }
                        this.journals.set([]);
                        this.loading.set(false);
                        this.hasLoadedInitial = true;
                        return;
                    }

                    if (results.length === 0 && currentPage > totalPages) {
                        const fallbackPage = Math.max(1, totalPages);
                        if (fallbackPage !== currentPage) {
                            this.page.set(fallbackPage);
                            this.hasLoadedInitial = false;
                            const navigated = this.updateQueryParams();
                            if (!navigated) {
                                this.hasLoadedInitial = true;
                                this.loading.set(false);
                            }
                            return;
                        }
                    }

                    this.journals.set(results);
                    this.loading.set(false);
                    this.hasLoadedInitial = true;
                },
                error: (err) => {
                    this.loading.set(false);
                    const detail = err?.error?.detail ?? 'Unable to load journals.';
                    this.error.set(detail);
                    this.hasLoadedInitial = true;
                }
            });
    }

    private fetchPublicationFacets(): void {
        this.facetsLoading.set(true);
        this.facetsError.set(null);

        this.publicationApi.list({ pageSize: 1 })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: response => {
                    this.publicationFacets.set(response.facets ?? null);
                    this.facetsLoading.set(false);
                },
                error: () => {
                    this.facetsLoading.set(false);
                    this.publicationFacets.set(null);
                    this.facetsError.set('Unable to load publication facets right now.');
                }
            });
    }
}
