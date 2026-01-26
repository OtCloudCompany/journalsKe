import { NgFor, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ResearcherApiService } from '../../../core/services/researcher-api.service';
import { PublicationApiService } from '../../../core/services/publication-api.service';
import { Publication } from '../../../core/models/publication.models';
import { ResearcherExperience, ResearcherProfile } from '../../../core/models/researcher.models';

interface PublicationSelection {
    id: string;
    slug: string;
    title: string;
    journal?: string | null;
    contribution: string;
}

@Component({
    selector: 'app-researcher-manage',
    standalone: true,
    imports: [NgIf, NgFor, ReactiveFormsModule],
    templateUrl: './researcher-manage.component.html',
    styleUrl: './researcher-manage.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResearcherManageComponent implements OnInit {
    private readonly formBuilder = inject(FormBuilder);
    private readonly researcherApi = inject(ResearcherApiService);
    private readonly publicationApi = inject(PublicationApiService);
    private readonly destroyRef = inject(DestroyRef);

    readonly profileForm = this.formBuilder.group({
        title: [''],
        display_name: ['', [Validators.required, Validators.maxLength(255)]],
        institutional_email: ['', [Validators.required, Validators.email]],
        affiliation: [''],
        current_position: [''],
        short_bio: ['', [Validators.maxLength(2000)]],
        research_interests: ['', [Validators.maxLength(1000)]],
        google_scholar_url: ['', [Validators.maxLength(1000)]],
        linkedin_url: ['', [Validators.maxLength(1000)]],
        orcid: ['', [Validators.maxLength(64)]],
        personal_website: ['', [Validators.maxLength(1000)]],
    });
    readonly experiences: FormArray<FormGroup> = this.formBuilder.array<FormGroup>([]);

    readonly publicationSearchControl = this.formBuilder.nonNullable.control('');

    readonly loadingProfile = signal(true);
    readonly saving = signal(false);
    readonly photoUploading = signal(false);
    readonly errorMessage = signal<string | null>(null);
    readonly successMessage = signal<string | null>(null);
    readonly verificationMessage = signal<string | null>(null);
    readonly existingProfileSlug = signal<string | null>(null);
    readonly institutionalEmailVerified = signal(false);
    readonly profilePhotoUrl = signal<string | null>(null);
    readonly selectedPublications = signal<PublicationSelection[]>([]);
    readonly publicationResults = signal<Publication[]>([]);
    readonly publicationSearchLoading = signal(false);
    salutationOptions: string[] = [
        'Dr.',
        'Prof.',
        'Professor',
        'Mr.',
        'Mrs.',
        'Ms.',
        'Mx.',
        'Eng.',
        'Rev.',
        'Hon.'
    ];

    readonly hasProfile = computed(() => this.existingProfileSlug() !== null);
    readonly hasExperiences = computed(() => this.experiences.length > 0);
    readonly hasSelectedPublications = computed(() => this.selectedPublications().length > 0);

    ngOnInit(): void {
        this.loadProfile();
        this.setupPublicationSearch();
    }

    get experienceControls(): FormGroup[] {
        return this.experiences.controls as FormGroup[];
    }

    addExperience(experience?: Partial<ResearcherExperience>): void {
        this.experiences.push(this.buildExperienceGroup(experience));
    }

    removeExperience(index: number): void {
        if (index < 0 || index >= this.experiences.length) {
            return;
        }
        this.experiences.removeAt(index);
    }

    submit(): void {
        if (this.profileForm.invalid) {
            this.profileForm.markAllAsTouched();
            this.experienceControls.forEach(control => control.markAllAsTouched());
            return;
        }

        const profileValues = this.profileForm.getRawValue();
        const displayName = (profileValues.display_name ?? '').trim();
        const experiencesPayload = this.experienceControls.map(control => {
            const value = control.getRawValue();
            return {
                id: value.id ?? undefined,
                employer: String(value.employer || '').trim(),
                role: String(value.role || '').trim(),
                start_date: value.start_date ? String(value.start_date) : null,
                end_date: value.is_current ? null : (value.end_date ? String(value.end_date) : null),
                is_current: Boolean(value.is_current),
                description: value.description ? String(value.description).trim() : null,
            };
        }).filter(item => item.employer && item.role);

        const publicationsPayload = this.selectedPublications().map(item => ({
            publication_id: item.id,
            contribution: item.contribution ? item.contribution.trim() : undefined,
        }));

        const payload = {
            title: profileValues.title?.trim() || undefined,
            display_name: displayName,
            institutional_email: profileValues.institutional_email?.trim() || undefined,
            affiliation: profileValues.affiliation?.trim() || undefined,
            current_position: profileValues.current_position?.trim() || undefined,
            short_bio: profileValues.short_bio?.trim() || undefined,
            research_interests: profileValues.research_interests?.trim() || undefined,
            google_scholar_url: profileValues.google_scholar_url?.trim() || undefined,
            linkedin_url: profileValues.linkedin_url?.trim() || undefined,
            orcid: profileValues.orcid?.trim() || undefined,
            personal_website: profileValues.personal_website?.trim() || undefined,
            experiences: experiencesPayload.length ? experiencesPayload : undefined,
            publications: publicationsPayload.length ? publicationsPayload : undefined,
        };

        this.saving.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        const request$ = this.hasProfile()
            ? this.researcherApi.updateMe(payload)
            : this.researcherApi.create(payload);

        request$.subscribe({
            next: (profile) => {
                this.applyProfile(profile);
                this.successMessage.set('Researcher profile saved successfully.');
                this.saving.set(false);
            },
            error: (err) => {
                const detail = err?.error?.detail ?? 'Unable to save researcher profile.';
                this.errorMessage.set(detail);
                this.saving.set(false);
            }
        });
    }

    onProfilePhotoSelected(event: Event): void {
        const target = event.target as HTMLInputElement;
        if (!target.files || target.files.length === 0) {
            return;
        }
        const file = target.files[0];
        if (!file) {
            return;
        }
        this.photoUploading.set(true);
        this.researcherApi.uploadProfilePhoto(file).subscribe({
            next: (profile) => {
                this.applyProfile(profile);
                this.photoUploading.set(false);
                this.successMessage.set('Profile photo updated.');
            },
            error: (err) => {
                const detail = err?.error?.detail ?? 'Unable to upload profile photo.';
                this.errorMessage.set(detail);
                this.photoUploading.set(false);
            }
        });
    }

    removeProfilePhoto(): void {
        this.photoUploading.set(true);
        this.researcherApi.removeProfilePhoto().subscribe({
            next: () => {
                this.profilePhotoUrl.set(null);
                this.photoUploading.set(false);
                this.successMessage.set('Profile photo removed.');
            },
            error: (err) => {
                const detail = err?.error?.detail ?? 'Unable to remove profile photo.';
                this.errorMessage.set(detail);
                this.photoUploading.set(false);
            }
        });
    }

    resendInstitutionalEmail(): void {
        this.researcherApi.resendInstitutionalEmail().subscribe({
            next: (response) => {
                this.verificationMessage.set(response.detail || 'Verification email sent.');
            },
            error: (err) => {
                const detail = err?.error?.detail ?? 'Unable to resend verification email.';
                this.verificationMessage.set(detail);
            }
        });
    }

    addPublicationFromSearch(publication: Publication): void {
        const existing = this.selectedPublications();
        if (existing.some(item => item.id === publication.id)) {
            return;
        }
        const nextSelection: PublicationSelection = {
            id: publication.id,
            slug: publication.slug,
            title: publication.title,
            journal: publication.journal?.name ?? null,
            contribution: ''
        };
        this.selectedPublications.set([...existing, nextSelection]);
    }

    removePublication(id: string): void {
        this.selectedPublications.set(this.selectedPublications().filter(item => item.id !== id));
    }

    updatePublicationContribution(id: string, value: string): void {
        this.selectedPublications.set(
            this.selectedPublications().map(item =>
                item.id === id ? { ...item, contribution: value } : item
            )
        );
    }

    private loadProfile(): void {
        this.researcherApi.getMe().subscribe({
            next: (profile) => {
                this.applyProfile(profile);
                this.loadingProfile.set(false);
            },
            error: (err) => {
                if (err?.status === 404) {
                    this.loadingProfile.set(false);
                    if (this.experiences.length === 0) {
                        this.addExperience();
                    }
                    return;
                }
                const detail = err?.error?.detail ?? 'Unable to load researcher profile.';
                this.errorMessage.set(detail);
                this.loadingProfile.set(false);
            }
        });
    }

    private applyProfile(profile: ResearcherProfile): void {
        this.ensureSalutationOption(profile.title);
        this.profileForm.patchValue({
            title: profile.title ?? '',
            display_name: profile.display_name ?? '',
            institutional_email: profile.institutional_email ?? '',
            affiliation: profile.affiliation ?? '',
            current_position: profile.current_position ?? '',
            short_bio: profile.short_bio ?? '',
            research_interests: profile.research_interests ?? '',
            google_scholar_url: profile.google_scholar_url ?? '',
            linkedin_url: profile.linkedin_url ?? '',
            orcid: profile.orcid ?? '',
            personal_website: profile.personal_website ?? '',
        });
        this.existingProfileSlug.set(profile.slug);
        this.institutionalEmailVerified.set(profile.institutional_email_verified);
        this.profilePhotoUrl.set(profile.profile_photo_url ?? null);
        this.verificationMessage.set(null);

        while (this.experiences.length) {
            this.experiences.removeAt(0);
        }
        profile.experiences.forEach(experience => {
            this.experiences.push(this.buildExperienceGroup(experience));
        });
        if (this.experiences.length === 0) {
            this.addExperience();
        }

        this.selectedPublications.set(
            profile.publications.map(link => ({
                id: link.publication.id,
                slug: link.publication.slug,
                title: link.publication.title,
                journal: link.publication.journal?.name ?? null,
                contribution: link.contribution ?? ''
            }))
        );
    }

    private buildExperienceGroup(experience?: Partial<ResearcherExperience>): FormGroup {
        return this.formBuilder.group({
            id: [experience?.id ?? null],
            employer: [experience?.employer ?? '', [Validators.required, Validators.maxLength(255)]],
            role: [experience?.role ?? '', [Validators.required, Validators.maxLength(255)]],
            start_date: [experience?.start_date ?? ''],
            end_date: [experience?.end_date ?? ''],
            is_current: [experience?.is_current ?? false],
            description: [experience?.description ?? '', [Validators.maxLength(2000)]],
        });
    }

    private setupPublicationSearch(): void {
        this.publicationSearchControl.valueChanges
            .pipe(
                debounceTime(300),
                distinctUntilChanged(),
                takeUntilDestroyed(this.destroyRef)
            )
            .subscribe(query => {
                const trimmed = (query || '').trim();
                if (!trimmed) {
                    this.publicationResults.set([]);
                    return;
                }
                this.publicationSearchLoading.set(true);
                this.publicationApi.search(trimmed, { page: 1, pageSize: 5 }).subscribe({
                    next: (response) => {
                        this.publicationResults.set(response.results ?? []);
                        this.publicationSearchLoading.set(false);
                    },
                    error: () => {
                        this.publicationResults.set([]);
                        this.publicationSearchLoading.set(false);
                    }
                });
            });
    }

    private ensureSalutationOption(value: string | null | undefined): void {
        const trimmed = (value ?? '').trim();
        if (!trimmed) {
            return;
        }
        if (this.salutationOptions.includes(trimmed)) {
            return;
        }
        this.salutationOptions = [...this.salutationOptions, trimmed];
    }
}
