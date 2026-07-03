# Browser Application Playbooks

Read this before opening an external job site, job board, or ATS form.

## Browser Tooling

- Load the browser automation skill/tool available in the session before interacting with pages.
- Use authenticated/profiled browser state when the application depends on an existing job-board, employer, school, or ATS account.
- Use a clean session only for simple forms that do not depend on account trust, device reputation, saved profile data, or prior failed attempts.
- Verify the active account identity inside the browser when a site is authenticated. Do not rely on an ambiguous browser profile name.
- Never use CAPTCHA-solving services or evasive anti-bot tactics.

## Official Application Path

- Prefer employer-hosted application URLs whenever a source page links out to one.
- Treat aggregators as discovery sources unless the aggregator-hosted form is clearly the official application surface.
- Preserve source URLs and redirected canonical URLs in notes or links when they matter for provenance.
- Treat unaffiliated forms and standalone file-upload pages as high risk unless an official employer recruiting channel links to the exact form.
- Stop before submitting when the form cannot be tied to the employer or posting.

## Navigation

- Prefer visible text, accessible names, labels, and stable URLs over brittle CSS selectors.
- Track new tabs, redirects, session expiration, selected job ids, and portal dashboards.
- Detect closed postings, already-applied states, wrong-job redirects, generic talent-community forms, and stale saved drafts.
- Avoid duplicate submissions. If a submit click times out, check portal state before clicking again.

## Login And Accounts

- Check for an existing session before entering credentials.
- Use credential secrets only through approved trusted mechanisms. Do not print, echo, screenshot, or store plaintext credentials.
- Do not create accounts, change passwords, change MFA settings, change recovery emails, or alter profile identity fields unless explicitly authorized.
- Pause for MFA, passkeys, email verification, suspicious-device checks, identity verification, or CAPTCHA/security challenges unless a recorded workflow policy says exactly how to proceed.

## Uploads And Resume Parsing

- Upload only the selected resume or explicitly approved document for this application.
- Do not use ATS resume import/autofill as the source of truth for application fields.
- If a portal parses a resume or preloads saved profile data, treat parsed values as untrusted until verified against Valedictorian state and selected materials.
- Wait for upload completion indicators and verify the visible file name when possible.
- Replace incorrect, stale, duplicate, or failed uploads before continuing.
- Stop before attaching a cover letter, transcript, identity document, portfolio, or reference list unless the application state or user instruction clearly selected it.

## Form Filling

- Fill contact, education, work history, websites, skills, and screening answers from Valedictorian state and selected materials.
- Treat selects, radios, checkboxes, token pickers, date pickers, and catalog fields as semantic controls, not plain strings.
- Repair parser damage with real UI-backed edits. Avoid submitting while material fields are blank, stale, split across rows, or unsupported by source data.
- Leave optional marketing, newsletter, SMS, follow, talent-community, and job-alert opt-ins unchecked unless required to submit or explicitly approved.

## Multi-Page Verification

- Fill one page, validate it, record a page note or screenshot when useful, then continue.
- Re-check persisted values after each `Next`, `Save`, reload, redirect, or browser back/forward action.
- Do not wait until the final review page to discover parser damage, hidden required fields, missing uploads, or stale values.
- If a final review page exists, compare it against the intended application payload before submission.

## Validation Errors And Recovery

- After each continue/save/submit, scan for inline errors, toast messages, disabled buttons, required-field markers, focus jumps, and server errors.
- Fix deterministic validation errors from approved data.
- Retry transient navigation, upload, or save failures only after checking whether the previous action already succeeded.
- Use precise outcomes for unresolved gates: `manual_captcha`, `security_gate`, `login_needed`, `platform_error`, `closed`, `needs_user_info`, `not_fit`, or `not_pursued`.

## Confirmation Capture

- After submission, capture confirmation text, final URL, confirmation id if visible, portal status, and timestamp.
- Check for receipt email only when the workflow has a safe, available mail tool and doing so will not expose secret or sensitive data.
- Do not mark `submitted` from a successful click alone. Require confirmation evidence or explain why equivalent evidence proves submission.
