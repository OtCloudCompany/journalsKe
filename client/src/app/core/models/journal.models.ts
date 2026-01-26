import { Publication } from './publication.models';

export interface Journal {
    id: string;
    name: string;
    slug: string;
    description: string;
    homepage_url: string;
    oai_url: string;
    last_harvested_at: string | null;
    chief_editor: string;
    publisher: string;
    issn_print: string;
    issn_online: string;
    language: string;
    country: string;
    founded_year: number | null;
    contact_email: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    publications?: Publication[];
}

export interface JournalPayload {
    name: string;
    description?: string;
    homepage_url?: string;
    oai_url?: string;
    chief_editor?: string;
    publisher?: string;
    issn_print?: string;
    issn_online?: string;
    language?: string;
    country?: string;
    founded_year?: number | null;
    contact_email?: string;
    is_active?: boolean;
}

export interface OAIValidationResponse {
    ok: boolean;
    detail: string;
}

