import { useEffect, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Label } from '@/components/ui/label'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import {
  defaultPolicyConfig,
  isPolicyEvidenceTag,
  type PolicyConfig,
  type PolicyConfigPatch,
  type PolicyEvidenceTag,
} from 'sparxie'
import type { PolicyPreloadApi } from '../ipc/policy.preload'
import { SettingsToggleRow } from '../app/AppChrome'
import { SettingsTextInput } from './SettingsTextInput'

export function PolicySettingsPanel({ policyApi }: { policyApi: PolicyPreloadApi }) {
  const [draftConfig, setDraftConfig] = useState<PolicyConfig>(defaultPolicyConfig)
  const [savedConfig, setSavedConfig] = useState<PolicyConfig>(defaultPolicyConfig)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [savingSection, setSavingSection] = useState<PolicySaveScope>(null)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    policyApi.config
      .get()
      .then((nextConfig) => {
        if (!cancelled) {
          setDraftConfig(nextConfig)
          setSavedConfig(nextConfig)
          setError(null)
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Policy settings failed to load.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [policyApi])

  function updateDraft(updater: (currentConfig: PolicyConfig) => PolicyConfig) {
    setDraftConfig((currentConfig) => updater(currentConfig))
  }

  function updatePolicyNumber(
    value: string,
    fallback: number,
    onValue: (value: number) => void,
    options: { integer?: boolean; max?: number; min?: number } = {},
  ) {
    const nextValue = Number(value)

    if (!Number.isFinite(nextValue)) {
      onValue(fallback)
      return
    }

    const min = options.min ?? 1
    const max = options.max ?? Number.POSITIVE_INFINITY
    const boundedValue = Math.min(Math.max(nextValue, min), max)
    onValue(options.integer ? Math.round(boundedValue) : boundedValue)
  }

  function savePolicySection(section: PolicySectionKey) {
    const sectionTitle = policySectionTitles[section]
    setSavingSection(section)
    void policyApi.config
      .update(buildPolicySectionPatch(section, draftConfig))
      .then((nextConfig) => {
        setSavedConfig(nextConfig)
        setDraftConfig((currentDraft) => mergeSavedPolicySection(currentDraft, nextConfig, section))
        setError(null)
        toast({
          title: `${sectionTitle} saved.`,
          variant: 'success',
        })
      })
      .catch((saveError: unknown) => {
        const message =
          saveError instanceof Error ? saveError.message : 'Policy settings failed to save.'
        setError(message)
        toast({
          description: message,
          title: 'Policy update failed',
          variant: 'destructive',
        })
      })
      .finally(() => setSavingSection(null))
  }

  function resetPolicyConfig() {
    setSavingSection('reset')
    void policyApi.config
      .reset()
      .then((nextConfig) => {
        setDraftConfig(nextConfig)
        setSavedConfig(nextConfig)
        setError(null)
        toast({
          title: 'Policy reset.',
          variant: 'success',
        })
      })
      .catch((resetError: unknown) => {
        const message = resetError instanceof Error ? resetError.message : 'Policy reset failed.'
        setError(message)
        toast({
          description: message,
          title: 'Policy update failed',
          variant: 'destructive',
        })
      })
      .finally(() => setSavingSection(null))
  }

  return (
    <section aria-labelledby="policy-settings-title" className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="policy-settings-title" className="text-xl font-semibold text-foreground">
            Policy
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Action buckets, evidence gates, submit checks, retry thresholds, and sourcing windows.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={isLoading || savingSection !== null}
          onClick={resetPolicyConfig}
        >
          {savingSection === 'reset' ? 'Resetting...' : 'Reset policy'}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Policy failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <PolicySection
        isSaving={savingSection === 'action-queue-decisions'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'action-queue-decisions')
        }
        saveLabel="Save Action Queue decisions"
        title="Action Queue decisions"
        onSave={() => savePolicySection('action-queue-decisions')}
      >
        <SettingsTextInput
          label="Apply cutoff"
          type="number"
          value={String(draftConfig.scoring.applyCutoff)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.scoring.applyCutoff, (applyCutoff) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                scoring: { ...currentConfig.scoring, applyCutoff },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Stale lock hours"
          type="number"
          value={String(draftConfig.actionQueue.staleLockHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.actionQueue.staleLockHours, (staleLockHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                actionQueue: { ...currentConfig.actionQueue, staleLockHours },
              })),
            )
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'manual-review'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'manual-review')
        }
        saveLabel="Save manual review"
        title="Manual review"
        onSave={() => savePolicySection('manual-review')}
      >
        <SettingsTextInput
          label="Manual pickup delay"
          type="number"
          value={String(draftConfig.manualReview.pickupDelayHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.manualReview.pickupDelayHours, (pickupDelayHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                manualReview: { ...currentConfig.manualReview, pickupDelayHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Pickup window start"
          type="time"
          value={draftConfig.manualReview.daytimeWindow.start}
          onChange={(start) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, start },
              },
            }))
          }
        />
        <SettingsTextInput
          label="Pickup window end"
          type="time"
          value={draftConfig.manualReview.daytimeWindow.end}
          onChange={(end) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, end },
              },
            }))
          }
        />
        <SettingsTextInput
          label="Pickup window timezone"
          value={draftConfig.manualReview.daytimeWindow.timezone}
          onChange={(timezone) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                daytimeWindow: { ...currentConfig.manualReview.daytimeWindow, timezone },
              },
            }))
          }
        />
        <PolicyTextArea
          label="Non-overridable evidence tags"
          value={formatStringList(draftConfig.manualReview.nonOverridableTags)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                nonOverridableTags: parsePolicyEvidenceTagList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="Manual review companies"
          value={formatStringList(draftConfig.manualReview.manualReviewCompanyPatterns)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                manualReviewCompanyPatterns: parseStringList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="Explicit approval companies"
          value={formatStringList(draftConfig.manualReview.explicitApprovalCompanyPatterns)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              manualReview: {
                ...currentConfig.manualReview,
                explicitApprovalCompanyPatterns: parseStringList(value),
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'evidence-requirements'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'evidence-requirements')
        }
        saveLabel="Save evidence requirements"
        title="Evidence requirements"
        onSave={() => savePolicySection('evidence-requirements')}
      >
        <PolicyTextArea
          label="Allowed native platforms"
          value={formatStringList(draftConfig.officialPath.allowedNativePlatforms)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                allowedNativePlatforms: parseStringList(value),
              },
            }))
          }
        />
        <PolicyTextArea
          label="High-risk form builders"
          value={formatStringList(draftConfig.officialPath.highRiskFormBuilders)}
          onChange={(value) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                highRiskFormBuilders: parseStringList(value),
              },
            }))
          }
        />
        <SettingsToggleRow
          checked={draftConfig.officialPath.requireEmployerDomainVerificationForHighRiskForms}
          description="High-risk forms need employer-domain proof before promotion."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require employer-domain verification"
          onChange={(requireEmployerDomainVerificationForHighRiskForms) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              officialPath: {
                ...currentConfig.officialPath,
                requireEmployerDomainVerificationForHighRiskForms,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'application-gates'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'application-gates')
        }
        saveLabel="Save application gates"
        title="Application gates"
        onSave={() => savePolicySection('application-gates')}
      >
        <SettingsToggleRow
          checked={draftConfig.verification.requireFinalReviewReceiptForSubmit}
          description="Submit outcomes need a final review receipt."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require final review receipt"
          onChange={(requireFinalReviewReceiptForSubmit) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              verification: {
                ...currentConfig.verification,
                requireFinalReviewReceiptForSubmit,
              },
            }))
          }
        />
        <SettingsToggleRow
          checked={draftConfig.verification.requireSecondPassForSubmit}
          description="Submit outcomes need second-pass verification."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Require second pass verification"
          onChange={(requireSecondPassForSubmit) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              verification: {
                ...currentConfig.verification,
                requireSecondPassForSubmit,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'retry-recovery'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'retry-recovery')
        }
        saveLabel="Save retry recovery"
        title="Retry recovery"
        onSave={() => savePolicySection('retry-recovery')}
      >
        <SettingsTextInput
          label="Captcha/security retries"
          type="number"
          value={String(draftConfig.retries.captchaSecurityMinProfileAttempts)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.retries.captchaSecurityMinProfileAttempts,
              (captchaSecurityMinProfileAttempts) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  retries: {
                    ...currentConfig.retries,
                    captchaSecurityMinProfileAttempts,
                  },
                })),
              { integer: true },
            )
          }
        />
        <SettingsTextInput
          label="Platform error retries"
          type="number"
          value={String(draftConfig.retries.platformErrorMinProfileAttempts)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.retries.platformErrorMinProfileAttempts,
              (platformErrorMinProfileAttempts) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  retries: {
                    ...currentConfig.retries,
                    platformErrorMinProfileAttempts,
                  },
                })),
              { integer: true },
            )
          }
        />
        <SettingsToggleRow
          checked={draftConfig.retries.loginNeededRequiresRecoveryAttempt}
          description="Login-needed outcomes require recovery evidence."
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          label="Login recovery required"
          onChange={(loginNeededRequiresRecoveryAttempt) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              retries: {
                ...currentConfig.retries,
                loginNeededRequiresRecoveryAttempt,
              },
            }))
          }
        />
      </PolicySection>

      <PolicySection
        isSaving={savingSection === 'sourcing-windows'}
        saveDisabled={
          isLoading ||
          savingSection !== null ||
          !hasPolicySectionChanges(draftConfig, savedConfig, 'sourcing-windows')
        }
        saveLabel="Save sourcing windows"
        title="Sourcing windows"
        onSave={() => savePolicySection('sourcing-windows')}
      >
        <SettingsTextInput
          label="Sourcing timezone"
          value={draftConfig.sourcing.timezone}
          onChange={(timezone) =>
            updateDraft((currentConfig) => ({
              ...currentConfig,
              sourcing: { ...currentConfig.sourcing, timezone },
            }))
          }
        />
        <SettingsTextInput
          label="Overlap minutes"
          type="number"
          value={String(draftConfig.sourcing.overlapMinutes)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overlapMinutes,
              (overlapMinutes) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overlapMinutes },
                })),
              { integer: true },
            )
          }
        />
        <SettingsTextInput
          label="Weekday cadence"
          type="number"
          value={String(draftConfig.sourcing.weekdayNormalCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekdayNormalCadenceHours, (weekdayNormalCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekdayNormalCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Overnight cadence"
          type="number"
          value={String(draftConfig.sourcing.weekdayOvernightCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekdayOvernightCadenceHours, (weekdayOvernightCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekdayOvernightCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Weekend cadence"
          type="number"
          value={String(draftConfig.sourcing.weekendCadenceHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.weekendCadenceHours, (weekendCadenceHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, weekendCadenceHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Minimum lookback"
          type="number"
          value={String(draftConfig.sourcing.minimumNormalLookbackHours)}
          onChange={(value) =>
            updatePolicyNumber(value, draftConfig.sourcing.minimumNormalLookbackHours, (minimumNormalLookbackHours) =>
              updateDraft((currentConfig) => ({
                ...currentConfig,
                sourcing: { ...currentConfig.sourcing, minimumNormalLookbackHours },
              })),
            )
          }
        />
        <SettingsTextInput
          label="Overnight start hour"
          type="number"
          value={String(draftConfig.sourcing.overnightStartHour)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overnightStartHour,
              (overnightStartHour) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overnightStartHour },
                })),
              { integer: true, max: 23, min: 0 },
            )
          }
        />
        <SettingsTextInput
          label="Overnight end hour"
          type="number"
          value={String(draftConfig.sourcing.overnightEndHour)}
          onChange={(value) =>
            updatePolicyNumber(
              value,
              draftConfig.sourcing.overnightEndHour,
              (overnightEndHour) =>
                updateDraft((currentConfig) => ({
                  ...currentConfig,
                  sourcing: { ...currentConfig.sourcing, overnightEndHour },
                })),
              { integer: true, max: 23, min: 0 },
            )
          }
        />
      </PolicySection>
    </section>
  )
}

function PolicySection({
  children,
  isSaving,
  saveDisabled,
  saveLabel,
  title,
  onSave,
}: {
  children: ReactNode
  isSaving: boolean
  saveDisabled: boolean
  saveLabel: string
  title: string
  onSave: () => void
}) {
  return (
    <section aria-labelledby={`policy-section-${slugify(title)}`} className="space-y-3">
      <h3 id={`policy-section-${slugify(title)}`} className="text-sm font-semibold text-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border rounded-md border border-border bg-card">
        {children}
        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
          <Button type="button" disabled={saveDisabled} onClick={onSave}>
            {isSaving ? 'Saving...' : saveLabel}
          </Button>
        </div>
      </div>
    </section>
  )
}

function PolicyTextArea({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <Label className="grid gap-2 px-4 py-3 text-sm text-foreground md:grid-cols-[220px_1fr]">
      <span className="pt-2">
        <span className="block font-medium">{label}</span>
      </span>
      <textarea
        aria-label={label}
        className="min-h-24 w-full min-w-0 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Label>
  )
}

function formatStringList(values: readonly string[]) {
  return values.join('\n')
}

function parseStringList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parsePolicyEvidenceTagList(value: string): PolicyEvidenceTag[] {
  return parseStringList(value).filter(isPolicyEvidenceTag)
}

function slugify(value: string) {
  return value.toLowerCase().replace(/\s+/g, '-')
}

type PolicySectionKey =
  | 'application-gates'
  | 'action-queue-decisions'
  | 'evidence-requirements'
  | 'manual-review'
  | 'retry-recovery'
  | 'sourcing-windows'

type PolicySaveScope = PolicySectionKey | 'reset' | null

const policySectionTitles: Record<PolicySectionKey, string> = {
  'application-gates': 'Application gates',
  'action-queue-decisions': 'Action Queue decisions',
  'evidence-requirements': 'Evidence requirements',
  'manual-review': 'Manual review',
  'retry-recovery': 'Retry recovery',
  'sourcing-windows': 'Sourcing windows',
}

function hasPolicySectionChanges(
  draftConfig: PolicyConfig,
  savedConfig: PolicyConfig,
  section: PolicySectionKey,
) {
  return (
    JSON.stringify(readPolicySection(draftConfig, section)) !==
    JSON.stringify(readPolicySection(savedConfig, section))
  )
}

function buildPolicySectionPatch(
  section: PolicySectionKey,
  config: PolicyConfig,
): PolicyConfigPatch {
  switch (section) {
    case 'application-gates':
      return { verification: config.verification }
    case 'evidence-requirements':
      return { officialPath: config.officialPath }
    case 'manual-review':
      return { manualReview: config.manualReview }
    case 'action-queue-decisions':
      return {
        actionQueue: config.actionQueue,
        scoring: config.scoring,
      }
    case 'retry-recovery':
      return { retries: config.retries }
    case 'sourcing-windows':
      return { sourcing: config.sourcing }
  }
}

function mergeSavedPolicySection(
  draftConfig: PolicyConfig,
  savedConfig: PolicyConfig,
  section: PolicySectionKey,
): PolicyConfig {
  switch (section) {
    case 'application-gates':
      return { ...draftConfig, verification: savedConfig.verification }
    case 'evidence-requirements':
      return { ...draftConfig, officialPath: savedConfig.officialPath }
    case 'manual-review':
      return { ...draftConfig, manualReview: savedConfig.manualReview }
    case 'action-queue-decisions':
      return {
        ...draftConfig,
        actionQueue: savedConfig.actionQueue,
        scoring: savedConfig.scoring,
      }
    case 'retry-recovery':
      return { ...draftConfig, retries: savedConfig.retries }
    case 'sourcing-windows':
      return { ...draftConfig, sourcing: savedConfig.sourcing }
  }
}

function readPolicySection(config: PolicyConfig, section: PolicySectionKey) {
  switch (section) {
    case 'application-gates':
      return config.verification
    case 'evidence-requirements':
      return config.officialPath
    case 'manual-review':
      return config.manualReview
    case 'action-queue-decisions':
      return {
        actionQueue: config.actionQueue,
        scoring: config.scoring,
      }
    case 'retry-recovery':
      return config.retries
    case 'sourcing-windows':
      return config.sourcing
  }
}
