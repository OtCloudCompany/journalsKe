import { PaginatedResponse } from './pagination.models';

export interface PublicationMetadataEntry {
    id: number;
    schema: string;
    element: string;
    qualifier: string | null;
    value: string;
    language: string | null;
    position: number;
}

export interface Publication {
    id: string;
    title: string;
    slug: string;
    description: string;
    publisher: string;
    publisher_url?: string;
    issued: string | null;
    resource_type: string;
    resource_format: string;
    rights: string;
    journal?: { id: string; slug: string; name: string } | null;
    oai_identifier?: string | null;
    oai_datestamp?: string | null;
    metadata: PublicationMetadataEntry[];
    created_at: string;
    updated_at: string;
}

export interface PublicationMetadataPayload {
    schema?: string;
    element: string;
    qualifier?: string | null;
    value: string;
    language?: string | null;
    position?: number;
}

export interface PublicationPayload {
    title: string;
    description?: string;
    publisher?: string;
    issued?: string | null;
    resource_type?: string;
    resource_format?: string;
    rights?: string;
    metadata?: PublicationMetadataPayload[];
}

export interface FacetItem {
    value: string;
    label: string;
    count: number;
    active: boolean;
}

export interface FacetSummary {
    param: string;
    total: number;
    more_url?: string | null;
    items: FacetItem[];
}

export interface PublicationFacetCollection {
    authors: FacetSummary;
    subjects: FacetSummary;
    journals: FacetSummary;
    issued_years: FacetSummary;
}

export interface PublicationListResponse extends PaginatedResponse<Publication> {
    facets: PublicationFacetCollection;
}

export interface FacetListResponse {
    count: number;
    page: number;
    page_size: number;
    total_pages: number;
    next: string | null;
    previous: string | null;
    param: string;
    results: FacetItem[];
}
