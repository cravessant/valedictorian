import { buildRouteMap } from '@stricli/core';
import { makeCommand, optionFlags, optionValue, requiredOption, workspaceClient, writeJson, } from './valedictorian-cli.command-runtime.js';
import { parseStrictNumberOption } from './valedictorian-cli.parser-options.js';
export function buildScoresRoute() {
    return buildRouteMap({
        docs: { brief: 'Record application scores' },
        routes: {
            record: makeCommand({
                docs: { brief: 'Record an application score' },
                flags: {
                    ...optionFlags([], [
                        'score',
                        'band',
                        'role-relevance',
                        'career-signal',
                        'city-work-mode',
                        'compensation-logistics',
                        'rationale',
                    ]),
                    ...optionFlags(['rubric-version']),
                    ...optionFlags(['workspace']),
                },
                positionalCount: 1,
                run: async (context, flags, applicationId) => {
                    const client = await workspaceClient(context, flags);
                    const score = await client.scores.record({
                        applicationId,
                        score: parseStrictNumberOption(requiredOption(flags, 'score', '--score value'), '--score'),
                        band: requiredOption(flags, 'band', '--band value'),
                        roleRelevance: parseStrictNumberOption(requiredOption(flags, 'role-relevance', '--role-relevance value'), '--role-relevance'),
                        careerSignal: parseStrictNumberOption(requiredOption(flags, 'career-signal', '--career-signal value'), '--career-signal'),
                        cityWorkMode: parseStrictNumberOption(requiredOption(flags, 'city-work-mode', '--city-work-mode value'), '--city-work-mode'),
                        compensationLogistics: parseStrictNumberOption(requiredOption(flags, 'compensation-logistics', '--compensation-logistics value'), '--compensation-logistics'),
                        penalties: [],
                        rationale: requiredOption(flags, 'rationale', '--rationale value'),
                        rubricVersion: optionValue(flags, 'rubric-version') ?? 'valedictorian-cli',
                    });
                    writeJson(context, score, false);
                },
            }),
        },
    });
}
