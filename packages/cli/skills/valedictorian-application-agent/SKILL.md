---
name: valedictorian-application-agent
description: Operate end-to-end Valedictorian job application attempts. Use when Codex needs to work an Action Queue item, start or resume an application attempt, fill external ATS/job-site forms, upload prepared materials, answer screening questions, handle blockers, capture submission receipts, or update attempt/run/application outcomes using explicit Valedictorian workspace state plus browser automation. Depends on valedictorian-cli for state access; forbids direct database writes.
---

# Valedictorian Application Agent

Use this skill as the application operator protocol: it tells the agent how to behave while applying to a job. It does not replace `valedictorian-cli`. Before any Valedictorian read or mutation, load and follow the `valedictorian-cli` skill.

## Operating Contract

- Require an explicit workspace. If the workspace is unknown, resolve it through `valedictorian-cli` before selecting work.
- Use Valedictorian CLI/API state for applications, attempts, runs, profiles, answer context, materials, and outcomes.
- Do not write directly to SQLite/Postgres, call ad hoc HTTP endpoints, or reimplement client logic.
- Use browser automation for external employer/job-board/ATS sites. Do not use the Valedictorian app UI as the primary agent state interface; the app is the human cockpit.
- Work one application attempt at a time unless the user explicitly asks for parallel application work.
- Check for existing in-progress attempts or runs before opening a browser or starting a new attempt.
- Keep credential values and sensitive profile values out of chat, logs, shell history, run notes, screenshots, and temp files.
- If the CLI cannot express a needed operation, stop and report the missing CLI/API capability instead of bypassing the contract.

## Reference Map

- Read `references/receipts-and-audit.md` before starting, resuming, stepping, or completing attempts/runs.
- Read `references/browser-application-playbooks.md` before opening the external application site.
- Read `references/materials-and-profile.md` before choosing resumes, cover letters, transcripts, profile facts, sensitive facts, or credential summaries.
- Read `references/screening-answers.md` before answering eligibility, work authorization, salary, EEO, consent, or free-response questions.
- Read `references/escalation-policy.md` whenever a question, site behavior, or final-submit decision could require user approval.

## Core Loop

1. Confirm workspace and API target through `valedictorian-cli`; require clear user intent before mutating non-local data.
2. Select one unit of work from the Action Queue or a specific application id.
3. Read the application, attempts, in-progress runs, profile agent context, sensitive-profile summary, and secret summaries.
4. Decide whether to proceed, skip, mark not fit/not pursued, or pause for missing user input.
5. Start or resume an auditable `application_attempt` run and application attempt before browser work.
6. Recover the official application URL when starting from an aggregator or job board.
7. Open the external site with the appropriate browser automation skill/tool for the session.
8. Fill the application from approved Valedictorian state and selected materials. Do not invent facts.
9. Verify persisted values page by page, especially after resume parsing, uploads, redirects, reloads, or saved profile data.
10. Record durable milestones as attempt steps and broader diagnostics as run steps.
11. Pause or complete with the most precise outcome when a blocker appears.
12. Submit only after final verification and when explicit user instruction or recorded workspace/application policy authorizes submission.
13. Capture confirmation evidence, add the required `verification_receipt`, complete the attempt/run, then re-read the affected records.
14. Summarize the outcome with application id, attempt id, final status, confirmation evidence, and unresolved follow-ups.

## Decision Gates

Pause before continuing when:

- The answer requires a fact not present in Valedictorian state, the resume/materials, or prior user instructions.
- The site asks for MFA, CAPTCHA, identity verification, security challenge, payment, assessment, legal attestation, background-check authorization, or account recovery.
- Salary, compensation, relocation, travel, start date, work authorization, sponsorship, clearance, export-control, EEO, veteran, disability, or accommodation questions lack a recorded policy.
- The posting is suspicious, closed, duplicate, unofficial, pay-to-apply, or not tied to a credible employer recruiting channel.
- The selected resume, cover letter, transcript, identity document, or other upload is missing or ambiguous.
- The final review still has blank, stale, parser-damaged, or unsupported material fields.

## Outcome Classifier

Use precise Valedictorian outcomes:

- `submitted`: real confirmation page, dashboard status, or receipt email verified.
- `already_applied`: the official portal says this exact posting was already applied to.
- `ready_for_review`: filled and verified, but intentionally waiting for user review or final approval.
- `needs_user_info`: a required answer is not available from approved sources.
- `manual_captcha`: the form is reachable but requires human CAPTCHA/security completion.
- `security_gate`: bot/security infrastructure prevents reaching the form.
- `login_needed`: account, password, MFA, or verification remains after allowed recovery attempts.
- `platform_error`: upload, save, validation, or submit fails due to unstable ATS behavior.
- `closed`: the official posting is expired, removed, or no longer accepting applications.
- `not_fit` or `not_pursued`: the role conflicts with policy, score, eligibility, user preferences, or application strategy.

## Final Submit Guard

Before clicking `Submit`, `Apply`, `Send`, or equivalent:

- Verify employer, role, location/work mode, official URL, and account identity.
- Verify selected resume and any cover letter/transcript/portfolio uploads.
- Verify name, email, phone, education, work history, websites, skills, work authorization, sponsorship, salary/compensation, required screening answers, and required consents.
- Verify voluntary sensitive disclosures follow recorded policy.
- Verify no visible validation errors, disabled submit state, stale parser values, or unresolved material blanks remain.
- Record a passed `verification_receipt` only after this final review is true.

If submission is not authorized, complete or leave the attempt as `ready_for_review` with the required hold metadata rather than submitting.
