export interface ResearcherJournalSummary {
    id: string;
    slug: string;
    name: string;
}

export interface ResearcherPublicationSummary {
    id: number;
    publication: {
        id: string;
        slug: string;
        title: string;
        issued?: string | null;
        journal?: ResearcherJournalSummary | null;
    };
    contribution?: string | null;
}

export interface ResearcherExperience {
    id: number;
    employer: string;
    role: string;
    start_date?: string | null;
    end_date?: string | null;
    is_current: boolean;
    description?: string | null;
    created_at: string;
    updated_at: string;
}

export interface ResearcherExperiencePayload {
    id?: number;
    employer: string;
    role: string;
    start_date?: string | null;
    end_date?: string | null;
    is_current?: boolean;
    description?: string | null;
}

export interface ResearcherPublicationLinkPayload {
    publication_id: string;
    contribution?: string | null;
}

export interface ResearcherProfile {
    id: string;
    slug: string;
    title?: string | null;
    display_name: string;
    full_name: string;
    institutional_email: string;
    institutional_email_verified: boolean;
    institutional_email_verified_at?: string | null;
    affiliation?: string | null;
    current_position?: string | null;
    short_bio?: string | null;
    research_interests?: string | null;
    google_scholar_url?: string | null;
    linkedin_url?: string | null;
    orcid?: string | null;
    personal_website?: string | null;
    profile_photo_url?: string | null;
    experiences: ResearcherExperience[];
    publications: ResearcherPublicationSummary[];
    created_at: string;
    updated_at: string;
}

export interface ResearcherProfilePayload {
    title?: string | null;
    display_name: string;
    institutional_email?: string;
    affiliation?: string | null;
    current_position?: string | null;
    short_bio?: string | null;
    research_interests?: string | null;
    google_scholar_url?: string | null;
    linkedin_url?: string | null;
    orcid?: string | null;
    personal_website?: string | null;
    experiences?: ResearcherExperiencePayload[];
    publications?: ResearcherPublicationLinkPayload[];
}

export interface InstitutionalEmailVerificationResponse {
    detail: string;
}
