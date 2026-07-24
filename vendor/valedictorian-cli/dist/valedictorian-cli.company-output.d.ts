export type CompanyCollectionOutput = 'assigned-jobs' | 'directory' | 'duplicates' | 'history' | 'match-preview';
export declare function formatCompanyHumanOutput(record: Record<string, unknown>, collectionOutput?: CompanyCollectionOutput): string | null;
