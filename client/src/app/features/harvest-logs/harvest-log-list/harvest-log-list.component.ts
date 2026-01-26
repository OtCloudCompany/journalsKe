import { NgFor, NgIf, NgClass, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { HarvestLog, HarvestStatus } from '../../../core/models/harvest-log.models';
import { HarvestLogApiService } from '../../../core/services/harvest-log-api.service';

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const MAX_PAGE_LINKS = 7;
const STATUS_BADGE_MAP: Record<HarvestStatus, string> = {
    running: 'text-bg-warning',
    success: 'text-bg-success',
    failed: 'text-bg-danger'
};

const STATUS_FILTER_OPTIONS: Array<{ label: string; value: HarvestStatus | null }> = [
    { label: 'All statuses', value: null },
    { label: 'Success', value: 'success' },
    { label: 'Failed', value: 'failed' },
    { label: 'Running', value: 'running' }
];

@Component({
    selector: 'app-harvest-log-list',
    standalone: true,
    imports: [NgIf, NgFor, NgClass, RouterLink, DatePipe],
    templateUrl: './harvest-log-list.component.html',
    styleUrl: './harvest-log-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HarvestLogListComponent implements OnInit {
    private readonly harvestApi = inject(HarvestLogApiService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly logs = signal<HarvestLog[]>([]);
    readonly count = signal(0);
    readonly page = signal(1);
    readonly pageSize = signal(DEFAULT_PAGE_SIZE);
    readonly journalSlug = signal<string | null>(null);
    readonly journalName = signal<string | null>(null);
    readonly statusFilter = signal<HarvestStatus | null>(null);

    readonly pageSizeOptions = [...PAGE_SIZE_OPTIONS];
    readonly statusOptions = STATUS_FILTER_OPTIONS;

    readonly hasResults = computed(() => this.logs().length > 0);
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

    ngOnInit(): void {
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const pageParam = Number(params.get('page'));
                const resolvedPage = !Number.isNaN(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

                const pageSizeParam = Number(params.get('page_size'));
                const resolvedPageSize = !Number.isNaN(pageSizeParam) && pageSizeParam > 0
                    ? Math.floor(pageSizeParam)
                    : DEFAULT_PAGE_SIZE;

                const journalParam = params.get('journal');
                const journalNameParam = params.get('journal_name');
                const statusParam = params.get('status') as HarvestStatus | null;

                const normalizedStatus = statusParam && ['running', 'success', 'failed'].includes(statusParam)
                    ? statusParam
                    : null;

                this.page.set(resolvedPage);
                const normalizedSize = Math.max(1, resolvedPageSize);
                this.pageSize.set(normalizedSize);
                if (!this.pageSizeOptions.includes(normalizedSize)) {
                    this.pageSizeOptions.push(normalizedSize);
                    this.pageSizeOptions.sort((a, b) => a - b);
                }
                this.journalSlug.set(journalParam ? journalParam.trim() : null);
                this.statusFilter.set(normalizedStatus);

                if (journalNameParam && journalNameParam.trim()) {
                    this.journalName.set(journalNameParam.trim());
                }

                this.fetchLogs();
            });
    }

    trackLog(_: number, log: HarvestLog): number {
        return log.id;
    }

    badgeClass(status: HarvestStatus): string {
        return STATUS_BADGE_MAP[status] ?? 'text-bg-secondary';
    }

    statusLabel(status: HarvestStatus): string {
        switch (status) {
            case 'success':
                return 'Success';
            case 'failed':
                return 'Failed';
            case 'running':
                return 'Running';
            default:
                return status;
        }
    }

    goToPage(page: number): void {
        if (page === this.page() || page < 1 || page > this.totalPages()) {
            return;
        }
        this.updateQueryParams({ page });
    }

    nextPage(): void {
        this.goToPage(this.page() + 1);
    }

    previousPage(): void {
        this.goToPage(this.page() - 1);
    }

    changePageSize(value: string): void {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return;
        }
        const normalized = Math.max(1, parsed);
        if (normalized === this.pageSize()) {
            return;
        }
        this.updateQueryParams({ page_size: normalized, page: 1 });
    }

    applyStatusFilter(status: HarvestStatus | null): void {
        this.statusFilter.set(status);
        this.updateQueryParams({ status: status ?? null, page: 1 });
    }

    onStatusChange(value: string): void {
        if (!value || value === 'all') {
            this.applyStatusFilter(null);
            return;
        }
        if (value === 'success' || value === 'failed' || value === 'running') {
            this.applyStatusFilter(value);
        }
    }

    clearJournalFilter(): void {
        this.journalSlug.set(null);
        this.journalName.set(null);
        this.updateQueryParams({ journal: null, journal_name: null, page: 1 });
    }

    navigateToJournal(log: HarvestLog): void {
        const slug = log.journal?.slug;
        if (!slug) {
            return;
        }
        void this.router.navigate(['/journals', slug]);
    }

    private fetchLogs(): void {
        const page = this.page();
        const pageSize = this.pageSize();
        const journal = this.journalSlug();
        const status = this.statusFilter();

        this.loading.set(true);
        this.error.set(null);

        this.harvestApi.list({
            page,
            pageSize,
            journal: journal || undefined,
            status: status || undefined
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: response => {
                const results = Array.isArray(response.results) ? response.results : [];
                const totalCount = typeof response.count === 'number' ? response.count : results.length;

                this.logs.set(results);
                this.count.set(totalCount);
                this.loading.set(false);

                if (!journal && results.length > 0) {
                    const firstJournal = results[0].journal;
                    if (firstJournal) {
                        this.journalName.set(firstJournal.name);
                    }
                } else if (journal && !this.journalName()) {
                    const inferred = results.find(item => item.journal?.slug === journal)?.journal?.name;
                    if (inferred) {
                        this.journalName.set(inferred);
                    }
                }
            },
            error: err => {
                this.loading.set(false);
                const detail = err?.error?.detail ?? 'Unable to load harvesting logs.';
                this.error.set(detail);
                this.logs.set([]);
                this.count.set(0);
            }
        });
    }

    private updateQueryParams(overrides: Record<string, unknown>): void {
        const nextPage = overrides.hasOwnProperty('page') ? overrides['page'] : this.page();
        const nextPageSize = overrides.hasOwnProperty('page_size') ? overrides['page_size'] : this.pageSize();
        const nextJournal = overrides.hasOwnProperty('journal') ? overrides['journal'] : this.journalSlug();
        const nextJournalName = overrides.hasOwnProperty('journal_name')
            ? overrides['journal_name']
            : this.journalName();
        const nextStatus = overrides.hasOwnProperty('status') ? overrides['status'] : this.statusFilter();

        const queryParams: Record<string, unknown> = {
            page: Number(nextPage) > 1 ? Number(nextPage) : null,
            page_size: Number(nextPageSize) !== DEFAULT_PAGE_SIZE ? Number(nextPageSize) : null,
            journal: nextJournal ? nextJournal : null,
            journal_name: nextJournalName ? nextJournalName : null,
            status: nextStatus ? nextStatus : null
        };

        const currentParams = this.route.snapshot.queryParamMap;
        const keys = Object.keys(queryParams);
        const isDifferent = keys.some(key => {
            const nextValue = queryParams[key];
            const currentValue = currentParams.get(key);
            if (nextValue === null || nextValue === undefined) {
                return currentValue !== null;
            }
            return String(nextValue) !== currentValue;
        });

        if (!isDifferent) {
            return;
        }

        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            queryParamsHandling: 'merge'
        });
    }
}
