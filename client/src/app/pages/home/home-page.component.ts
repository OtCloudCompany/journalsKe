import { CommonModule, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ResearcherApiService } from '../../core/services/researcher-api.service';
import { PublicationApiService } from '../../core/services/publication-api.service';
import { JournalApiService } from '../../core/services/journal-api.service';
import { HomeApiService } from '../../core/services/home-api.service';
import { AuthStateService } from '../../core/services/auth-state.service';
import { ResearcherProfile } from '../../core/models/researcher.models';
import { Publication } from '../../core/models/publication.models';
import { Journal } from '../../core/models/journal.models';
import { HomeMetrics } from '../../core/models/home.models';

interface InsightCard {
    title: string;
    value: string;
    subLabel: string;
    icon: string;
}

interface StatisticCard {
    label: string;
    value: string;
    icon: string;
}

interface FeaturedCollectionCard {
    title: string;
    category: string;
    accent: string;
    icon: string;
    slug: string;
}

interface ProfileProgress {
    slug: string | null;
    verified: boolean;
    missingTasks: string[];
}

type SearchTab = 'publications' | 'journals' | 'researchers';

const FEATURED_ACCENTS = ['bg-accent-ruby', 'bg-accent-emerald', 'bg-accent-teal', 'bg-accent-amber'];
const FEATURED_ICONS = ['bi-journal-bookmark-fill', 'bi-flower3', 'bi-cloud-sun', 'bi-heart-pulse-fill'];
const MINIMUM_VERIFIED_PROFILES = 4;
const PLACEHOLDER_PROFILE_PREFIX = 'placeholder-researcher-';
const PLACEHOLDER_TIMESTAMP = '1970-01-01T00:00:00Z';

const PLACEHOLDER_RESEARCHERS: ResearcherProfile[] = [
    {
        id: `${PLACEHOLDER_PROFILE_PREFIX}1`,
        slug: `${PLACEHOLDER_PROFILE_PREFIX}1`,
        title: 'Dr',
        display_name: 'Dr. Amani Kato',
        full_name: 'Dr. Amani Kato',
        institutional_email: 'placeholder1@example.com',
        institutional_email_verified: true,
        institutional_email_verified_at: null,
        affiliation: 'Nairobi Institute for Innovation',
        current_position: 'Research Fellow',
        short_bio: null,
        research_interests: 'Sustainable development, Community health',
        google_scholar_url: null,
        linkedin_url: null,
        orcid: null,
        personal_website: null,
        profile_photo_url: null,
        experiences: [],
        publications: [],
        created_at: PLACEHOLDER_TIMESTAMP,
        updated_at: PLACEHOLDER_TIMESTAMP
    },
    {
        id: `${PLACEHOLDER_PROFILE_PREFIX}2`,
        slug: `${PLACEHOLDER_PROFILE_PREFIX}2`,
        title: 'Prof',
        display_name: 'Prof. Wanjiku Mworia',
        full_name: 'Prof. Wanjiku Mworia',
        institutional_email: 'placeholder2@example.com',
        institutional_email_verified: true,
        institutional_email_verified_at: null,
        affiliation: 'Karatina University',
        current_position: 'Professor of Environmental Science',
        short_bio: null,
        research_interests: 'Climate resilience, Renewable energy',
        google_scholar_url: null,
        linkedin_url: null,
        orcid: null,
        personal_website: null,
        profile_photo_url: null,
        experiences: [],
        publications: [],
        created_at: PLACEHOLDER_TIMESTAMP,
        updated_at: PLACEHOLDER_TIMESTAMP
    },
    {
        id: `${PLACEHOLDER_PROFILE_PREFIX}3`,
        slug: `${PLACEHOLDER_PROFILE_PREFIX}3`,
        title: 'Dr',
        display_name: 'Dr. Kamau Kihara',
        full_name: 'Dr. Kamau Kihara',
        institutional_email: 'placeholder3@example.com',
        institutional_email_verified: true,
        institutional_email_verified_at: null,
        affiliation: 'Coastal Research Hub',
        current_position: 'Lead Data Scientist',
        short_bio: null,
        research_interests: 'Marine data, Open science',
        google_scholar_url: null,
        linkedin_url: null,
        orcid: null,
        personal_website: null,
        profile_photo_url: null,
        experiences: [],
        publications: [],
        created_at: PLACEHOLDER_TIMESTAMP,
        updated_at: PLACEHOLDER_TIMESTAMP
    },
    {
        id: `${PLACEHOLDER_PROFILE_PREFIX}4`,
        slug: `${PLACEHOLDER_PROFILE_PREFIX}4`,
        title: 'Dr',
        display_name: 'Dr. Achieng Otieno',
        full_name: 'Dr. Achieng Otieno',
        institutional_email: 'placeholder4@example.com',
        institutional_email_verified: true,
        institutional_email_verified_at: null,
        affiliation: 'Lake Basin Innovation Centre',
        current_position: 'Lead Research Scientist',
        short_bio: null,
        research_interests: 'Water security, Agricultural innovation',
        google_scholar_url: null,
        linkedin_url: null,
        orcid: null,
        personal_website: null,
        profile_photo_url: null,
        experiences: [],
        publications: [],
        created_at: PLACEHOLDER_TIMESTAMP,
        updated_at: PLACEHOLDER_TIMESTAMP
    }
];

