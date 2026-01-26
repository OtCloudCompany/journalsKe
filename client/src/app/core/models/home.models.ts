export interface HomeMetrics {
    verifiedResearchers: number;
    newVerifiedLast30Days: number;
    totalPublications: number;
    publicationsAddedLast30Days: number;
    totalJournals: number;
    activeJournals: number;
}

export interface HomeSummaryResponse {
    metrics: {
        verified_researchers: number;
        new_verified_last_30_days: number;
        total_publications: number;
        publications_added_last_30_days: number;
        total_journals: number;
        active_journals: number;
    };
}
