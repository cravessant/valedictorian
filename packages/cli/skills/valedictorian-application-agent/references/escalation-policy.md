# Escalation Policy

Read this when a question, site behavior, or final-submit decision may require user approval.

## Default Rule

Represent the user truthfully and minimize private disclosure. Proceed only from Valedictorian state, explicitly approved materials, or prior user instructions. The alpha.18 CLI cannot inspect submission policy; when authority or a fact is missing, ambiguous, sensitive, legal, or high impact, pause and ask.

## Pause Before

- Answering any question that requires a user-specific fact not already supported by approved sources.
- Making legal certifications, arbitration acknowledgements, background-check authorizations, policy agreements, signatures, or consent statements.
- Disclosing SSN or SSN last four, government ids, immigration details, or other secret-path identity details without explicit policy.
- Disclosing DOB, demographic details, disability status, veteran status, accommodation needs, or other self-identification details when they are missing from approved sources or when recorded policy forbids disclosure.
- Entering salary expectations, minimum compensation, relocation willingness, travel willingness, start date, work authorization, sponsorship, clearance, export-control, or assessment answers without recorded policy.
- Creating, recovering, deleting, or materially changing accounts.
- Uploading documents not selected for this application.
- Proceeding through MFA, CAPTCHA, bot checks, identity verification, suspicious-device gates, payment, or pay-to-apply flows.
- Applying to a suspicious, unofficial, duplicate, closed, low-fit, or policy-conflicting posting.
- Final submission when no explicit user instruction or recorded policy authorizes submission.

## Final Submission Policy

- Require explicit user approval for final submission because alpha.18 cannot inspect recorded auto-submit policy.
- If approval is absent, fill and verify the form, record a `ready_for_review` workflow-run blocker, and report that the Action Queue hold was not updated.
- Never submit with unresolved material blanks, unsupported answers, failed uploads, stale parser values, visible validation errors, or unclear official posting identity.

## Fit And Anti-Spam Gates

- Do not mass-apply blindly.
- Check duplicate status, role kind, seniority, location/work mode, compensation, sponsorship compatibility, company exclusions, source quality, and score/priority policy before applying.
- Do not apply to roles requiring misleading answers, pay-to-apply schemes, suspicious reposts, or forms that cannot be verified through employer recruiting channels.
- Respect platform rate limits, account reputation, and anti-abuse controls. Stop if the workflow becomes spammy, evasive, or account-risky.

## Never Invent

Never invent or exaggerate:

- Employment history, titles, responsibilities, dates, employers, references, achievements, metrics, or reasons for leaving.
- Degrees, schools, GPA, coursework, licenses, certifications, publications, awards, or clearances.
- Skills, years of experience, tool proficiency, languages, portfolio work, open-source contributions, or domain expertise.
- Salary history, compensation expectations, availability, relocation willingness, travel willingness, or commute tolerance.
- Work authorization, citizenship, visa status, sponsorship needs, security clearance, export-control eligibility, or background-check facts.
- Disability, veteran, demographic, EEO, accommodation, or protected-class information.
- Addresses, phone numbers, identity numbers, account credentials, signatures, or consent.
- Enthusiasm, motivations, company interest, or willingness to accept conditions beyond what the user has approved.

## Sensitive Data Handling

- Use the minimum information required by the application.
- Prefer profile agent-context and answer-bank data. Populated DOB/demographic/self-identification facts may be used deterministically; never invent missing facts.
- Keep SSN and credentials on the secret path. Prefer secret summaries only to know whether a trusted value exists.
- Do not place raw secret values or invented sensitive values in run notes, screenshots, messages, temp files, shell history, or commits.
- Do not infer protected-class information from name, location, education, photos, or indirect signals.
- If the page displays sensitive values, avoid capturing them unless evidence is required and the storage path is appropriate.