@Component({
    selector: 'app-home-page',
    standalone: true,
    imports: [CommonModule, NgIf, NgFor, ReactiveFormsModule, RouterLink],
    templateUrl: './home-page.component.html',
    styleUrl: './home-page.component.scss'
})
export class HomePageComponent implements OnInit {
    private readonly researcherApi = inject(ResearcherApiService);
    private readonly publicationApi = inject(PublicationApiService);
    private readonly journalApi = inject(JournalApiService);
    private readonly homeApi = inject(HomeApiService);
    private readonly authState = inject(AuthStateService);
    private readonly formBuilder = inject(FormBuilder);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    protected readonly searchFilters = signal([
        'Scholars',
        'Articles',
        'Institutions',
        'Datasets'
    ]);

    protected readonly newsroomHighlights = signal([
        {
            title: 'National Research Summit 2025',
            description: 'Call for presentations focused on climate resilience and indigenous knowledge.',
            icon: 'bi-megaphone'
        },
        {
            title: 'Open Access Milestone',
            description: 'Kenyan universities collectively surpass 50,000 open access publications.',
            icon: 'bi-unlock-fill'
        }
    ]);

    protected readonly activeSearchTab = signal<SearchTab>('publications');
    protected readonly publicationSearchForm = this.formBuilder.nonNullable.group({
        query: ['']
    });
    protected readonly journalSearchForm = this.formBuilder.nonNullable.group({
        query: ['']
    });
    protected readonly researcherSearchForm = this.formBuilder.nonNullable.group({
        query: ['']
    });
    protected readonly publicationSearchControl = this.publicationSearchForm.controls.query;
    protected readonly journalSearchControl = this.journalSearchForm.controls.query;
    protected readonly researcherSearchControl = this.researcherSearchForm.controls.query;
    protected readonly publicationSearching = signal(false);
    protected readonly journalSearching = signal(false);
    protected readonly researcherSearching = signal(false);
    protected readonly publicationResults = signal<Publication[]>([]);
    protected readonly journalResults = signal<Journal[]>([]);
    protected readonly researcherResults = signal<ResearcherProfile[]>([]);
    protected readonly searching = this.publicationSearching;
    protected readonly searchControl = this.publicationSearchControl;
    protected readonly searchResults = computed(() => ({
        publications: this.publicationResults(),
        researchers: this.researcherResults()
    }));
    protected readonly verifiedResearchers = signal<ResearcherProfile[]>([]);
    protected readonly featuredJournals = signal<Journal[]>([]);
    protected readonly metrics = signal<HomeMetrics | null>(null);
    protected readonly profileProgress = signal<ProfileProgress | null>(null);
    protected readonly recentPublications = signal<Publication[]>([]);
    protected readonly recentPublicationListParams = { ordering: '-issued' } as const;

    protected readonly spotlightResearcher = computed(() => {
        const researchers = this.verifiedResearchers();
        return researchers.length ? researchers[0] : null;
    });

    protected readonly additionalResearchers = computed(() => {
        const researchers = this.verifiedResearchers();
        return researchers.slice(1, MINIMUM_VERIFIED_PROFILES);
    });

    protected readonly spotlightPublications = computed(() => {
        const profile = this.spotlightResearcher();
        if (!profile) {
            return [];
        }
        return (profile.publications ?? []).slice(0, 3).map(link => ({
            title: link.publication.title,
            year: this.parseIssuedYear(link.publication.issued)
        }));
    });

    protected readonly spotlightInterests = computed(() => {
        const profile = this.spotlightResearcher();
        if (!profile || !profile.research_interests) {
            return [];
        }
        return profile.research_interests.split(',').map(item => item.trim()).filter(Boolean).slice(0, 6);
    });

    protected readonly spotlightStats = computed(() => {
        const profile = this.spotlightResearcher();
        if (!profile) {
            return [];
        }
        return [
            { label: 'Publications', value: this.formatNumber(profile.publications.length) },
            { label: 'Experiences', value: this.formatNumber(profile.experiences.length) },
            {
                label: 'Verified',
                value: profile.institutional_email_verified ? 'Yes' : 'Pending'
            }
        ];
    });

