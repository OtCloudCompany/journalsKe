import { NgIf, NgFor, NgForOf, DatePipe, NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { AuthStateService } from '../../../core/services/auth-state.service';
import { JournalApiService } from '../../../core/services/journal-api.service';
import { Journal } from '../../../core/models/journal.models';

@Component({
    selector: 'app-journal-detail',
    standalone: true,
    imports: [NgIf, NgFor, NgForOf, RouterLink, DatePipe, NgClass],
    templateUrl: './journal-detail.component.html',
    styleUrl: './journal-detail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class JournalDetailComponent implements OnInit {
    private readonly journalApi = inject(JournalApiService);
    private readonly authState = inject(AuthStateService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly platformId = inject(PLATFORM_ID);

    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly journal = signal<Journal | null>(null);
    readonly testingOai = signal(false);
    readonly oaiTestMessage = signal<string | null>(null);
    readonly oaiTestSuccess = signal<boolean | null>(null);

    readonly canManage = computed(() => this.authState.isAuthenticated);
    readonly isBrowser = isPlatformBrowser(this.platformId);

    ngOnInit(): void {
        const slug = this.route.snapshot.paramMap.get('slug');
        if (!slug) {
            this.error.set('Journal not found.');
            return;
        }
        this.fetchJournal(slug);
    }

    fetchJournal(slug: string): void {
        this.loading.set(true);
        this.error.set(null);
        this.journalApi.retrieve(slug).subscribe({
            next: (data) => {
                this.loading.set(false);
                this.journal.set(data);
                this.resetOaiTestState();
            },
            error: (err) => {
                this.loading.set(false);
                const detail = err?.error?.detail ?? 'Unable to load journal.';
                this.error.set(detail);
                this.resetOaiTestState();
            }
        });
    }

    goToEdit(): void {
        const slug = this.journal()?.slug;
        if (!slug) {
            return;
        }
        void this.router.navigate(['/journals', slug, 'edit']);
    }

    viewHarvestLogs(): void {
        const journal = this.journal();
        if (!journal) {
            return;
        }
        void this.router.navigate(['/harvest-logs'], {
            queryParams: {
                journal: journal.slug,
                journal_name: journal.name
            }
        });
    }

    deleteJournal(): void {
        if (!this.isBrowser) {
            return;
        }
        const journal = this.journal();
        if (!journal) {
            return;
        }
        if (!window.confirm(`Delete "${journal.name}"? This cannot be undone.`)) {
            return;
        }
        this.loading.set(true);
        this.journalApi.delete(journal.slug).subscribe({
            next: () => {
                this.loading.set(false);
                void this.router.navigate(['/journals'], { replaceUrl: true });
            },
            error: (err) => {
                this.loading.set(false);
                const detail = err?.error?.detail ?? 'Unable to delete journal.';
                this.error.set(detail);
            }
        });
    }

    testOaiEndpoint(): void {
        if (!this.canManage() || this.testingOai()) {
            return;
        }

        const journal = this.journal();
        const oaiUrl = journal?.oai_url?.trim();
        this.resetOaiTestState();

        if (!oaiUrl) {
            this.oaiTestSuccess.set(false);
            this.oaiTestMessage.set('No OAI-PMH URL is configured for this journal.');
            return;
        }

        this.testingOai.set(true);
        this.journalApi.validateOai(oaiUrl).subscribe({
            next: (result) => {
                this.testingOai.set(false);
                this.oaiTestSuccess.set(result.ok);
                this.oaiTestMessage.set(result.detail || (result.ok
                    ? 'Endpoint responded successfully.'
                    : 'Endpoint did not respond with valid OAI.'));
            },
            error: (err) => {
                this.testingOai.set(false);
                const detail = err?.error?.detail;
                const fallback = 'Unable to validate the endpoint. Confirm the URL is reachable.';
                this.oaiTestSuccess.set(false);
                this.oaiTestMessage.set(typeof detail === 'string' && detail.trim() ? detail : fallback);
            }
        });
    }

    private resetOaiTestState(): void {
        this.testingOai.set(false);
        this.oaiTestMessage.set(null);
        this.oaiTestSuccess.set(null);
    }
}
