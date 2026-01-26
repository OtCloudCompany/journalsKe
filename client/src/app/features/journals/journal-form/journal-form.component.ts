import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgIf } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { JournalApiService } from '../../../core/services/journal-api.service';
import { Journal, JournalPayload } from '../../../core/models/journal.models';

@Component({
    selector: 'app-journal-form',
    standalone: true,
    imports: [ReactiveFormsModule, RouterLink, NgIf],
    templateUrl: './journal-form.component.html',
    styleUrl: './journal-form.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class JournalFormComponent implements OnInit {
    private readonly formBuilder = inject(FormBuilder);
    private readonly journalApi = inject(JournalApiService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly submitting = signal(false);
    readonly errorMessage = signal<string | null>(null);
    readonly successMessage = signal<string | null>(null);
    readonly isEditMode = signal(false);
    readonly loadedJournal = signal<Journal | null>(null);
    readonly testingOai = signal(false);
    readonly oaiTestMessage = signal<string | null>(null);
    readonly oaiTestSuccess = signal<boolean | null>(null);

    readonly form = this.formBuilder.nonNullable.group({
        name: ['', [Validators.required, Validators.minLength(3)]],
        description: [''],
        homepage_url: [''],
        oai_url: [''],
        chief_editor: [''],
        publisher: [''],
        issn_print: [''],
        issn_online: [''],
        language: [''],
        country: [''],
        founded_year: [''],
        contact_email: ['', Validators.email],
        is_active: [true]
    });

    ngOnInit(): void {
        const slug = this.route.snapshot.paramMap.get('slug');
        if (slug) {
            this.isEditMode.set(true);
            this.loadJournal(slug);
        }

        this.form.controls.oai_url.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.resetOaiTestState());
    }

    submit(): void {
        if (this.form.invalid || this.submitting()) {
            this.form.markAllAsTouched();
            return;
        }

        this.submitting.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        const payload = this.buildPayload();
        const slug = this.loadedJournal()?.slug;

        const request$ = slug
            ? this.journalApi.update(slug, payload)
            : this.journalApi.create(payload);

        request$.subscribe({
            next: (journal) => {
                this.submitting.set(false);
                this.successMessage.set(slug ? 'Journal updated successfully.' : 'Journal created successfully.');
                this.loadedJournal.set(journal);
                if (!slug) {
                    this.isEditMode.set(true);
                    this.form.reset({
                        name: journal.name,
                        description: journal.description,
                        homepage_url: journal.homepage_url,
                        oai_url: journal.oai_url,
                        chief_editor: journal.chief_editor,
                        publisher: journal.publisher,
                        issn_print: journal.issn_print,
                        issn_online: journal.issn_online,
                        language: journal.language,
                        country: journal.country,
                        founded_year: journal.founded_year ? String(journal.founded_year) : '',
                        contact_email: journal.contact_email,
                        is_active: journal.is_active
                    });
                }
                this.resetOaiTestState();
                void this.router.navigate(['/journals', journal.slug]);
            },
            error: (err) => {
                this.submitting.set(false);
                const detail = err?.error?.detail ?? 'Unable to save journal.';
                this.errorMessage.set(detail);
            }
        });
    }

    cancel(): void {
        const journal = this.loadedJournal();
        void this.router.navigate(journal ? ['/journals', journal.slug] : ['/journals']);
    }

    testOaiEndpoint(): void {
        if (this.testingOai()) {
            return;
        }

        const rawValue = this.form.controls.oai_url.value?.trim() ?? '';
        this.resetOaiTestState();

        if (!rawValue) {
            this.oaiTestMessage.set('Provide an OAI-PMH URL before testing.');
            this.oaiTestSuccess.set(false);
            return;
        }

        this.testingOai.set(true);
        this.journalApi.validateOai(rawValue).subscribe({
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

    hasOaiUrl(): boolean {
        const value = this.form.controls.oai_url.value;
        return Boolean(value && value.trim());
    }

    private loadJournal(slug: string): void {
        this.submitting.set(true);
        this.journalApi.retrieve(slug).subscribe({
            next: (journal) => {
                this.submitting.set(false);
                this.loadedJournal.set(journal);
                this.form.reset({
                    name: journal.name,
                    description: journal.description,
                    homepage_url: journal.homepage_url,
                    oai_url: journal.oai_url,
                    chief_editor: journal.chief_editor,
                    publisher: journal.publisher,
                    issn_print: journal.issn_print,
                    issn_online: journal.issn_online,
                    language: journal.language,
                    country: journal.country,
                    founded_year: journal.founded_year ? String(journal.founded_year) : '',
                    contact_email: journal.contact_email,
                    is_active: journal.is_active
                });
                this.resetOaiTestState();
            },
            error: (err) => {
                this.submitting.set(false);
                const detail = err?.error?.detail ?? 'Unable to load journal.';
                this.errorMessage.set(detail);
            }
        });
    }

    private resetOaiTestState(): void {
        this.testingOai.set(false);
        this.oaiTestMessage.set(null);
        this.oaiTestSuccess.set(null);
    }

    private buildPayload(): JournalPayload {
        const raw = this.form.getRawValue();
        const payload: JournalPayload = {
            name: raw.name.trim(),
            description: raw.description?.trim() || '',
            homepage_url: raw.homepage_url?.trim() || '',
            oai_url: raw.oai_url?.trim() || '',
            chief_editor: raw.chief_editor?.trim() || '',
            publisher: raw.publisher?.trim() || '',
            issn_print: raw.issn_print?.trim() || '',
            issn_online: raw.issn_online?.trim() || '',
            language: raw.language?.trim() || '',
            country: raw.country?.trim() || '',
            contact_email: raw.contact_email?.trim() || '',
            is_active: raw.is_active,
        };

        const year = raw.founded_year ? Number(raw.founded_year) : null;
        if (year) {
            payload.founded_year = year;
        } else {
            payload.founded_year = null;
        }

        return payload;
    }
}
