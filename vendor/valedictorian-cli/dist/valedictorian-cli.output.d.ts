import { type CompanyCollectionOutput } from './valedictorian-cli.company-output.js';
export type HumanOutputOptions = {
    companyCollection?: CompanyCollectionOutput;
};
export declare function formatHumanOutput(value: unknown, options?: HumanOutputOptions): string;
