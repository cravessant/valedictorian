---
name: valedictorian-application-agent
description: Operate browser-based job application work from a canonical Valedictorian Application using the CLI for reads, run-based audit, and pursuit-status updates. Use when Codex must work an Action Queue item, inspect application lineage, fill an external ATS form, upload explicitly approved materials, answer screening questions, pause on blockers, capture a pre-submit verification receipt, or record a confirmed submission. Depends on valedictorian-cli and browser automation; treats technical attempts/events as read-only.
---

# Valedictorian Application Agent

Use this skill as the browser-operator protocol for an existing canonical Application. Before any Valedictorian read or mutation, load and follow the `valedictorian-cli` skill.

## Current Capability Boundary

- Use `applications attempts list` and `applications events list` only as diagnostics. The current CLI cannot start, step, or complete those records.
- Use `runs start|step|complete --run-type application_attempt` for agent-owned audit.
- Use `applications update-status` only for canonical pursuit states: `active`, `submitted`, `interviewing`, `offered`, `withdrawn`, `rejected`, or `accepted`.
- The CLI cannot persist Action Queue operational holds such as `ready_for_review` or `needs_user_info`, inspect auto-submit policy, or select a resume. Record blockers in the run and report this limitation.
- Require an explicitly approved resume/material path and explicit user approval before final submission. Do not infer either from absent CLI state.

If the requested outcome cannot be represented through this surface, stop and report the missing capability instead of bypassing the CLI.

## Operating Contract

- Require an explicit workspace and inspect the sanitized API target before mutation.
- Start from an Application, not directly from a Capture, Job, or Opportunity. Verify its Job and Opportunity lineage when identity is unclear.
- Use browser automation for the external employer/job-board/ATS site. The Valedictorian app is the human cockpit, not the agent state interface.
- Work one Application and one workflow run at a time unless the user explicitly asks for parallel work.
- Resume an existing in-progress run when it matches the Application; do not create duplicate audit runs for convenience.
- Keep credentials, SSN, and sensitive values out of chat, logs, run notes, screenshots, argv, and temp files.

## Reference Map

- Read `references/receipts-and-audit.md` before starting, resuming, stepping, or completing application work.
- Read `references/browser-application-playbooks.md` before opening the external application site.
- Read `references/materials-and-profile.md` before selecting resumes, cover letters, transcripts, profile facts, or credentials.
- Read `references/screening-answers.md` before answering eligibility, work authorization, salary, EEO, consent, or free-response questions.
- Read `references/escalation-policy.md` whenever a question, site behavior, material choice, or final-submit decision could require user approval.

## Core Loop

1. Confirm workspace/API target and inspect the Action Queue or requested Application.
2. Read Application, Application history, technical attempts/events, matching runs, profile agent context, and secret summaries.
3. Confirm the official posting/application URL, approved materials, and explicit submit authority.
4. Resume a matching run or start `application_attempt`; technical attempt/event records remain read-only.
5. Open the external site and fill it only from approved Valedictorian state, selected materials, and user instructions.
6. Verify persisted values page by page and record durable milestones with `runs step`.
7. On a blocker or missing fact, record a run step, complete the run without `--outcome`, store the classification in `--blocker`/bounded metadata, and report that the Action Queue hold was not updated.
8. After final review and before Submit, record a passed `verification_receipt` run step.
9. Submit only with explicit approval. Do not rely on unavailable CLI policy state.
10. After confirmation, record `submitted` and `confirmation_verified` run steps, update the Application status to `submitted` with current revision and rationale, and complete the run with outcome `submitted`.
11. Re-read the Application, history, and run. Summarize Application id, run id, canonical status, confirmation evidence, and any projection the CLI could not update.

## Decision Gates

Pause before continuing when:

- A required fact is absent or sources disagree.
- Resume/material selection or final-submit authority is not explicit.
- The site asks for MFA, CAPTCHA, identity verification, security challenge, payment, assessment, legal attestation, background-check authorization, or account recovery.
- Salary, relocation, travel, start date, work authorization, sponsorship, clearance, export-control, EEO, veteran, disability, or accommodation answers lack approved facts.
- The posting is suspicious, closed, duplicate, unofficial, pay-to-apply, or tied to the wrong Job/Application.
- The final review has blank, stale, parser-damaged, unsupported, or unverified material fields.

## Run Classifications

Use run steps plus `--blocker`/bounded metadata for operational classifications such as `ready_for_review`, `needs_user_info`, `manual_captcha`, `security_gate`, `login_needed`, `platform_error`, `closed`, `not_fit`, `not_pursued`, or `already_applied`. Do not send those values as Application status or run `--outcome`.

Only use run `--outcome submitted` after verified submission. For an exact already-applied portal state, update the canonical Application to `submitted` only when evidence proves the same posting was previously submitted; preserve `already_applied` in run metadata.

## Final Submit Guard

Before recording the receipt and clicking Submit:

- Verify employer, role, Application/Job lineage, official URL, and account identity.
- Verify the explicitly approved resume and every other upload.
- Verify identity, contact, education, work history, websites, skills, authorization, sponsorship, compensation, screening answers, and required consents.
- Verify sensitive disclosures follow explicit instructions.
- Verify there are no visible errors, stale parser values, disabled controls, or unresolved material blanks.

Record the passed `verification_receipt` on the workflow run after this review and before submission. A click is not proof of submission; require confirmation evidence.
