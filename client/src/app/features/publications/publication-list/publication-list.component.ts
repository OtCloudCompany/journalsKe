import { NgClass, NgFor, NgIf, NgStyle, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import { AuthStateService } from '../../../core/services/auth-state.service';
import { PublicationApiService } from '../../../core/services/publication-api.service';
import { JournalApiService } from '../../../core/services/journal-api.service';
import { FacetItem, Publication, PublicationFacetCollection, PublicationMetadataEntry } from '../../../core/models/publication.models';
import { Journal } from '../../../core/models/journal.models';

const DEFAULT_PAGE_SIZE = 10;
const BASE_PAGE_SIZE_OPTIONS = [1, 5, 10, 25, 50];
const PAGE_SIZE_OPTIONS = Array.from(new Set([DEFAULT_PAGE_SIZE, ...BASE_PAGE_SIZE_OPTIONS])).sort((a, b) => a - b);
const DESCRIPTION_WORD_LIMIT = 25;
const MAX_PAGE_LINKS = 7;
const DEFAULT_ISSUED_MIN_YEAR = 1950;
const DEFAULT_ISSUED_MAX_YEAR = new Date().getFullYear();

type ActiveFilterKey = 'journal' | 'issued_from' | 'issued_to' | 'subject' | 'author' | 'issued_year';

type FacetType = 'authors' | 'subjects' | 'journals' | 'issued_years';

interface ActiveFilter {
    key: ActiveFilterKey;
    label: string;
    value: string;
    dataKey?: string;
}

interface FacetLinkTarget {
    commands: unknown[];
    queryParams: Record<string, unknown>;
}

interface RouteSnapshotState {
    page: number;
    search: string;
    pageSize: number;
    journal: string | null;
    journalName: string | null;
    ordering: string | null;
    issuedFrom: string | null;
    issuedTo: string | null;
    subjectFilters: string[];
    authors: string[];
    issuedYears: string[];
}

@Component({
    selector: 'app-publication-list',
    standalone: true,
    imports: [NgIf, NgFor, NgClass, NgStyle, RouterLink, ReactiveFormsModule, DatePipe],
    templateUrl: './publication-list.component.html',
    styleUrl: './publication-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PublicationListComponent implements OnInit {
    private readonly publicationApi = inject(PublicationApiService);
    private readonly journalApi = inject(JournalApiService);
    private readonly authState = inject(AuthStateService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly formBuilder = inject(FormBuilder);
    private readonly destroyRef = inject(DestroyRef);

    private readonly authTokens = toSignal(this.authState.tokens$, { initialValue: null });
    private hasLoadedInitial = false;
    private lastRouteState: RouteSnapshotState = {
        page: 1,
        search: '',
        pageSize: DEFAULT_PAGE_SIZE,
        journal: null,
        journalName: null,
        ordering: null,
        issuedFrom: null,
        issuedTo: null,
        subjectFilters: [],
        authors: [],
        issuedYears: []
    };

    readonly pageSizeOptions = [...PAGE_SIZE_OPTIONS];
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly publications = signal<Publication[]>([]);
    readonly facets = signal<PublicationFacetCollection | null>(null);
    readonly count = signal(0);
    readonly page = signal(1);
    readonly pageSize = signal(DEFAULT_PAGE_SIZE);
    readonly searchQuery = signal('');
    readonly journalSlug = signal<string | null>(null);
    readonly journalName = signal<string | null>(null);
    readonly ordering = signal<string | null>(null);
    readonly issuedFrom = signal<string | null>(null);
    readonly issuedTo = signal<string | null>(null);
    readonly subjectFilters = signal<string[]>([]);
    readonly authorFilters = signal<string[]>([]);
    readonly issuedYearFilters = signal<string[]>([]);
    readonly journalOptions = signal<Journal[]>([]);
    readonly issuedYearBounds = signal({
        min: DEFAULT_ISSUED_MIN_YEAR,
        max: DEFAULT_ISSUED_MAX_YEAR
    });

    readonly canCreate = computed(() => Boolean(this.authTokens()));
    readonly hasResults = computed(() => this.publications().length > 0);
    readonly isEmpty = computed(() => !this.loading() && !this.error() && this.publications().length === 0);
    readonly activeFilters = computed<ActiveFilter[]>(() => {
        const filters: ActiveFilter[] = [];
        const journalSlug = this.journalSlug();
        if (journalSlug) {
            filters.push({
                key: 'journal',
                label: 'Journal',
                value: this.journalName() ?? journalSlug,
                dataKey: journalSlug
            });
        }
        if (this.issuedFrom()) {
            filters.push({ key: 'issued_from', label: 'Issued from', value: this.issuedFrom()! });
        }
        if (this.issuedTo()) {
            filters.push({ key: 'issued_to', label: 'Issued to', value: this.issuedTo()! });
        }
        for (const subject of this.subjectFilters()) {
            filters.push({ key: 'subject', label: 'Subject', value: subject, dataKey: subject });
        }
        for (const author of this.authorFilters()) {
            filters.push({ key: 'author', label: 'Author', value: author, dataKey: author });
        }
        for (const issuedYear of this.issuedYearFilters()) {
            filters.push({ key: 'issued_year', label: 'Issued year', value: issuedYear, dataKey: issuedYear });
        }
        return filters;
    });
    readonly hasActiveFilters = computed(() => this.activeFilters().length > 0);
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

    readonly facetViewLinks = computed<Record<FacetType, FacetLinkTarget>>(() => ({
        journals: this.buildFacetViewLink('journals'),
        subjects: this.buildFacetViewLink('subjects'),
        authors: this.buildFacetViewLink('authors'),
        issued_years: this.buildFacetViewLink('issued_years')
    }));
    readonly resultsSummary = computed(() => {
        if (this.loading()) {
            return 'Updating results…';
        }
        const total = this.count();
        if (total === 1) {
            return '1 publication matches the current criteria.';
        }
        return `${total} publications match the current criteria.`;
    });

    readonly searchForm = this.formBuilder.nonNullable.group({
        search: [''],
        pageSize: [DEFAULT_PAGE_SIZE]
    });

    readonly filtersForm = this.formBuilder.nonNullable.group({
        journal: [''],
        issuedFromSlider: [DEFAULT_ISSUED_MIN_YEAR],
        issuedToSlider: [DEFAULT_ISSUED_MAX_YEAR]
    });

    ngOnInit(): void {
        const controls = this.searchForm.controls;
        const filterControls = this.filtersForm.controls;

        const initialBounds = this.issuedYearBounds();
        filterControls.issuedFromSlider.setValue(initialBounds.min, { emitEvent: false });
        filterControls.issuedToSlider.setValue(initialBounds.max, { emitEvent: false });

        this.loadJournalOptions();

        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                let bounds = this.issuedYearBounds();
                const pageParam = Number(params.get('page'));
                const resolvedPage = !Number.isNaN(pageParam) && pageParam > 0 ? pageParam : 1;

                const searchParamRaw = params.get('search');
                const searchParam = searchParamRaw ?? '';
                const normalizedSearchParam = searchParam.trim();

                const pageSizeParamRaw = Number(params.get('page_size'));
                const parsedPageSize = !Number.isNaN(pageSizeParamRaw) && pageSizeParamRaw > 0
                    ? pageSizeParamRaw
                    : DEFAULT_PAGE_SIZE;
                const resolvedPageSize = Math.max(1, Math.floor(parsedPageSize));

                const journalParamRaw = params.get('journal');
                const journalParam = journalParamRaw && journalParamRaw.trim().length > 0
                    ? journalParamRaw.trim()
                    : null;

                const journalNameParamRaw = params.get('journal_name');
                const journalNameParam = journalNameParamRaw && journalNameParamRaw.trim().length > 0
                    ? journalNameParamRaw.trim()
                    : null;

                const orderingParamRaw = params.get('ordering');
                const orderingParam = orderingParamRaw && orderingParamRaw.trim().length > 0
                    ? orderingParamRaw.trim()
                    : null;

                const issuedFromParamNormalized = this.normalizeYearInput(params.get('issued_from')) ?? '';
                const issuedToParamNormalized = this.normalizeYearInput(params.get('issued_to')) ?? '';

                const subjectParamRaw = params.get('subject');
                const subjectTermList = this.parseSubjectParam(subjectParamRaw);

                const authorParams = params.getAll('author') ?? [];
                const authorTermList = authorParams
                    .map(value => (value ?? '').trim())
                    .filter(value => value.length > 0);

                const issuedYearParams = params.getAll('issued_year') ?? [];
                const issuedYearList = issuedYearParams
                    .map(value => (value ?? '').trim())
                    .filter(value => value.length > 0);

                const numericIssuedYears = issuedYearList
                    .map(value => Number.parseInt(value, 10))
                    .filter(value => Number.isFinite(value)) as number[];

                const numericIssuedFrom = issuedFromParamNormalized ? Number.parseInt(issuedFromParamNormalized, 10) : null;
                if (Number.isFinite(numericIssuedFrom ?? NaN)) {
                    numericIssuedYears.push(numericIssuedFrom as number);
                }
                const numericIssuedTo = issuedToParamNormalized ? Number.parseInt(issuedToParamNormalized, 10) : null;
                if (Number.isFinite(numericIssuedTo ?? NaN)) {
                    numericIssuedYears.push(numericIssuedTo as number);
                }

                if (numericIssuedYears.length) {
                    const min = Math.min(bounds.min, ...numericIssuedYears);
                    const max = Math.max(bounds.max, ...numericIssuedYears);
                    if (min !== bounds.min || max !== bounds.max) {
                        bounds = { min, max };
                        this.issuedYearBounds.set(bounds);
                    }
                }

                const resolvedIssuedFromSlider = issuedFromParamNormalized
                    ? this.coerceSliderValue(issuedFromParamNormalized, bounds.min, bounds.max)
                    : bounds.min;
                const resolvedIssuedToSlider = issuedToParamNormalized
                    ? this.coerceSliderValue(issuedToParamNormalized, bounds.min, bounds.max)
                    : bounds.max;

                const issuedFromSliderValue = Math.min(resolvedIssuedFromSlider, resolvedIssuedToSlider);
                const issuedToSliderValue = Math.max(resolvedIssuedFromSlider, resolvedIssuedToSlider);

                const pageChanged = resolvedPage !== this.lastRouteState.page;
                const searchChanged = normalizedSearchParam !== this.lastRouteState.search;
                const pageSizeChanged = resolvedPageSize !== this.lastRouteState.pageSize;
                const journalChanged = journalParam !== this.lastRouteState.journal;
                const journalNameChanged = journalNameParam !== this.lastRouteState.journalName;
                const orderingChanged = orderingParam !== this.lastRouteState.ordering;
                const issuedFromChanged = issuedFromParamNormalized !== this.lastRouteState.issuedFrom;
                const issuedToChanged = issuedToParamNormalized !== this.lastRouteState.issuedTo;
                const subjectChanged = !this.areStringArraysEqual(subjectTermList, this.lastRouteState.subjectFilters);
                const authorsChanged = !this.areStringArraysEqual(authorTermList, this.lastRouteState.authors);
                const issuedYearsChanged = !this.areStringArraysEqual(issuedYearList, this.lastRouteState.issuedYears);

                this.page.set(resolvedPage);
                this.searchQuery.set(normalizedSearchParam);
                this.pageSize.set(resolvedPageSize);
                this.journalSlug.set(journalParam);
                this.journalName.set(journalNameParam);
                this.ordering.set(orderingParam);
                this.issuedFrom.set(issuedFromParamNormalized || null);
                this.issuedTo.set(issuedToParamNormalized || null);
                this.subjectFilters.set(subjectTermList);
                this.authorFilters.set(authorTermList);
                this.issuedYearFilters.set(issuedYearList);

                if (!this.hasLoadedInitial || pageChanged || searchChanged || pageSizeChanged || journalChanged || journalNameChanged || orderingChanged || issuedFromChanged || issuedToChanged || subjectChanged || authorsChanged || issuedYearsChanged) {
                    this.fetchPublications();
                }

                this.hasLoadedInitial = true;
                this.lastRouteState = {
                    page: resolvedPage,
                    search: normalizedSearchParam,
                    pageSize: resolvedPageSize,
                    journal: journalParam,
                    journalName: journalNameParam,
                    ordering: orderingParam,
                    issuedFrom: issuedFromParamNormalized,
                    issuedTo: issuedToParamNormalized,
                    subjectFilters: subjectTermList,
                    authors: authorTermList,
                    issuedYears: issuedYearList
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
                    this.fetchPublications();
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
                    this.fetchPublications();
                    this.hasLoadedInitial = true;
                }
            });

        filterControls.journal.valueChanges
            .pipe(
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(value => {
                const normalized = value.trim();
                const slug = normalized.length > 0 ? normalized : null;
                if (slug === this.journalSlug()) {
                    return;
                }
                this.journalSlug.set(slug);
                if (slug) {
                    const match = this.journalOptions().find(journal => journal.slug === slug);
                    this.journalName.set(match?.name ?? null);
                } else {
                    this.journalName.set(null);
                }
                this.refreshFilterResults();
            });

        filterControls.issuedFromSlider.valueChanges
            .pipe(
                debounceTime(150),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(value => {
                const bounds = this.issuedYearBounds();
                let fromValue = this.coerceSliderValue(value, bounds.min, bounds.max);
                const currentToRaw = filterControls.issuedToSlider.value;
                const toValue = this.coerceSliderValue(currentToRaw, bounds.min, bounds.max);
                if (fromValue > toValue) {
                    fromValue = toValue;
                    filterControls.issuedFromSlider.setValue(fromValue, { emitEvent: false });
                }
                const filterValue = fromValue <= bounds.min ? null : String(fromValue);
                if (filterValue === this.issuedFrom()) {
                    return;
                }
                this.issuedFrom.set(filterValue);
                if (this.issuedYearFilters().length) {
                    this.issuedYearFilters.set([]);
                }
                this.refreshFilterResults();
            });

        filterControls.issuedToSlider.valueChanges
            .pipe(
                debounceTime(150),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(value => {
                const bounds = this.issuedYearBounds();
                const currentFromRaw = filterControls.issuedFromSlider.value;
                let fromValue = this.coerceSliderValue(currentFromRaw, bounds.min, bounds.max);
                let toValue = this.coerceSliderValue(value, bounds.min, bounds.max);
                if (toValue < fromValue) {
                    toValue = fromValue;
                    filterControls.issuedToSlider.setValue(toValue, { emitEvent: false });
                }
                const filterValue = toValue >= bounds.max ? null : String(toValue);
                if (filterValue === this.issuedTo()) {
                    return;
                }
                this.issuedTo.set(filterValue);
                if (this.issuedYearFilters().length) {
                    this.issuedYearFilters.set([]);
                }
                this.refreshFilterResults();
            });
    }

    goToCreate(): void {
        void this.router.navigate(['/publications/new']);
    }

    goToPage(page: number): void {
        if (page === this.page() || page < 1 || page > this.totalPages()) {
            return;
        }
        this.page.set(page);
        this.hasLoadedInitial = false;
        const navigated = this.updateQueryParams();
        if (!navigated) {
            this.fetchPublications();
            this.hasLoadedInitial = true;
        }
    }

    nextPage(): void {
        this.goToPage(this.page() + 1);
    }

    previousPage(): void {
        this.goToPage(this.page() - 1);
    }

    trackBySlug(_: number, publication: Publication): string {
        return publication.slug;
    }

    trackByJournalSlug(_: number, journal: Journal): string {
        return journal.slug;
    }

    trackByFacetValue(_: number, item: FacetItem): string {
        return item.value;
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

    formatList(values: string[] | null | undefined): string {
        if (!values || values.length === 0) {
            return '';
        }
        return values.join(', ');
    }

    metadataValues(publication: Publication, element: string, qualifier?: string): string[] {
        if (!publication?.metadata || publication.metadata.length === 0) {
            return [];
        }

        const elementLower = element.toLowerCase();
        const qualifierLower = qualifier ? qualifier.toLowerCase() : null;

        return publication.metadata
            .filter((entry: PublicationMetadataEntry) => {
                if ((entry.schema || 'dc').toLowerCase() !== 'dc') {
                    return false;
                }
                if (entry.element.toLowerCase() !== elementLower) {
                    return false;
                }
                if (qualifierLower) {
                    return (entry.qualifier ?? '').toLowerCase() === qualifierLower;
                }
                return true;
            })
            .map(entry => entry.value)
            .filter(value => Boolean(value && value.trim()));
    }

    toggleFacet(facet: FacetType, item: FacetItem): void {
        switch (facet) {
            case 'journals': {
                const current = this.journalSlug();
                if (current === item.value) {
                    this.clearFilter('journal');
                    return;
                }
                this.journalSlug.set(item.value);
                this.journalName.set(item.label);
                this.filtersForm.patchValue({ journal: item.value }, { emitEvent: false });
                this.refreshFilterResults();
                return;
            }
            case 'issued_years': {
                const value = (item.value ?? '').trim();
                if (!value) {
                    return;
                }
                const existing = this.issuedYearFilters();
                if (existing.includes(value)) {
                    this.clearFilter('issued_year', value);
                    return;
                }
                this.issuedYearFilters.set([...existing, value]);
                this.issuedFrom.set(null);
                this.issuedTo.set(null);
                const numeric = Number.parseInt(value, 10);
                if (Number.isFinite(numeric)) {
                    this.ensureYearWithinBounds(numeric);
                    this.filtersForm.patchValue({
                        issuedFromSlider: numeric,
                        issuedToSlider: numeric
                    }, { emitEvent: false });
                }
                this.refreshFilterResults();
                return;
            }
            case 'subjects': {
                const value = item.value.trim();
                if (!value) {
                    return;
                }
                const existing = this.subjectFilters();
                if (existing.some(entry => entry.toLowerCase() === value.toLowerCase())) {
                    this.clearFilter('subject', value);
                    return;
                }
                this.subjectFilters.set([...existing, value]);
                this.refreshFilterResults();
                return;
            }
            case 'authors': {
                const value = item.value.trim();
                if (!value) {
                    return;
                }
                const existing = this.authorFilters();
                if (existing.some(entry => entry.toLowerCase() === value.toLowerCase())) {
                    this.clearFilter('author', value);
                    return;
                }
                this.authorFilters.set([...existing, value]);
                this.refreshFilterResults();
                return;
            }
            default:
                return;
        }
    }

    clearFilter(key: ActiveFilterKey, value?: string): void {
        let changed = false;
        switch (key) {
            case 'journal': {
                if (this.journalSlug()) {
                    this.journalSlug.set(null);
                    changed = true;
                }
                if (this.journalName()) {
                    this.journalName.set(null);
                }
                const control = this.filtersForm.controls.journal;
                if (control.value) {
                    control.setValue('', { emitEvent: false });
                    changed = true;
                }
                break;
            }
            case 'issued_from': {
                const bounds = this.issuedYearBounds();
                const control = this.filtersForm.controls.issuedFromSlider;
                if (control.value !== bounds.min) {
                    control.setValue(bounds.min, { emitEvent: false });
                    changed = true;
                }
                if (this.issuedFrom()) {
                    this.issuedFrom.set(null);
                    changed = true;
                }
                break;
            }
            case 'issued_to': {
                const bounds = this.issuedYearBounds();
                const control = this.filtersForm.controls.issuedToSlider;
                if (control.value !== bounds.max) {
                    control.setValue(bounds.max, { emitEvent: false });
                    changed = true;
                }
                if (this.issuedTo()) {
                    this.issuedTo.set(null);
                    changed = true;
                }
                break;
            }
            case 'subject': {
                const current = this.subjectFilters();
                const target = (value ?? '').toLowerCase();
                const next = current.filter(subject => subject.toLowerCase() !== target);
                if (next.length !== current.length) {
                    this.subjectFilters.set(next);
                    changed = true;
                }
                break;
            }
            case 'author': {
                const current = this.authorFilters();
                const target = (value ?? '').toLowerCase();
                const next = current.filter(author => author.toLowerCase() !== target);
                if (next.length !== current.length) {
                    this.authorFilters.set(next);
                    changed = true;
                }
                break;
            }
            case 'issued_year': {
                const current = this.issuedYearFilters();
                const target = (value ?? '').trim();
                const next = current.filter(year => year !== target);
                if (next.length !== current.length) {
                    this.issuedYearFilters.set(next);
                    changed = true;
                }
                if (!next.length) {
                    const bounds = this.issuedYearBounds();
                    this.filtersForm.patchValue({
                        issuedFromSlider: bounds.min,
                        issuedToSlider: bounds.max
                    }, { emitEvent: false });
                    this.issuedFrom.set(null);
                    this.issuedTo.set(null);
                }
                break;
            }
            default:
                break;
        }

        if (!changed) {
            return;
        }

        this.refreshFilterResults();
    }

    clearAllFilters(): void {
        if (!this.hasActiveFilters()) {
            return;
        }

        const bounds = this.issuedYearBounds();
        this.filtersForm.setValue({
            journal: '',
            issuedFromSlider: bounds.min,
            issuedToSlider: bounds.max
        }, { emitEvent: false });

        const hadChanges = Boolean(
            this.journalSlug() ||
            this.issuedFrom() ||
            this.issuedTo() ||
            this.subjectFilters().length ||
            this.authorFilters().length ||
            this.issuedYearFilters().length
        );

        this.journalSlug.set(null);
        this.journalName.set(null);
        this.ordering.set(null);
        this.issuedFrom.set(null);
        this.issuedTo.set(null);
        this.subjectFilters.set([]);
        this.authorFilters.set([]);
        this.issuedYearFilters.set([]);

        if (!hadChanges) {
            return;
        }

        this.refreshFilterResults();
    }

    get issuedRangeTrackStyle(): Record<string, string> {
        const bounds = this.issuedYearBounds();
        const min = bounds.min;
        const max = bounds.max;
        const rangeWidth = Math.max(1, max - min);
        const controls = this.filtersForm.controls;
        const lower = this.coerceSliderValue(controls.issuedFromSlider.value, min, max);
        const upper = this.coerceSliderValue(controls.issuedToSlider.value, min, max);
        const start = Math.min(lower, upper);
        const end = Math.max(lower, upper);
        const leftPercent = ((start - min) / rangeWidth) * 100;
        const rightPercent = 100 - ((end - min) / rangeWidth) * 100;
        return {
            left: `${Math.max(0, Math.min(100, leftPercent))}%`,
            right: `${Math.max(0, Math.min(100, rightPercent))}%`
        };
    }

    private refreshFilterResults(): void {
        if (this.page() !== 1) {
            this.page.set(1);
        }
        this.hasLoadedInitial = false;
        const navigated = this.updateQueryParams();
        if (!navigated) {
            this.fetchPublications();
            this.hasLoadedInitial = true;
        }
    }

    private buildFacetViewLink(facet: FacetType): FacetLinkTarget {
        const queryParams: Record<string, unknown> = {};
        const trimmedSearch = this.searchQuery().trim();
        const journalSlug = this.journalSlug();
        const journalName = this.journalName();
        const ordering = this.ordering();
        const issuedFrom = this.issuedFrom();
        const issuedTo = this.issuedTo();
        const subjectValues = this.subjectFilters();
        const authorValues = this.authorFilters();
        const issuedYearValues = this.issuedYearFilters();

        if (trimmedSearch) {
            queryParams['search'] = trimmedSearch;
        }
        if (journalSlug) {
            queryParams['journal'] = journalSlug;
            if (journalName) {
                queryParams['journal_name'] = journalName;
            }
        }
        if (ordering) {
            queryParams['ordering'] = ordering;
        }
        if (issuedFrom) {
            queryParams['issued_from'] = issuedFrom;
        }
        if (issuedTo) {
            queryParams['issued_to'] = issuedTo;
        }
        if (subjectValues.length) {
            queryParams['subject'] = subjectValues.join(', ');
        }
        if (authorValues.length) {
            queryParams['author'] = [...authorValues];
        }
        if (issuedYearValues.length) {
            queryParams['issued_year'] = [...issuedYearValues];
        }

        const usingSearchEndpoint = trimmedSearch.length > 0;

        if (usingSearchEndpoint) {
            queryParams['search_mode'] = 'elastic';
        }

        return {
            commands: ['/publications', 'facets', facet],
            queryParams
        };
    }

    private parseSubjectParam(value: string | null | undefined): string[] {
        if (!value) {
            return [];
        }
        return value
            .split(',')
            .map(entry => entry.trim())
            .filter(entry => entry.length > 0);
    }

    private areStringArraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) {
            return false;
        }
        const normalizedA = [...a].map(value => value.toLowerCase()).sort();
        const normalizedB = [...b].map(value => value.toLowerCase()).sort();
        return normalizedA.every((value, index) => value === normalizedB[index]);
    }

    private coerceSliderValue(raw: unknown, min: number, max: number): number {
        const numeric = typeof raw === 'number'
            ? raw
            : Number.parseInt(String(raw ?? '').trim(), 10);

        if (!Number.isFinite(numeric)) {
            return min;
        }
        if (numeric < min) {
            return min;
        }
        if (numeric > max) {
            return max;
        }
        return numeric;
    }

    private ensureYearWithinBounds(year: number): void {
        const bounds = this.issuedYearBounds();
        const min = Math.min(bounds.min, year);
        const max = Math.max(bounds.max, year);
        if (min !== bounds.min || max !== bounds.max) {
            this.issuedYearBounds.set({ min, max });
        }
    }

    private updateIssuedYearBounds(facets: PublicationFacetCollection | null): void {
        if (!facets) {
            return;
        }
        const years: number[] = [];
        for (const active of this.issuedYearFilters()) {
            const numeric = Number.parseInt(active, 10);
            if (Number.isFinite(numeric)) {
                years.push(numeric);
            }
        }
        const facetItems = facets.issued_years?.items ?? [];
        for (const item of facetItems) {
            const numeric = Number.parseInt(item.value, 10);
            if (Number.isFinite(numeric)) {
                years.push(numeric);
            }
        }
        if (!years.length) {
            return;
        }
        const bounds = this.issuedYearBounds();
        const min = Math.min(bounds.min, ...years);
        const max = Math.max(bounds.max, ...years);
        if (min !== bounds.min || max !== bounds.max) {
            this.issuedYearBounds.set({ min, max });
        }
    }

    private loadJournalOptions(): void {
        this.journalApi.list(1, undefined, 100)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: response => {
                    const results = response.results ?? [];
                    this.journalOptions.set(results);
                    const slug = this.journalSlug();
                    if (slug) {
                        const match = results.find(journal => journal.slug === slug);
                        if (match) {
                            this.journalName.set(match.name);
                        }
                    }
                },
                error: () => this.journalOptions.set([])
            });
    }

    private normalizeYearInput(value: unknown): string | null {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                return null;
            }
            const year = Math.trunc(value);
            if (year < 1000 || year > 9999) {
                return null;
            }
            return year.toString();
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
                return null;
            }
            const digits = trimmed.replace(/\D/g, '');
            if (digits.length < 4) {
                return null;
            }
            const candidate = digits.slice(0, 4);
            const numeric = Number.parseInt(candidate, 10);
            if (!Number.isFinite(numeric) || numeric < 1000) {
                return null;
            }
            return candidate;
        }
        return null;
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

        const journalSlug = this.journalSlug();
        const journalName = this.journalName();
        if (journalSlug) {
            queryParams['journal'] = journalSlug;
            if (journalName) {
                queryParams['journal_name'] = journalName;
            }
        }

        const ordering = this.ordering();
        if (ordering) {
            queryParams['ordering'] = ordering;
        }

        const issuedFrom = this.issuedFrom();
        if (issuedFrom) {
            queryParams['issued_from'] = issuedFrom;
        }

        const issuedTo = this.issuedTo();
        if (issuedTo) {
            queryParams['issued_to'] = issuedTo;
        }

        const subjectValues = this.subjectFilters();
        const subjectString = subjectValues.length ? subjectValues.join(', ') : '';
        if (subjectValues.length) {
            queryParams['subject'] = subjectString;
        }

        const authors = this.authorFilters();
        if (authors.length) {
            queryParams['author'] = authors;
        }

        const issuedYears = this.issuedYearFilters();
        if (issuedYears.length) {
            queryParams['issued_year'] = issuedYears;
        }

        const currentParams = this.route.snapshot.queryParamMap;
        const currentPage = currentParams.get('page');
        const currentSearch = currentParams.get('search') ?? '';
        const currentPageSize = currentParams.get('page_size');
        const currentJournal = currentParams.get('journal');
        const currentJournalName = currentParams.get('journal_name');
        const currentOrdering = currentParams.get('ordering');
        const currentIssuedFrom = currentParams.get('issued_from');
        const currentIssuedTo = currentParams.get('issued_to');
        const currentSubjectValues = this.parseSubjectParam(currentParams.get('subject'));
        const currentAuthors = (currentParams.getAll('author') ?? []).map(value => (value ?? '').trim()).filter(value => value.length > 0);
        const currentIssuedYears = (currentParams.getAll('issued_year') ?? []).map(value => (value ?? '').trim()).filter(value => value.length > 0);

        const targetPage = Object.prototype.hasOwnProperty.call(queryParams, 'page') ? String(queryParams['page']) : null;
        const targetSearch = Object.prototype.hasOwnProperty.call(queryParams, 'search') ? String(queryParams['search']) : '';
        const targetPageSize = Object.prototype.hasOwnProperty.call(queryParams, 'page_size') ? String(queryParams['page_size']) : null;
        const targetJournal = journalSlug ?? null;
        const targetJournalName = journalSlug && journalName ? journalName : null;
        const targetOrdering = ordering ?? null;
        const targetIssuedFrom = issuedFrom ?? null;
        const targetIssuedTo = issuedTo ?? null;
        const subjectsEqual = this.areStringArraysEqual(currentSubjectValues, subjectValues);
        const authorsEqual = this.areStringArraysEqual(currentAuthors, authors);
        const issuedYearsEqual = this.areStringArraysEqual(currentIssuedYears, issuedYears);

        if (
            currentPage === targetPage &&
            currentSearch === targetSearch &&
            currentPageSize === targetPageSize &&
            currentJournal === targetJournal &&
            currentJournalName === targetJournalName &&
            currentOrdering === targetOrdering &&
            currentIssuedFrom === targetIssuedFrom &&
            currentIssuedTo === targetIssuedTo &&
            subjectsEqual &&
            authorsEqual &&
            issuedYearsEqual
        ) {
            return false;
        }

        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            replaceUrl: true
        });
        return true;
    }

    private fetchPublications(): void {
        const currentPage = this.page();
        const currentSearch = this.searchQuery();
        const trimmedSearch = currentSearch.trim();
        const isSearch = trimmedSearch.length > 0;
        const requestedPageSize = Math.max(1, Math.floor(this.pageSize()));
        const journalSlug = this.journalSlug();
        const issuedFrom = this.issuedFrom();
        const issuedTo = this.issuedTo();
        const subjectValues = this.subjectFilters();
        const subjectString = subjectValues.length ? subjectValues.join(', ') : undefined;
        const authors = this.authorFilters();
        const issuedYears = this.issuedYearFilters();
        const ordering = this.ordering();
        const hasAdditionalFilters = Boolean(
            journalSlug ||
            issuedFrom ||
            issuedTo ||
            ordering ||
            subjectValues.length ||
            authors.length ||
            issuedYears.length
        );
        const usingSearchEndpoint = isSearch && !hasAdditionalFilters;

        this.loading.set(true);
        this.error.set(null);

        const filterOptions = {
            page: currentPage,
            pageSize: requestedPageSize,
            journalSlug: journalSlug ?? undefined,
            ordering: ordering ?? undefined,
            issuedFrom: issuedFrom ?? undefined,
            issuedTo: issuedTo ?? undefined,
            subject: subjectString,
            authors: authors.length ? authors : undefined,
            issuedYears: issuedYears.length ? issuedYears : undefined
        };

        const request$ = usingSearchEndpoint
            ? this.publicationApi.search(trimmedSearch, filterOptions)
            : this.publicationApi.list({
                ...filterOptions,
                search: isSearch ? trimmedSearch : undefined
            });

        request$
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: response => {
                    const results = Array.isArray(response.results) ? response.results : [];
                    const totalCount = typeof response.count === 'number' ? response.count : results.length;
                    const totalPages = totalCount > 0 ? Math.ceil(totalCount / requestedPageSize) : 1;

                    this.count.set(totalCount);
                    this.facets.set(response.facets ?? null);
                    this.updateIssuedYearBounds(response.facets ?? null);

                    if (totalCount === 0) {
                        if (currentPage !== 1) {
                            this.page.set(1);
                            this.hasLoadedInitial = false;
                            const navigated = this.updateQueryParams();
                            if (!navigated) {
                                this.hasLoadedInitial = true;
                            }
                        }
                        this.publications.set([]);
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
                                this.fetchPublications();
                                this.hasLoadedInitial = true;
                            }
                            this.loading.set(false);
                            return;
                        }
                    }

                    this.publications.set(results);
                    this.loading.set(false);
                    this.hasLoadedInitial = true;
                },
                error: err => {
                    this.loading.set(false);
                    this.facets.set(null);
                    let detail = err?.error?.detail ?? 'Unable to load publications.';
                    if (usingSearchEndpoint && err?.status === 503) {
                        detail = 'Search is temporarily unavailable. Please try again later.';
                    } else if (isSearch && !usingSearchEndpoint) {
                        detail = 'Unable to apply the selected filters with search.';
                    }
                    this.count.set(0);
                    this.publications.set([]);
                    this.error.set(detail);
                    this.hasLoadedInitial = true;
                }
            });
    }
}