    protected readonly featuredCollections = computed<FeaturedCollectionCard[]>(() => {
        const journals = this.featuredJournals();
        return journals.map((journal, index) => ({
            title: journal.name,
            category: journal.publisher || 'Journal',
            accent: FEATURED_ACCENTS[index % FEATURED_ACCENTS.length],
            icon: FEATURED_ICONS[index % FEATURED_ICONS.length],
            slug: journal.slug
        }));
    });

    protected readonly insightCards = computed<InsightCard[]>(() => {
        const metrics = this.metrics();
        if (!metrics) {
            return [
                { title: 'Verified Researchers', value: '—', subLabel: 'Awaiting data', icon: 'bi-people-fill' },
                { title: 'Publications Added', value: '—', subLabel: 'Last 30 days', icon: 'bi-journal-plus' }
            ];
        }
        return [
            {
                title: 'Verified Researchers',
                value: this.formatNumber(metrics.verifiedResearchers),
                subLabel: 'Active profiles',
                icon: 'bi-people-fill'
            },
            {
                title: 'New This Month',
                value: this.formatNumber(metrics.newVerifiedLast30Days),
                subLabel: 'Recently verified',
                icon: 'bi-stars'
            }
        ];
    });

    protected readonly keyStatistics = computed<StatisticCard[]>(() => {
        const metrics = this.metrics();
        if (!metrics) {
            return [
                { label: 'Publications', value: '—', icon: 'bi-journal-text' },
                { label: 'Journals', value: '—', icon: 'bi-newspaper' },
                { label: 'Active Journals', value: '—', icon: 'bi-lightbulb' }
            ];
        }
        return [
            { label: 'Publications', value: this.formatNumber(metrics.totalPublications), icon: 'bi-journal-text' },
            { label: 'Journals', value: this.formatNumber(metrics.totalJournals), icon: 'bi-newspaper' },
            { label: 'Active Journals', value: this.formatNumber(metrics.activeJournals), icon: 'bi-lightbulb' }
        ];
    });

    protected readonly showProfileCta = computed(() => {
        const progress = this.profileProgress();
        if (!progress) {
            return false;
        }
        return !progress.verified || progress.missingTasks.length > 0;
    });

    protected readonly profileCtaTasks = computed(() => {
        const progress = this.profileProgress();
        return progress ? progress.missingTasks : [];
    });

    protected isPlaceholderProfile(profile: ResearcherProfile): boolean {
        return profile.slug.startsWith(PLACEHOLDER_PROFILE_PREFIX);
    }

    ngOnInit(): void {
        this.loadVerifiedResearchers();
        this.loadFeaturedJournals();
        this.loadMetrics();
        this.setupSearchPanel();
        this.evaluateProfileProgress();
        this.loadRecentPublications();
    }

    protected trackBySlug(_: number, item: { slug: string }): string {
        return item.slug;
    }

    protected trackByTitle(_: number, item: { title: string }): string {
        return item.title;
    }

    protected formatYearLabel(entry: { year: number | string }): string {
        return typeof entry.year === 'number' ? entry.year.toString() : '—';
    }

    protected formatPublicationIssued(publication: Publication): string {
        const year = this.parseIssuedYear(publication.issued);
        return typeof year === 'number' ? year.toString() : 'Year unavailable';
    }

    protected setActiveSearchTab(tab: SearchTab): void {
        if (this.activeSearchTab() === tab) {
            return;
        }
        this.activeSearchTab.set(tab);
    }

    protected onSearchSubmit(tab: SearchTab, event: Event): void {
        event.preventDefault();
        const query = this.getSearchValue(tab);
        if (!query) {
            return;
        }
        const target = tab === 'publications'
            ? ['/publications']
            : tab === 'journals'
                ? ['/journals']
                : ['/researchers'];
        void this.router.navigate(target, {
            queryParams: { search: query }
        });
    }

    protected getSearchValue(tab: SearchTab): string {
        switch (tab) {
            case 'journals':
                return this.journalSearchControl.value.trim();
            case 'researchers':
                return this.researcherSearchControl.value.trim();
            case 'publications':
            default:
                return this.publicationSearchControl.value.trim();
        }
    }

    private loadVerifiedResearchers(): void {
        this.researcherApi.list(1, undefined, 4, '-institutional_email_verified_at').pipe(
            takeUntilDestroyed(this.destroyRef)
        ).subscribe({
            next: response => {
                const results = response.results ?? [];
                if (!results.length) {
                    this.verifiedResearchers.set(this.withMinimumResearchers([]));
                    return;
                }
                this.verifiedResearchers.set(this.withMinimumResearchers(results));
            },
            error: () => {
                this.verifiedResearchers.set(this.withMinimumResearchers([]));
            }
        });
    }

    private loadFeaturedJournals(): void {
        this.journalApi.list(1, undefined, 4).pipe(
            takeUntilDestroyed(this.destroyRef)
        ).subscribe({
            next: response => this.featuredJournals.set(response.results ?? []),
            error: () => this.featuredJournals.set([])
        });
    }

