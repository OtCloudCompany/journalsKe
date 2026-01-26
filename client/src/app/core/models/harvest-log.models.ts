export type HarvestStatus = 'running' | 'success' | 'failed';

export interface HarvestLogJournalSummary {
    id: string;
    slug: string;
    name: string;
}

export interface HarvestLog {
    id: number;
    journal: HarvestLogJournalSummary | null;
    started_at: string;
    finished_at: string | null;
    endpoint: string;
    status: HarvestStatus;
    record_count: number;
    error_message: string;
}
