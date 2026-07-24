# Promotion Payloads

Read this when constructing strict `--input-json` for a lifecycle promotion. These examples match the alpha.18 / `@sparxie/sdk@0.29.1` surface. Replace values from inspected records; never invent facts, revisions, identities, or evaluation.

The source id is positional and must not appear in the JSON.

## Contents

- Capture to Job
- Job to Opportunity
- Opportunity to Application
- Overrides and duplicates

## Capture To Job

```json
{
  "idempotencyKey": "promote-capture-capture-1-r1",
  "actor": { "id": "agent-1", "type": "agent" },
  "captureRevision": 1,
  "selectedFacts": {
    "companyName": "Delta Labs",
    "roleTitle": "Platform Engineer",
    "sourceName": "Employer site",
    "roleKind": "experienced",
    "term": null,
    "terms": [],
    "timingMode": "unknown",
    "startDate": null,
    "endDate": null,
    "location": null,
    "workMode": "remote",
    "employmentType": "full_time",
    "seniority": "mid",
    "compensation": null,
    "postedAt": null,
    "destination": {
      "class": "employer_or_ats",
      "url": "https://jobs.example.com/role"
    }
  },
  "evidenceReferences": [
    {
      "captureId": "capture-1",
      "captureRevision": 1,
      "evidenceIndexes": [0]
    }
  ],
  "externalIdentities": []
}
```

```sh
valedictorian-cli --json captures promote-to-job capture-1 \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '<the JSON above>'
```

`captureRevision` and at least one evidence reference must identify the inspected evidence-bearing revision. Add external identities only when supported by normalized evidence; descriptive similarity is not identity.

Job facts contract values:

- `roleKind`: `co_op`, `entry_level`, `experienced`, `internship`, `new_grad`, `other`
- `timingMode`: `fixed`, `rolling`, `unknown`
- `workMode`: `hybrid`, `onsite`, `remote`, `unknown`
- `employmentType`: `contract`, `full_time`, `internship`, `part_time`, `temporary`, `unknown`
- `seniority`: `entry`, `lead`, `mid`, `senior`, `student`, `unknown`
- `destination.class`: `employer_or_ats` or `third_party_job_posting`

Dates use ISO `YYYY-MM-DD`. `location`, `compensation`, `postedAt`, and `destination` may be `null`; the other shown keys remain required. If the inspected Capture/retrieval result does not support required company, role, source, or enum facts, stop and report that the CLI cannot form a valid promotion payload. Do not fill evidence gaps with favorable or placeholder facts.

## Job To Opportunity

```json
{
  "idempotencyKey": "promote-job-018f0f2e-r1",
  "actor": { "id": "agent-1", "type": "agent" },
  "expectedFactsRevision": 1,
  "evaluation": {
    "fit": "fit",
    "rank": 1,
    "cutoff": "above",
    "disposition": "pursue"
  }
}
```

```sh
valedictorian-cli --json jobs promote-to-opportunity <job-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '<the JSON above>'
```

Evaluation contract values:

- `fit`: `fit`, `possible`, `not_fit`, `unknown`
- `rank`: number or `null`
- `cutoff`: `above`, `below`, `not_evaluated`
- `disposition`: `reviewing`, `pursue`, `hold`, `declined`, `archived`

Use the inspected/workspace evaluation; do not choose favorable values merely to advance.

## Opportunity To Application

```json
{
  "idempotencyKey": "promote-opportunity-opportunity-1",
  "actor": { "id": "agent-1", "type": "agent" },
  "expectedJobId": "018f0f2e-7b16-7a01-8c8c-20c6a9d52301",
  "initialLinks": [
    {
      "kind": "official",
      "label": "Apply",
      "url": "https://jobs.example.com/role"
    }
  ]
}
```

```sh
valedictorian-cli --json opportunities promote-to-application <opportunity-id> \
  --workspace "$VALEDICTORIAN_WORKSPACE" \
  --input-json '<the JSON above>'
```

Use the Opportunity's actual `jobId` and verified initial links. After promotion, verify both lineage ids and the frozen snapshot's Job facts revision/initial links.

`initialLinks` is optional and may be omitted when no verified link exists. Each supplied link uses bounded non-empty `kind`/`label` strings and a valid URL; `kind` is not a closed enum. Use `official` only for an employer/ATS-owned application destination, not merely because a link is convenient.

## Overrides And Duplicates

Prefer explicit flags for a decision made after the initial payload:

```sh
--override-actor-id <id> \
--override-actor-type user \
--override-rationale "Reviewed the returned warnings." \
--override-warning-codes-json '["fit","cutoff"]'
```

Supply only warning codes present in the result. A display name is optional; the actor id/type, rationale, and warning-code array are a complete set.

For a deterministic duplicate:

```sh
--duplicate-action attach --duplicate-target-id <conflicting-resource-id>
```

Use `attach` or `merge` only after inspecting that exact target and obtaining the required decision. If the judgment changes, use a new idempotency key.