    private loadMetrics(): void {
        this.homeApi.getSummary().pipe(
            takeUntilDestroyed(this.destroyRef)
        ).subscribe({
            next: summary => this.metrics.set(summary),
            error: () => this.metrics.set(null)
        });
    }

    private loadRecentPublications(): void {
        this.publicationApi.list({ pageSize: 5, ordering: '-issued' }).pipe(
            takeUntilDestroyed(this.destroyRef)
        ).subscribe({
            next: response => this.recentPublications.set(response.results ?? []),
            error: () => this.recentPublications.set([])
        });
    }

    private evaluateProfileProgress(): void {
        if (!this.authState.isAuthenticated) {
            this.profileProgress.set(null);
            return;
        }
        this.researcherApi.getMe().pipe(
            catchError(error => {
                if (error?.status === 404) {
                    this.profileProgress.set({
                        slug: null,
                        verified: false,
                        missingTasks: ['Create your researcher profile']
                    });
                    return of(null);
                }
                this.profileProgress.set(null);
                return of(null);
            }),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(profile => {
            if (!profile) {
                return;
            }
            const missingTasks: string[] = [];
            if (!profile.institutional_email_verified) {
                missingTasks.push('Verify institutional email');
            }
            if (!profile.short_bio) {
                missingTasks.push('Add a short bio');
            }
            if (!profile.experiences.length) {
                missingTasks.push('Add professional experience');
            }
            if (!profile.publications.length) {
                missingTasks.push('Link publications');
            }
            this.profileProgress.set({
                slug: profile.slug,
                verified: profile.institutional_email_verified,
                missingTasks
            });
        });
    }

    private setupSearchPanel(): void {
        this.setupPublicationSearch();
        this.setupJournalSearch();
        this.setupResearcherSearch();
    }

    private setupPublicationSearch(): void {
        this.publicationSearchControl.valueChanges.pipe(
            debounceTime(250),
            map(value => value.trim()),
            distinctUntilChanged(),
            switchMap(query => {
                if (!query) {
                    this.publicationSearching.set(false);
                    return of<Publication[]>([]);
                }
                this.publicationSearching.set(true);
                return this.publicationApi.search(query, { page: 1, pageSize: 5 }).pipe(
                    map(response => response.results ?? []),
                    catchError(() => of<Publication[]>([]))
                );
            }),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(results => {
            this.publicationResults.set(results);
            this.publicationSearching.set(false);
        });
    }

    private setupJournalSearch(): void {
        this.journalSearchControl.valueChanges.pipe(
            debounceTime(250),
            map(value => value.trim()),
            distinctUntilChanged(),
            switchMap(query => {
                if (!query) {
                    this.journalSearching.set(false);
                    return of<Journal[]>([]);
                }
                this.journalSearching.set(true);
                return this.journalApi.list(1, query, 5).pipe(
                    map(response => response.results ?? []),
                    catchError(() => of<Journal[]>([]))
                );
            }),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(results => {
            this.journalResults.set(results);
            this.journalSearching.set(false);
        });
    }

    private setupResearcherSearch(): void {
        this.researcherSearchControl.valueChanges.pipe(
            debounceTime(250),
            map(value => value.trim()),
            distinctUntilChanged(),
            switchMap(query => {
                if (!query) {
                    this.researcherSearching.set(false);
                    return of<ResearcherProfile[]>([]);
                }
                this.researcherSearching.set(true);
                return this.researcherApi.list(1, query, 5).pipe(
                    map(response => response.results ?? []),
                    catchError(() => of<ResearcherProfile[]>([]))
                );
            }),
            takeUntilDestroyed(this.destroyRef)
        ).subscribe(results => {
            this.researcherResults.set(results);
            this.researcherSearching.set(false);
        });
    }

    private formatNumber(value: number): string {
        if (value >= 1000) {
            return `${Math.round(value / 100) / 10}k+`;
        }
        return value.toString();
    }

    private parseIssuedYear(issued?: string | null): number | string {
        if (!issued) {
            return '—';
        }
        const parsed = new Date(issued);
        const year = parsed.getFullYear();
        return Number.isFinite(year) ? year : '—';
    }

    private withMinimumResearchers(researchers: ResearcherProfile[]): ResearcherProfile[] {
        const padded = [...researchers];
        for (const placeholder of PLACEHOLDER_RESEARCHERS) {
            if (padded.length >= MINIMUM_VERIFIED_PROFILES) {
                break;
            }
            if (!padded.some(profile => profile.slug === placeholder.slug)) {
                padded.push(placeholder);
            }
        }
        return padded.slice(0, MINIMUM_VERIFIED_PROFILES);
    }
}
