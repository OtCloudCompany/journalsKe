import { NgFor, NgIf, UpperCasePipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ResearcherApiService } from '../../../core/services/researcher-api.service';
import { ResearcherProfile } from '../../../core/models/researcher.models';

@Component({
    selector: 'app-researcher-detail',
    standalone: true,
    imports: [NgIf, NgFor, UpperCasePipe, DatePipe, RouterLink],
    templateUrl: './researcher-detail.component.html',
    styleUrl: './researcher-detail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResearcherDetailComponent implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly researcherApi = inject(ResearcherApiService);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading = signal(true);
    readonly error = signal<string | null>(null);
    readonly researcher = signal<ResearcherProfile | null>(null);

    readonly hasExperiences = computed(() => (this.researcher()?.experiences.length ?? 0) > 0);
    readonly hasPublications = computed(() => (this.researcher()?.publications.length ?? 0) > 0);

    ngOnInit(): void {
        this.route.paramMap
            .pipe(
                distinctUntilChanged((prev, curr) => prev.get('slug') === curr.get('slug')),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(params => {
                const slug = params.get('slug');
                if (!slug) {
                    this.error.set('Researcher not found.');
                    this.loading.set(false);
                    return;
                }
                this.fetchResearcher(slug);
            });
    }

    retry(): void {
        const slug = this.route.snapshot.paramMap.get('slug');
        if (slug) {
            this.fetchResearcher(slug);
        }
    }

    trackExperienceById(_: number, experience: { id: number }): number {
        return experience.id;
    }

    trackPublicationById(_: number, publication: { id: number }): number {
        return publication.id;
    }

    getEmailLink(email: string | undefined | null): string | null {
        if (!email) {
            return null;
        }
        return `mailto:${email}`;
    }

    private fetchResearcher(slug: string): void {
        this.loading.set(true);
        this.error.set(null);
        this.researcher.set(null);

        this.researcherApi.retrieve(slug).subscribe({
            next: (profile) => {
                this.researcher.set(profile);
                this.loading.set(false);
            },
            error: (err) => {
                if (err?.status === 404) {
                    this.error.set('Researcher profile not found.');
                } else {
                    const detail = err?.error?.detail ?? 'Unable to load researcher profile.';
                    this.error.set(detail);
                }
                this.loading.set(false);
            }
        });
    }
}
