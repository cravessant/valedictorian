import type { FieldSelectChoice } from '../form-modal'

export const EVIDENCE_MODE_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'reported', label: 'Reported' },
  { value: 'ats_details_provided', label: 'ATS details provided' },
]

export const ADAPTER_KIND_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'connector', label: 'Connector' },
  { value: 'cli', label: 'CLI' },
  { value: 'manual', label: 'Manual' },
  { value: 'import', label: 'Import' },
]

export const ROLE_KIND_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'internship', label: 'Internship' },
  { value: 'co_op', label: 'Co-op' },
  { value: 'new_grad', label: 'New grad' },
  { value: 'entry_level', label: 'Entry level' },
  { value: 'experienced', label: 'Experienced' },
  { value: 'other', label: 'Other' },
]

export const TIMING_MODE_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'rolling', label: 'Rolling' },
  { value: 'unknown', label: 'Unknown' },
]

export const WORK_MODE_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'onsite', label: 'Onsite' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
  { value: 'unknown', label: 'Unknown' },
]

export const EMPLOYMENT_TYPE_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
  { value: 'temporary', label: 'Temporary' },
  { value: 'unknown', label: 'Unknown' },
]

export const SENIORITY_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'student', label: 'Student' },
  { value: 'entry', label: 'Entry' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'unknown', label: 'Unknown' },
]

export const AVAILABILITY_STATE_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'unknown', label: 'Unknown' },
]

export const FIT_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'fit', label: 'Fit' },
  { value: 'possible', label: 'Possible' },
  { value: 'not_fit', label: 'Not fit' },
  { value: 'unknown', label: 'Unknown' },
]

export const CUTOFF_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
  { value: 'not_evaluated', label: 'Not evaluated' },
]

export const DISPOSITION_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'pursue', label: 'Pursue' },
  { value: 'hold', label: 'Hold' },
  { value: 'declined', label: 'Declined' },
  { value: 'archived', label: 'Archived' },
]

export const PURSUIT_STATUS_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'active', label: 'Active' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offered', label: 'Offered' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

export const REMOVAL_CHOICE_CHOICES: ReadonlyArray<FieldSelectChoice> = [
  { value: 'preserve_historical_lineage', label: 'Preserve historical lineage' },
  { value: 'unlink_dependents', label: 'Unlink dependents' },
  { value: 'cascade_tombstone', label: 'Cascade tombstone' },
  { value: 'reject_if_dependents', label: 'Reject if dependents' },
]