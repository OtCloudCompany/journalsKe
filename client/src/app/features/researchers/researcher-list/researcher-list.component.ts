import { NgFor, NgIf, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ResearcherApiService } from '../../../core/services/researcher-api.service';
import { ResearcherProfile } from '../../../core/models/researcher.models';

const DEFAULT_PAGE_SIZE = 10;

@Component({
    selector: 'app-researcher-list',
    standalone: true,
    imports: [NgIf, NgFor, UpperCasePipe, RouterLink, ReactiveFormsModule],
    templateUrl: './researcher-list.component.html',
    styleUrl: './researcher-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResearcherListComponent implements OnInit {
    private readonly researcherApi = inject(ResearcherApiService);
    private readonly formBuilder = inject(FormBuilder);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly researchers = signal<ResearcherProfile[]>([]);
    readonly count = signal(0);
    readonly page = signal(1);
    readonly pageSize = signal(DEFAULT_PAGE_SIZE);

    readonly searchControl = this.formBuilder.nonNullable.control('');

    readonly totalPages = computed(() => {
        const total = this.count();
        const size = Math.max(1, this.pageSize());
        return total === 0 ? 1 : Math.ceil(total / size);
    });
    readonly hasResults = computed(() => !this.loading() && !this.error() && this.researchers().length > 0);
    readonly isEmpty = computed(() => !this.loading() && !this.error() && this.researchers().length === 0);
    readonly pageNumbers = computed(() => {
        const total = this.totalPages();
        return Array.from({ length: total }, (_, index) => index + 1);
    });

    ngOnInit(): void {
        this.searchControl.valueChanges
            .pipe(
                debounceTime(300),
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(() => {
                this.page.set(1);
                this.fetchResearchers();
            });

        this.fetchResearchers();
    }

    retry(): void {
        this.fetchResearchers();
    }

    nextPage(): void {
        const next = this.page() + 1;
        if (next > this.totalPages()) {
            return;
        }
        this.page.set(next);
        this.fetchResearchers();
    }

    previousPage(): void {
        const previous = this.page() - 1;
        if (previous < 1) {
            return;
        }
        this.page.set(previous);
        this.fetchResearchers();
    }

    goToPage(target: number): void {
        if (target < 1 || target > this.totalPages() || target === this.page()) {
            return;
        }
        this.page.set(target);
        this.fetchResearchers();
    }

    trackBySlug(_: number, researcher: ResearcherProfile): string {
        return researcher.slug;
    }

    private fetchResearchers(): void {
        const page = this.page();
        const size = this.pageSize();
        const query = (this.searchControl.value || '').trim();

        this.loading.set(true);
        this.error.set(null);

        this.researcherApi.list(page, query || undefined, size).subscribe({
            next: (response) => {
                const results = Array.isArray(response.results) ? response.results : [];
                const total = typeof response.count === 'number' ? response.count : results.length;
                this.researchers.set(results);
                this.count.set(total);
                if (results.length === 0 && total > 0 && page > 1) {
                    const totalPages = Math.max(1, Math.ceil(total / size));
                    const fallbackPage = Math.min(page, totalPages);
                    if (fallbackPage !== page) {
                        this.page.set(fallbackPage);
                        this.fetchResearchers();
                        return;
                    }
                }
                this.loading.set(false);
            },
            error: (err) => {
                const detail = err?.error?.detail ?? 'Unable to load researchers.';
                this.error.set(detail);
                this.researchers.set([]);
                this.loading.set(false);
            }
        });
    }
}
