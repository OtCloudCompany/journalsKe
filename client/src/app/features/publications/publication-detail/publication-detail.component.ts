import { NgClass, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { AuthStateService } from '../../../core/services/auth-state.service';
import { PublicationApiService } from '../../../core/services/publication-api.service';
import { Publication, PublicationMetadataEntry } from '../../../core/models/publication.models';

@Component({
    selector: 'app-publication-detail',
    standalone: true,
    imports: [RouterLink, DatePipe, NgClass],
    templateUrl: './publication-detail.component.html',
    styleUrl: './publication-detail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PublicationDetailComponent implements OnInit {
    private readonly publicationApi = inject(PublicationApiService);
    private readonly authState = inject(AuthStateService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly platformId = inject(PLATFORM_ID);

    private readonly coreMetadataMatchers: Array<{ schema: string; element: string; qualifier?: string | null }> = [
        { schema: 'dc', element: 'title', qualifier: null },
        { schema: 'dc', element: 'description', qualifier: null },
        { schema: 'dc', element: 'publisher', qualifier: null },
        { schema: 'dc', element: 'type', qualifier: null },
        { schema: 'dc', element: 'format', qualifier: null },
        { schema: 'dc', element: 'rights', qualifier: null },
        { schema: 'dc', element: 'date', qualifier: 'issued' },
    ];

    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly publication = signal<Publication | null>(null);

    readonly canManage = computed(() => this.authState.isAuthenticated);
    readonly isBrowser = isPlatformBrowser(this.platformId);

    protected joinList(values: string[] | null | undefined): string {
        if (!values || values.length === 0) {
            return '';
        }
        return values.join(', ');
    }

    protected metadataValues(element: string, qualifier?: string | null): string[] {
        const publication = this.publication();
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

    protected parseIdentifiers(values: string[]): Array<{ type: 'doi' | 'url' | 'text'; value: string; label: string }> {
        const result: Array<{ type: 'doi' | 'url' | 'text'; value: string; label: string }> = [];

        for (const rawValue of values) {
            if (!rawValue) continue;

            // Handle comma-separated values
            const parts = rawValue.split(',').map(p => p.trim()).filter(Boolean);

            for (const part of parts) {
                if (part.startsWith('http')) {
                    result.push({
                        type: 'url',
                        value: part,
                        label: part
                    });
                } else if (part.startsWith('10.')) {
                    result.push({
                        type: 'doi',
                        value: `https://doi.org/${part}`,
                        label: `DOI: ${part}`
                    });
                } else {
                    result.push({
                        type: 'text',
                        value: part,
                        label: part
                    });
                }
            }
        }
        return result;
    }

    protected metadataGroups(): Array<{ label: string; values: string[] }> {
        const publication = this.publication();
        if (!publication?.metadata || publication.metadata.length === 0) {
            return [];
        }

        const groups = new Map<string, { label: string; values: string[] }>();

        for (const entry of publication.metadata) {
            if ((entry.schema || 'dc').toLowerCase() !== 'dc') {
                continue;
            }
            if (this.isCoreMetadata(entry)) {
                continue;
            }
            const elementLabel = this.formatElementLabel(entry.element);
            const qualifierLabel = (entry.qualifier ?? '').trim();
            const qualifierDisplay = qualifierLabel ? this.formatElementLabel(qualifierLabel) : '';
            const key = `${entry.element.toLowerCase()}|${qualifierLabel.toLowerCase()}`;
            const label = qualifierDisplay ? `${elementLabel} (${qualifierDisplay})` : elementLabel;
            const value = entry.value?.trim();
            if (!value) {
                continue;
            }
            const existing = groups.get(key);
            if (existing) {
                existing.values.push(value);
            } else {
                groups.set(key, { label, values: [value] });
            }
        }

        return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    }

    private isCoreMetadata(entry: PublicationMetadataEntry): boolean {
        const schema = (entry.schema || '').toLowerCase();
        const element = (entry.element || '').toLowerCase();
        const qualifier = (entry.qualifier || '').toLowerCase();
        return this.coreMetadataMatchers.some((matcher) => {
            if (schema !== matcher.schema) {
                return false;
            }
            if (element !== matcher.element) {
                return false;
            }
            const expectedQualifier = (matcher.qualifier || '').toLowerCase();
            return qualifier === expectedQualifier;
        });
    }

    private formatElementLabel(element: string): string {
        if (!element) {
            return '';
        }
        return element
            .split(/[_\-\s]+/)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(' ');
    }

    ngOnInit(): void {
        const slug = this.route.snapshot.paramMap.get('slug');
        if (!slug) {
            this.error.set('Publication not found.');
            return;
        }
        this.fetchPublication(slug);
    }

    fetchPublication(slug: string): void {
        this.loading.set(true);
        this.error.set(null);
        this.publicationApi.retrieve(slug).subscribe({
            next: (data) => {
                this.loading.set(false);
                this.publication.set(data);
            },
            error: (err) => {
                this.loading.set(false);
                const detail = err?.error?.detail ?? 'Unable to load publication.';
                this.error.set(detail);
            }
        });
    }

    goToEdit(): void {
        const slug = this.publication()?.slug;
        if (!slug) {
            return;
        }
        void this.router.navigate(['/publications', slug, 'edit']);
    }

    deletePublication(): void {
        if (!this.isBrowser) {
            return;
        }
        const publication = this.publication();
        if (!publication) {
            return;
        }
        if (!window.confirm(`Delete "${publication.title}"? This cannot be undone.`)) {
            return;
        }
        this.loading.set(true);
        this.publicationApi.delete(publication.slug).subscribe({
            next: () => {
                this.loading.set(false);
                void this.router.navigate(['/publications'], { replaceUrl: true });
            },
            error: (err) => {
                this.loading.set(false);
                const detail = err?.error?.detail ?? 'Unable to delete publication.';
                this.error.set(detail);
            }
        });
    }
}
