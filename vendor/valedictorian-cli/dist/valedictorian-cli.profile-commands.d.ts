import { type ProfileDocument } from '@sparxie/sdk';
import { type ValedictorianCliContext } from './valedictorian-cli.command-runtime.js';
export declare function buildProfileRoute(): import("@stricli/core").RouteMap<ValedictorianCliContext>;
export declare function formatProfileDocumentHuman(document: ProfileDocument): string;
