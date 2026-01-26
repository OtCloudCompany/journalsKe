import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgFor, NgIf } from '@angular/common';

import { PublicationApiService } from '../../../core/services/publication-api.service';
import { Publication, PublicationMetadataEntry, PublicationMetadataPayload, PublicationPayload } from '../../../core/models/publication.models';

type MetadataFormGroup = FormGroup<{
    schema: FormControl<string>;
    element: FormControl<string>;
    qualifier: FormControl<string>;
    language: FormControl<string>;
    value: FormControl<string>;
}>;

interface MetadataPreset {
    label: string;
    schema: string;
    element: string;
    qualifier?: string;
}

type CoreFieldKey = 'title' | 'description' | 'publisher' | 'resource_type' | 'resource_format' | 'rights' | 'issued';

interface CoreFieldControlConfig {
    schemaControl: string;
    elementControl: string;
    qualifierControl?: string;
    languageControl?: string;
}

interface CoreFieldDefaults {
    schema: string;
    element: string;
    qualifier: string;
}

@Component({
    selector: 'app-publication-form',
    standalone: true,
    imports: [ReactiveFormsModule, RouterLink, NgIf, NgFor],
    templateUrl: './publication-form.component.html',
    styleUrl: './publication-form.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PublicationFormComponent implements OnInit {
    private readonly formBuilder = inject(FormBuilder);
    private readonly publicationApi = inject(PublicationApiService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);

    private readonly defaultSchema = 'dc';
    readonly metadataPresets: MetadataPreset[] = [
        { label: 'Creator', schema: 'dc', element: 'creator' },
        { label: 'Contributor (Advisor)', schema: 'dc', element: 'contributor', qualifier: 'advisor' },
        { label: 'Contributor (Author)', schema: 'dc', element: 'contributor', qualifier: 'author' },
        { label: 'Subject', schema: 'dc', element: 'subject' },
        { label: 'Identifier (URI)', schema: 'dc', element: 'identifier', qualifier: 'uri' },
        { label: 'Identifier (ISSN)', schema: 'dc', element: 'identifier', qualifier: 'issn' },
        { label: 'Language', schema: 'dc', element: 'language' },
        { label: 'Relation', schema: 'dc', element: 'relation' },
    ];

    private readonly coreControlMap: Record<CoreFieldKey, CoreFieldControlConfig> = {
        title: {
            schemaControl: 'title_schema',
            elementControl: 'title_element',
            qualifierControl: 'title_qualifier'
        },
        description: {
            schemaControl: 'description_schema',
            elementControl: 'description_element',
            qualifierControl: 'description_qualifier'
        },
        publisher: {
            schemaControl: 'publisher_schema',
            elementControl: 'publisher_element',
            qualifierControl: 'publisher_qualifier'
        },
        resource_type: {
            schemaControl: 'resource_type_schema',
            elementControl: 'resource_type_element',
            qualifierControl: 'resource_type_qualifier'
        },
        resource_format: {
            schemaControl: 'resource_format_schema',
            elementControl: 'resource_format_element',
            qualifierControl: 'resource_format_qualifier'
        },
        rights: {
            schemaControl: 'rights_schema',
            elementControl: 'rights_element',
            qualifierControl: 'rights_qualifier'
        },
        issued: {
            schemaControl: 'issued_schema',
            elementControl: 'issued_element',
            qualifierControl: 'issued_qualifier'
        }
    };

    readonly submitting = signal(false);
    readonly errorMessage = signal<string | null>(null);
    readonly successMessage = signal<string | null>(null);
    readonly isEditMode = signal(false);
    readonly loadedPublication = signal<Publication | null>(null);

    readonly form = this.formBuilder.nonNullable.group({
        title: ['', [Validators.required, Validators.minLength(3)]],
        title_schema: [this.defaultSchema, [Validators.required]],
        title_element: ['title', [Validators.required]],
        title_qualifier: [''],
        description: [''],
        description_schema: [this.defaultSchema, [Validators.required]],
        description_element: ['description', [Validators.required]],
        description_qualifier: [''],
        publisher: [''],
        publisher_schema: [this.defaultSchema, [Validators.required]],
        publisher_element: ['publisher', [Validators.required]],
        publisher_qualifier: [''],
        issued: [''],
        issued_schema: [this.defaultSchema, [Validators.required]],
        issued_element: ['date', [Validators.required]],
        issued_qualifier: ['issued'],
        resource_type: [''],
        resource_type_schema: [this.defaultSchema, [Validators.required]],
        resource_type_element: ['type', [Validators.required]],
        resource_type_qualifier: [''],
        resource_format: [''],
        resource_format_schema: [this.defaultSchema, [Validators.required]],
        resource_format_element: ['format', [Validators.required]],
        resource_format_qualifier: [''],
        rights: [''],
        rights_schema: [this.defaultSchema, [Validators.required]],
        rights_element: ['rights', [Validators.required]],
        rights_qualifier: [''],
        metadata: this.formBuilder.array<MetadataFormGroup>([]),
    });

    private getCoreDefaults(field: CoreFieldKey): CoreFieldDefaults {
        switch (field) {
            case 'title':
                return { schema: this.defaultSchema, element: 'title', qualifier: '' };
            case 'description':
                return { schema: this.defaultSchema, element: 'description', qualifier: '' };
            case 'publisher':
                return { schema: this.defaultSchema, element: 'publisher', qualifier: '' };
            case 'resource_type':
                return { schema: this.defaultSchema, element: 'type', qualifier: '' };
            case 'resource_format':
                return { schema: this.defaultSchema, element: 'format', qualifier: '' };
            case 'rights':
                return { schema: this.defaultSchema, element: 'rights', qualifier: '' };
            case 'issued':
                return { schema: this.defaultSchema, element: 'date', qualifier: 'issued' };
            default:
                return { schema: this.defaultSchema, element: '', qualifier: '' };
        }
    }

    private getTextControl(controlName: string): FormControl<string> {
        return this.form.controls[controlName as keyof typeof this.form.controls] as FormControl<string>;
    }

    private getTrimmedControlValue(controlName: string): string {
        const control = this.getTextControl(controlName);
        const value = control.value ?? '';
        return value.trim();
    }

    private normalizeValue(value: string | null | undefined): string {
        return (value ?? '').trim().toLowerCase();
    }

    private extractCoreEntry(
        entries: PublicationMetadataEntry[],
        targetValue: string | null | undefined,
        defaults: CoreFieldDefaults,
    ): PublicationMetadataEntry | undefined {
        const normalizedTarget = this.normalizeValue(targetValue ?? '');
        let index = -1;

        if (normalizedTarget) {
            index = entries.findIndex((entry) => this.normalizeValue(entry.value) === normalizedTarget);
        }

        if (index < 0) {
            index = entries.findIndex((entry) =>
                this.normalizeValue(entry.schema) === this.normalizeValue(defaults.schema) &&
                this.normalizeValue(entry.element) === this.normalizeValue(defaults.element) &&
                this.normalizeValue(entry.qualifier ?? '') === this.normalizeValue(defaults.qualifier)
            );
        }

        if (index >= 0) {
            return entries.splice(index, 1)[0];
        }
        return undefined;
    }

    private applyCoreMetadataControls(field: CoreFieldKey, entry?: PublicationMetadataEntry | null): void {
        const config = this.coreControlMap[field];
        const defaults = this.getCoreDefaults(field);

        const schemaControl = this.getTextControl(config.schemaControl);
        schemaControl.setValue(entry?.schema ?? defaults.schema);

        const elementControl = this.getTextControl(config.elementControl);
        elementControl.setValue(entry?.element ?? defaults.element);

        const qualifierControlName = config.qualifierControl;
        if (qualifierControlName) {
            const qualifierControl = this.getTextControl(qualifierControlName);
            const qualifierValue = entry?.qualifier ?? defaults.qualifier ?? '';
            qualifierControl.setValue(qualifierValue ?? '');
        }

        const languageControlName = config.languageControl;
        if (languageControlName) {
            const languageControl = this.getTextControl(languageControlName);
            languageControl.setValue(entry?.language ?? '');
        }
    }

    ngOnInit(): void {
        const slug = this.route.snapshot.paramMap.get('slug');
        if (slug) {
            this.isEditMode.set(true);
            this.loadPublication(slug);
        }
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
        const slug = this.loadedPublication()?.slug;

        const request$ = slug
            ? this.publicationApi.update(slug, payload)
            : this.publicationApi.create(payload);

        request$.subscribe({
            next: (publication) => {
                this.submitting.set(false);
                this.successMessage.set(slug ? 'Publication updated successfully.' : 'Publication created successfully.');
                this.loadedPublication.set(publication);
                if (!slug) {
                    this.isEditMode.set(true);
                    this.patchForm(publication);
                }
                void this.router.navigate(['/publications', publication.slug]);
            },
            error: (err) => {
                this.submitting.set(false);
                const detail = err?.error?.detail ?? 'Unable to save publication.';
                this.errorMessage.set(detail);
            }
        });
    }

    cancel(): void {
        const publication = this.loadedPublication();
        void this.router.navigate(publication ? ['/publications', publication.slug] : ['/publications']);
    }

    private loadPublication(slug: string): void {
        this.submitting.set(true);
        this.publicationApi.retrieve(slug).subscribe({
            next: (publication) => {
                this.submitting.set(false);
                this.loadedPublication.set(publication);
                this.patchForm(publication);
            },
            error: (err) => {
                this.submitting.set(false);
                const detail = err?.error?.detail ?? 'Unable to load publication.';
                this.errorMessage.set(detail);
            }
        });
    }

    private patchForm(publication: Publication): void {
        const metadataEntries = [...(publication.metadata ?? [])];

        const titleEntry = this.extractCoreEntry(metadataEntries, publication.title, this.getCoreDefaults('title'));
        const titleValue = titleEntry?.value ?? publication.title;
        this.form.controls.title.setValue(titleValue);
        this.applyCoreMetadataControls('title', titleEntry);

        const descriptionEntry = this.extractCoreEntry(metadataEntries, publication.description, this.getCoreDefaults('description'));
        const descriptionValue = descriptionEntry?.value ?? publication.description;
        this.form.controls.description.setValue(descriptionValue);
        this.applyCoreMetadataControls('description', descriptionEntry);

        const publisherEntry = this.extractCoreEntry(metadataEntries, publication.publisher, this.getCoreDefaults('publisher'));
        const publisherValue = publisherEntry?.value ?? publication.publisher;
        this.form.controls.publisher.setValue(publisherValue);
        this.applyCoreMetadataControls('publisher', publisherEntry);

        const resourceTypeEntry = this.extractCoreEntry(metadataEntries, publication.resource_type, this.getCoreDefaults('resource_type'));
        const resourceTypeValue = resourceTypeEntry?.value ?? publication.resource_type;
        this.form.controls.resource_type.setValue(resourceTypeValue);
        this.applyCoreMetadataControls('resource_type', resourceTypeEntry);

        const resourceFormatEntry = this.extractCoreEntry(metadataEntries, publication.resource_format, this.getCoreDefaults('resource_format'));
        const resourceFormatValue = resourceFormatEntry?.value ?? publication.resource_format;
        this.form.controls.resource_format.setValue(resourceFormatValue);
        this.applyCoreMetadataControls('resource_format', resourceFormatEntry);

        const rightsEntry = this.extractCoreEntry(metadataEntries, publication.rights, this.getCoreDefaults('rights'));
        const rightsValue = rightsEntry?.value ?? publication.rights;
        this.form.controls.rights.setValue(rightsValue);
        this.applyCoreMetadataControls('rights', rightsEntry);

        const issuedEntry = this.extractCoreEntry(metadataEntries, publication.issued, this.getCoreDefaults('issued'));
        const issuedRaw = issuedEntry?.value ?? publication.issued ?? '';
        const issuedValue = issuedRaw.includes('T') ? issuedRaw.split('T')[0] : issuedRaw;
        this.form.controls.issued.setValue(issuedValue);
        this.applyCoreMetadataControls('issued', issuedEntry);

        this.setMetadataEntries(metadataEntries);
    }

    private buildPayload(): PublicationPayload {
        const raw = this.form.getRawValue();
        const payload: PublicationPayload = {
            title: raw.title.trim(),
            description: raw.description?.trim() || '',
            publisher: raw.publisher?.trim() || '',
            resource_type: raw.resource_type?.trim() || '',
            resource_format: raw.resource_format?.trim() || '',
            rights: raw.rights?.trim() || ''
        };

        const issuedValue = raw.issued?.trim();
        payload.issued = issuedValue ? issuedValue : null;

        const metadataEntries = this.metadataArray().controls
            .map((group) => {
                const { schema, element, qualifier, language, value } = group.getRawValue();
                const trimmedValue = value.trim();
                const trimmedElement = element.trim();
                if (!trimmedValue || !trimmedElement) {
                    return null;
                }

                const trimmedSchema = ((schema || this.defaultSchema).trim() || this.defaultSchema).toLowerCase();
                const sanitized: PublicationMetadataPayload = {
                    schema: trimmedSchema,
                    element: trimmedElement.toLowerCase(),
                    value: trimmedValue,
                };

                const trimmedQualifier = qualifier.trim();
                if (trimmedQualifier) {
                    sanitized.qualifier = trimmedQualifier.toLowerCase();
                }

                const trimmedLanguage = language.trim();
                if (trimmedLanguage) {
                    sanitized.language = trimmedLanguage.toLowerCase();
                }

                return sanitized;
            })
            .filter((entry): entry is PublicationMetadataPayload => Boolean(entry));

        const coreEntries: PublicationMetadataPayload[] = [];
        const addCoreEntryFromControls = (field: CoreFieldKey, value: string | null | undefined) => {
            const trimmedValue = (value ?? '').trim();
            if (!trimmedValue) {
                return;
            }

            const config = this.coreControlMap[field];
            const defaults = this.getCoreDefaults(field);
            const schemaValue = this.getTrimmedControlValue(config.schemaControl) || defaults.schema;
            const elementValue = this.getTrimmedControlValue(config.elementControl) || defaults.element;

            if (!elementValue) {
                return;
            }

            const entry: PublicationMetadataPayload = {
                schema: (schemaValue || this.defaultSchema).toLowerCase(),
                element: elementValue.toLowerCase(),
                value: trimmedValue,
            };

            const qualifierControlName = config.qualifierControl;
            let qualifierValue = qualifierControlName ? this.getTrimmedControlValue(qualifierControlName) : '';
            if (!qualifierValue && defaults.qualifier) {
                qualifierValue = defaults.qualifier;
            }
            if (qualifierValue) {
                entry.qualifier = qualifierValue.toLowerCase();
            }

            const languageControlName = config.languageControl;
            if (languageControlName) {
                const languageValue = this.getTrimmedControlValue(languageControlName);
                if (languageValue) {
                    entry.language = languageValue.toLowerCase();
                }
            }

            coreEntries.push(entry);
        };

        addCoreEntryFromControls('title', payload.title);
        addCoreEntryFromControls('description', payload.description);
        addCoreEntryFromControls('publisher', payload.publisher);
        addCoreEntryFromControls('resource_type', payload.resource_type);
        addCoreEntryFromControls('resource_format', payload.resource_format);
        addCoreEntryFromControls('rights', payload.rights);
        addCoreEntryFromControls('issued', payload.issued);

        const combinedEntries = [...coreEntries, ...metadataEntries]
            .map((entry, index) => ({
                schema: (entry.schema || this.defaultSchema).toLowerCase(),
                element: (entry.element || '').toLowerCase(),
                qualifier: entry.qualifier ? entry.qualifier.toLowerCase() : undefined,
                value: entry.value,
                language: entry.language ? entry.language.toLowerCase() : undefined,
                position: index,
            }));

        payload.metadata = combinedEntries;

        return payload;
    }

    protected metadataArray(): FormArray<MetadataFormGroup> {
        return this.form.controls.metadata as FormArray<MetadataFormGroup>;
    }

    protected addMetadataEntry(preset?: Partial<PublicationMetadataPayload | PublicationMetadataEntry>): void {
        const array = this.metadataArray();
        const group = this.createMetadataGroup(preset);
        array.insert(0, group);
    }

    protected removeMetadataEntry(index: number): void {
        const array = this.metadataArray();
        if (index < 0 || index >= array.length) {
            return;
        }
        array.removeAt(index);
    }

    protected applyPreset(preset: MetadataPreset): void {
        this.addMetadataEntry({
            schema: preset.schema,
            element: preset.element,
            qualifier: preset.qualifier ?? '',
        });
    }

    private createMetadataGroup(entry?: Partial<PublicationMetadataEntry | PublicationMetadataPayload>): MetadataFormGroup {
        return this.formBuilder.nonNullable.group({
            schema: [entry?.schema ?? this.defaultSchema, [Validators.required]],
            element: [entry?.element ?? '', [Validators.required]],
            qualifier: [entry?.qualifier ?? ''],
            language: [entry?.language ?? ''],
            value: [entry?.value ?? '', [Validators.required]],
        });
    }

    private setMetadataEntries(entries: PublicationMetadataEntry[]): void {
        const array = this.metadataArray();
        while (array.length > 0) {
            array.removeAt(0);
        }
        if (!entries || entries.length === 0) {
            return;
        }
        [...entries]
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .forEach(entry => array.push(this.createMetadataGroup(entry)));
    }
}
