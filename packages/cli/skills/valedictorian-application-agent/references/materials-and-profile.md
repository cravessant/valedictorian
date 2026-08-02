# Materials And Profile

Read this before choosing application materials, profile facts, credential summaries, or saved answers.

## Source Order

Prefer sources in this order:

1. Application-specific Valedictorian state and user instructions.
2. `profile agent-context` and reusable answer-bank data.
3. The explicitly approved resume path, cover letter, transcript, portfolio, or other artifact supplied for this work.
4. Prior run notes and read-only technical attempts/events for the same Application.
5. Credential secret summaries, used only to know whether a trusted value exists.

If sources disagree, pause or follow the most application-specific explicit user instruction.

## Profile Data

- Use `profile agent-context` for reusable public profile facts, including populated date of birth and self-identification fields when present.
- Populated DOB, demographic, and self-identification facts from agent context may be used deterministically for form answers when the application asks.
- Never invent missing DOB, demographic, disability, veteran, or other self-identification facts.
- Keep SSN and credentials on the secret path via `secrets`; treat `secrets list` as availability metadata, not permission to print or store credential values. Prefer `secrets run` with structured `secret://` references for trusted local child commands instead of temp files or argv substitution. This reduces accidental disclosure; it is not a same-user sandbox boundary.
- Do not update profile data from a form unless the user specifically asks for profile maintenance.

## Resumes And Cover Letters

- The current Application/Profile CLI state does not select a resume. Require an explicitly approved resume path from the user or another authorized task input; otherwise pause.
- Do not generate or attach a cover letter unless the user explicitly selects that path.
- Do not upload transcripts, identity documents, references, writing samples, or portfolios unless they are explicitly selected or required and approved.
- If a site rejects a file, record the rejection in the workflow run and use only approved conversion/sanitization workflows.

## Manual Entry

- Upload the intended resume as an attachment, then verify or manually enter material fields from source data.
- Do not trust ATS parser output, saved profile data, imported resume data, or browser autofill until verified.
- Material fields include name, email, phone, education, degree, major, dates, work history, titles, companies, work descriptions, websites, skills, resume attachment, work authorization, sponsorship, salary/compensation, and required screening answers.
- Optional non-evaluative fields may remain blank when truly optional.

## Credential And Account Use

- Use credentials only through approved trusted mechanisms and only for official application or account recovery flows.
- Do not echo credentials in commands, updates, notes, screenshots, or final responses.
- Do not reuse credentials across unrelated employer/ATS accounts unless policy explicitly says they are shared.
- Do not create security questions or recovery answers from invented facts.

## Evidence Paths

When capturing screenshots or downloaded receipts, place them in a workflow-appropriate evidence location outside source-controlled code unless the workspace defines a safe artifact path. Record paths in notes only when they do not reveal secrets or sensitive values.
