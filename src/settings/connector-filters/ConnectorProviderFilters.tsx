import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectorOption,
  ConnectorOptionQueryResult,
  ConnectorVersionedRendererSchema,
  InstalledConnectorDescriptor,
  ValedictorianWorkspaceClient,
} from 'sparxie'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { AlertTriangle, X } from 'lucide-react'
import {
  validateConnectorConfigPersistenceValue,
  validateConnectorSchemaValue,
} from '../../modules/connectors/connector.renderer-schema-validation'
import {
  dynamicActionLabel,
  dynamicBindingPointers,
  escapePointer,
  evaluateVersionedPresentationCompatibility,
  presentationFieldForPointer,
} from './connector-presentation'
import {
  accountResolveSelectedValues,
  dependencyTransitionClearDecision,
  displayValue,
  formatDependencyClearFeedback,
  knownDynamicValueKey,
  selectionValueKeys,
  selectionValueKeysEqual,
  valueKey,
} from './connector-dynamic-clear'
import { StaticFilterControl } from './ConnectorStaticControls'

type OptionsApi = ValedictorianWorkspaceClient['connectors']['options']
type DynamicOptions = NonNullable<InstalledConnectorDescriptor['dynamicOptions']>
type DynamicBinding = DynamicOptions['bindings'][number]
type DynamicCompatibilityState =
  | { status: 'pending' }
  | { status: 'unknown'; values: unknown[] }
  | { status: 'auth_required' }
  | { status: 'error'; retryable: boolean }
  | { status: 'unverifiable'; reason: 'resolve_unavailable' | 'dependencies_unavailable' }

export function ConnectorProviderFilters({
  api,
  allowMissingRootRequired,
  descriptor,
  disabled,
  filters,
  instanceId,
  onChange,
  compatibilityAlertRole = 'alert',
  onCompatibilityChange,
}: {
  api: OptionsApi
  allowMissingRootRequired: boolean
  descriptor: InstalledConnectorDescriptor
  disabled: boolean
  filters: Record<string, unknown>
  instanceId: string
  onChange: (filters: Record<string, unknown>) => void
  compatibilityAlertRole?: 'alert' | 'status'
  onCompatibilityChange: (compatible: boolean) => void
}) {
  const filterDeclaration = descriptor.filterSchema
  const filterSchema = filterDeclaration?.schema
  const filterObjectSchema = filterSchema && 'type' in filterSchema && filterSchema.type === 'object'
    ? filterSchema
    : null
  const presentationCompatibility = evaluateVersionedPresentationCompatibility(
    filterDeclaration,
    { requiredDynamicPointers: dynamicBindingPointers(descriptor.dynamicOptions) },
  )
  const dynamicOptions = descriptor.dynamicOptions
  const bindingsByPointer = useMemo(() => new Map(
    (dynamicOptions?.bindings ?? []).map((binding) => [binding.filterPointer, binding]),
  ), [dynamicOptions])
  const [dynamicCompatibilityByPointer, setDynamicCompatibilityByPointer] = useState<
    Record<string, DynamicCompatibilityState>
  >({})
  const reportDynamicCompatibility = useCallback((
    pointer: string,
    state: DynamicCompatibilityState | null,
  ) => {
    setDynamicCompatibilityByPointer((current) => {
      if (state === null && !(pointer in current)) return current
      const next = { ...current }
      if (state === null) delete next[pointer]
      else next[pointer] = state
      return next
    })
  }, [])
  const issues = filterObjectSchema && presentationCompatibility.compatible
    ? validateConnectorSchemaValue(filterObjectSchema, filters, { allowMissingRootRequired })
    : []
  const dynamicCompatibilityEntries = Object.entries(dynamicCompatibilityByPointer)
  const missingSourceBindings = (dynamicOptions?.bindings ?? []).filter((binding) =>
    !dynamicOptions?.sources.some((source) => source.id === binding.sourceId))
  const visibleDynamicCompatibilityEntries = dynamicCompatibilityEntries.filter(([, state]) =>
    state.status !== 'pending')

  useEffect(() => {
    onCompatibilityChange(
      presentationCompatibility.compatible
      && issues.length === 0
      && dynamicCompatibilityEntries.length === 0
      && missingSourceBindings.length === 0,
    )
  }, [
    dynamicCompatibilityEntries.length,
    issues.length,
    missingSourceBindings.length,
    onCompatibilityChange,
    presentationCompatibility.compatible,
  ])

  if (!filterObjectSchema || !filterDeclaration) return null

  return (
    <section className="grid gap-4 border-y border-border/70 py-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-foreground">Provider filters</h3>
        <p className="text-xs text-muted-foreground">
          These provider-owned filters control sourcing. Candidate-fit evaluation remains a separate,
          downstream step.
        </p>
      </div>

      {!presentationCompatibility.compatible ? (
        <Alert role={compatibilityAlertRole} variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Saved filters are not compatible</AlertTitle>
          <AlertDescription>
            <p>{presentationCompatibility.message}</p>
          </AlertDescription>
        </Alert>
      ) : issues.length > 0 || visibleDynamicCompatibilityEntries.length > 0
        || missingSourceBindings.length > 0 ? (
        <Alert role={compatibilityAlertRole} variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Saved filters are not compatible</AlertTitle>
          <AlertDescription>
            {issues.map((issue) => {
              const value = valueAtPointer(filters, issue.path)
              const field = presentationFieldForPointer(filterDeclaration, issue.path)
              return (
                <p key={`${issue.path}:${issue.message}`}>
                  {field?.label ?? pointerLeaf(issue.path)}: {displayValue(value)} {issue.message}.
                </p>
              )
            })}
            {visibleDynamicCompatibilityEntries.flatMap(([pointer, state]) => {
              const label = presentationFieldForPointer(filterDeclaration, pointer)?.label
                ?? pointerLeaf(pointer)
              if (state.status === 'unknown') {
                return state.values.map((value) => (
                  <p key={`${pointer}:${valueKey(value)}`}>
                    {label}: {displayValue(value)} is unknown or unavailable from the provider.
                  </p>
                ))
              }
              if (state.status === 'auth_required') {
                return <p key={pointer}>{label}: Provider authentication is required to check saved values.</p>
              }
              if (state.status === 'pending') return []
              if (state.status === 'unverifiable') {
                return (
                  <p key={pointer}>
                    {label}: {state.reason === 'resolve_unavailable'
                      ? 'Saved values cannot be verified because the source does not declare a resolve operation.'
                      : 'Required filter dependencies are missing, so saved values cannot be checked for compatibility.'}
                  </p>
                )
              }
              return (
                <p key={pointer}>
                  {label}: {state.retryable
                    ? 'Provider options are temporarily unavailable. Try again to check saved values.'
                    : 'The provider rejected the saved values compatibility check.'}
                </p>
              )
            })}
            {missingSourceBindings.map((binding) => (
              <p key={`${binding.filterPointer}:${binding.sourceId}`}>
                {presentationFieldForPointer(filterDeclaration, binding.filterPointer)?.label
                  ?? pointerLeaf(binding.filterPointer)}: Dynamic binding source{' '}
                {binding.sourceId} is not declared by the connector descriptor.
              </p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      {presentationCompatibility.compatible ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(filterObjectSchema.properties).map(([property, schema]) => {
            const pointer = `/${escapePointer(property)}`
            const fieldPresentation = presentationFieldForPointer(filterDeclaration, pointer)
            if (!fieldPresentation) return null
            const binding = bindingsByPointer.get(pointer)
            const descriptionId = `${instanceId}-filter-${encodeURIComponent(pointer)}-description`
            const required = filterObjectSchema.required?.includes(property) === true
            if (binding && dynamicOptions) {
              const source = dynamicOptions.sources.find((candidate) => candidate.id === binding.sourceId)
              if (!source) return null
              return (
                <DynamicFilterControl
                  key={property}
                  api={api}
                  binding={binding}
                  description={fieldPresentation.description}
                  descriptionId={descriptionId}
                  descriptor={descriptor}
                  disabled={disabled}
                  filters={filters}
                  instanceId={instanceId}
                  label={dynamicActionLabel(binding.intent, fieldPresentation.label)}
                  source={source}
                  value={filters[property]}
                  onChange={(value) => onChange(withProperty(filters, property, value))}
                  onCompatibilityChange={reportDynamicCompatibility}
                />
              )
            }
            return (
              <StaticFilterControl
                key={property}
                description={fieldPresentation.description}
                descriptionId={descriptionId}
                disabled={disabled}
                issues={issues.filter((issue) =>
                  issue.path === pointer || issue.path.startsWith(`${pointer}/`))}
                label={fieldPresentation.label}
                presentation={fieldPresentation}
                required={required}
                schema={schema}
                value={filters[property]}
                onChange={(value) => onChange(withProperty(filters, property, value))}
              />
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

export function ConnectorSynchronizationConfiguration({
  allowMissingRootRequired,
  config,
  declaration,
  disabled,
  instanceId,
  onChange,
}: {
  allowMissingRootRequired: boolean
  config: Record<string, unknown>
  declaration: ConnectorVersionedRendererSchema
  disabled: boolean
  instanceId: string
  onChange: (config: Record<string, unknown>) => void
}) {
  const schema = declaration.schema
  if (!('type' in schema) || schema.type !== 'object') return null
  const presentationCompatibility = evaluateVersionedPresentationCompatibility(declaration)
  const issues = presentationCompatibility.compatible
    ? validateConnectorConfigPersistenceValue(schema, config, { allowMissingRootRequired })
    : []
  return (
    <section className="grid gap-4 border-y border-border/70 py-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium text-foreground">Synchronization configuration</h3>
        <p className="text-xs text-muted-foreground">
          Tune how this connector synchronizes independently of provider sourcing filters.
        </p>
      </div>
      {!presentationCompatibility.compatible ? (
        <Alert role="alert" variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Saved configuration is not compatible</AlertTitle>
          <AlertDescription>
            <p>{presentationCompatibility.message}</p>
          </AlertDescription>
        </Alert>
      ) : issues.length > 0 ? (
        <Alert role="alert" variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Saved configuration is not compatible</AlertTitle>
          <AlertDescription>
            {issues.map((issue) => {
              const field = presentationFieldForPointer(declaration, issue.path)
              return (
                <p key={`${issue.path}:${issue.message}`}>
                  {field?.label ?? pointerLeaf(issue.path)}:{' '}
                  {displayValue(valueAtPointer(config, issue.path))}{' '}
                  {issue.message}.
                </p>
              )
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {presentationCompatibility.compatible ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(schema.properties).map(([property, propertySchema]) => {
            const pointer = `/${escapePointer(property)}`
            const fieldPresentation = presentationFieldForPointer(declaration, pointer)
            if (!fieldPresentation) return null
            return (
              <StaticFilterControl
                key={property}
                description={fieldPresentation.description}
                descriptionId={`${instanceId}-config-${encodeURIComponent(pointer)}-description`}
                disabled={disabled}
                issues={issues.filter((issue) =>
                  issue.path === pointer || issue.path.startsWith(`${pointer}/`))}
                label={fieldPresentation.label}
                presentation={fieldPresentation}
                required={schema.required?.includes(property) === true}
                schema={propertySchema}
                value={config[property]}
                onChange={(value) => onChange(withProperty(config, property, value))}
              />
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function DynamicFilterControl({
  api,
  binding,
  description,
  descriptionId,
  descriptor,
  disabled,
  filters,
  instanceId,
  label,
  onChange,
  onCompatibilityChange,
  source,
  value,
}: {
  api: OptionsApi
  binding: DynamicBinding
  description: string
  descriptionId: string
  descriptor: InstalledConnectorDescriptor
  disabled: boolean
  filters: Record<string, unknown>
  instanceId: string
  label: string
  onChange: (value: unknown) => void
  onCompatibilityChange: (
    pointer: string,
    state: DynamicCompatibilityState | null,
  ) => void
  source: DynamicOptions['sources'][number]
  value: unknown
}) {
  const selectedValues = useMemo(() => binding.cardinality === 'many'
    ? (Array.isArray(value) ? value : [])
    : (value === undefined ? [] : [value]), [binding.cardinality, value])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ConnectorOption[]>([])
  const [queryState, setQueryState] = useState<
    'idle' | 'loading' | 'empty' | 'auth' | 'error' | 'too_long'
  >('idle')
  const [queryError, setQueryError] = useState<Extract<ConnectorOptionQueryResult, { status: 'error' }> | null>(null)
  const [resolveCompatibility, setResolveCompatibility] = useState<DynamicCompatibilityState | null>(null)
  const [dependencyClearFeedback, setDependencyClearFeedback] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [resolveAttempt, setResolveAttempt] = useState(0)
  const generation = useRef(0)
  const knownSelectedValues = useRef(new Set<string>())
  const activeOption = useRef<ConnectorOption | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousDependencySnapshot = useRef<{
    filterValues: Record<string, string>
    resolutionContextKey: string
    stableAuthorizationScopeKey: string
    selectedValueKeys: string[]
  } | null>(null)
  const authorizedClearSelectionKeys = useRef<string[] | null>(null)
  const selectedValuesRef = useRef(selectedValues)
  selectedValuesRef.current = selectedValues
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const dependencies = useMemo(() => readDependencies(source, filters), [filters, source])
  const dependencyFilterValues = useMemo(
    () => dependencyFilterValueSnapshot(source, filters),
    [filters, source],
  )
  const dependencyDeclarationFingerprint = useMemo(
    () => dependencyDeclarationScopeFingerprint(source),
    [source],
  )
  const dependenciesReady = dependencies !== null
  const identity = useMemo(
    () => expectedIdentity(descriptor, source.version),
    [descriptor, source.version],
  )
  const stableAuthorizationScopeKey = useMemo(() => JSON.stringify({
    instanceId,
    sourceId: source.id,
    ...identity,
    dependencyDeclarations: dependencyDeclarationFingerprint,
  }), [dependencyDeclarationFingerprint, identity, instanceId, source.id])
  const resolutionContextKey = useMemo(() => dynamicResolutionContextKey({
    dependencies,
    dependencyDeclarations: dependencyDeclarationFingerprint,
    identity,
    instanceId,
    sourceId: source.id,
  }), [dependencies, dependencyDeclarationFingerprint, identity, instanceId, source.id])
  const reportResolveCompatibility = useCallback((state: DynamicCompatibilityState | null) => {
    setResolveCompatibility(state)
    onCompatibilityChange(binding.filterPointer, state)
  }, [binding.filterPointer, onCompatibilityChange])
  const listboxId = `${instanceId}-${source.id}-${binding.intent}-${encodeURIComponent(binding.filterPointer)}-options`

  useEffect(() => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
    searchController.current?.abort()
    searchController.current = null
    generation.current += 1
    setResults([])
    setQueryState('idle')
    setQueryError(null)
    setActiveIndex(-1)
    activeOption.current = null
  }, [resolutionContextKey])

  useEffect(() => {
    const previous = previousDependencySnapshot.current
    const valuesChanged = dependencyFilterValuesChanged(
      previous?.filterValues ?? null,
      dependencyFilterValues,
    )
    const stableScopeChanged = previous !== null
      && previous.stableAuthorizationScopeKey !== stableAuthorizationScopeKey
    const selected = selectedValuesRef.current
    const currentSelectedKeys = selectionValueKeys(selected)
    if (stableScopeChanged) {
      authorizedClearSelectionKeys.current = null
      if (valuesChanged) setDependencyClearFeedback(null)
    } else if (valuesChanged && previous) {
      const previousKeys = previous.selectedValueKeys
      authorizedClearSelectionKeys.current = currentSelectedKeys.length > 0
        && selectionValueKeysEqual(currentSelectedKeys, previousKeys)
        && selected.every((value) => knownSelectedValues.current.has(
          knownDynamicValueKey(previous.resolutionContextKey, value),
        ))
        ? currentSelectedKeys
        : null
      setDependencyClearFeedback(null)
    }
    previousDependencySnapshot.current = {
      filterValues: dependencyFilterValues,
      resolutionContextKey,
      stableAuthorizationScopeKey,
      selectedValueKeys: currentSelectedKeys,
    }
  }, [
    dependencyFilterValues,
    resolutionContextKey,
    selectedValues,
    stableAuthorizationScopeKey,
  ])

  useEffect(() => {
    const authorizedKeys = authorizedClearSelectionKeys.current
    if (authorizedKeys === null) return
    if (!selectionValueKeysEqual(authorizedKeys, selectionValueKeys(selectedValues))) {
      authorizedClearSelectionKeys.current = null
    }
  }, [selectedValues])

  useEffect(() => {
    if (selectedValues.length === 0) {
      authorizedClearSelectionKeys.current = null
      reportResolveCompatibility(null)
      return
    }
    if (!source.operations.resolve) {
      authorizedClearSelectionKeys.current = null
      reportResolveCompatibility({ status: 'unverifiable', reason: 'resolve_unavailable' })
      return
    }
    if (!dependenciesReady) {
      authorizedClearSelectionKeys.current = null
      reportResolveCompatibility({ status: 'unverifiable', reason: 'dependencies_unavailable' })
      return
    }
    if (selectedValues.every((selected) => knownSelectedValues.current.has(
      knownDynamicValueKey(resolutionContextKey, selected),
    ))) {
      authorizedClearSelectionKeys.current = null
      reportResolveCompatibility(null)
      return
    }
    const controller = new AbortController()
    const resolveContextKey = resolutionContextKey
    const authorizedKeys = authorizedClearSelectionKeys.current
    const clearAuthorized = authorizedKeys !== null
      && selectionValueKeysEqual(authorizedKeys, selectionValueKeys(selectedValues))
    reportResolveCompatibility({ status: 'pending' })
    void api.query({
      connectorInstanceId: instanceId,
      body: { sourceId: source.id, dependencies, operation: { kind: 'resolve', values: selectedValues } },
      expectedIdentity: identity,
    }, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      if (result.status === 'resolve_ready') {
        for (const option of result.options) {
          knownSelectedValues.current.add(knownDynamicValueKey(resolveContextKey, option.value))
        }
        const accounting = accountResolveSelectedValues(
          selectedValues,
          result.options,
          result.unknownValues,
        )
        const stillAuthorized = clearAuthorized
          && authorizedClearSelectionKeys.current !== null
          && selectionValueKeysEqual(
            authorizedClearSelectionKeys.current,
            selectionValueKeys(selectedValues),
          )
        const transition = stillAuthorized && accounting.unresolved.length === 0
          ? dependencyTransitionClearDecision(selectedValues, accounting.explicitUnknown)
          : null
        if (transition) {
          authorizedClearSelectionKeys.current = null
          setDependencyClearFeedback(formatDependencyClearFeedback(
            label,
            transition.cleared,
            labelsRef.current,
          ))
          reportResolveCompatibility(null)
          onChangeRef.current(binding.cardinality === 'many'
            ? transition.remaining
            : transition.remaining[0])
          setLabels((current) => ({
            ...Object.fromEntries(result.options.map((option) => [valueKey(option.value), option.label])),
            ...current,
          }))
          return
        }
        authorizedClearSelectionKeys.current = null
        const blockingValues = [...accounting.explicitUnknown, ...accounting.unresolved]
        reportResolveCompatibility(blockingValues.length > 0
          ? { status: 'unknown', values: blockingValues }
          : null)
        setLabels((current) => ({
          ...Object.fromEntries(result.options.map((option) => [valueKey(option.value), option.label])),
          ...current,
        }))
      } else if (result.status === 'auth_required') {
        reportResolveCompatibility({ status: 'auth_required' })
      } else if (result.status === 'error') {
        reportResolveCompatibility({
          status: 'error',
          retryable: result.retryable,
        })
      } else {
        reportResolveCompatibility({ status: 'error', retryable: true })
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        reportResolveCompatibility({ status: 'error', retryable: true })
      }
    })
    return () => controller.abort()
  }, [
    api,
    binding.cardinality,
    binding.filterPointer,
    dependencies,
    dependenciesReady,
    identity,
    instanceId,
    label,
    reportResolveCompatibility,
    resolveAttempt,
    resolutionContextKey,
    selectedValues,
    source,
  ])

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchController.current?.abort()
  }, [])

  function runSearch(nextSearch: string, debounce = true) {
    setSearch(nextSearch)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchController.current?.abort()
    const currentGeneration = ++generation.current
    if (dependencies === null || nextSearch.length < source.operations.search.minSearchLength) {
      setResults([])
      setQueryState('idle')
      setQueryError(null)
      setActiveIndex(-1)
      return
    }
    if (nextSearch.length > source.operations.search.maxSearchLength) {
      setResults([])
      setQueryState('too_long')
      setQueryError(null)
      setActiveIndex(-1)
      return
    }
    setResults([])
    setQueryState('idle')
    setQueryError(null)
    setActiveIndex(-1)
    activeOption.current = null
    const execute = () => executeSearch(nextSearch, currentGeneration, dependencies)
    if (debounce) searchTimer.current = setTimeout(execute, 150)
    else execute()
  }

  function executeSearch(
    nextSearch: string,
    currentGeneration: number,
    queryDependencies: NonNullable<typeof dependencies>,
  ) {
    const controller = new AbortController()
    searchController.current = controller
    setQueryState('loading')
    void api.query({
      connectorInstanceId: instanceId,
      body: {
        sourceId: source.id,
        dependencies: queryDependencies,
        operation: {
          kind: 'search',
          search: nextSearch,
          limit: source.operations.search.defaultLimit,
        },
      },
      expectedIdentity: identity,
    }, { signal: controller.signal }).then((result) => {
      if (currentGeneration !== generation.current || controller.signal.aborted) return
      if (result.status === 'search_ready') {
        setResults(result.options)
        setQueryState(result.options.length > 0 ? 'idle' : 'empty')
        setQueryError(null)
      } else {
        setResults([])
        setQueryError(result.status === 'error' ? result : null)
        setQueryState(result.status === 'auth_required'
          ? 'auth'
          : result.status === 'error'
            ? 'error'
            : result.status === 'cancelled'
              ? 'idle'
              : 'empty')
      }
    }).catch(() => {
      if (currentGeneration === generation.current && !controller.signal.aborted) {
        setResults([])
        setQueryError(null)
        setQueryState('error')
      }
    })
  }

  function selectOption(option: ConnectorOption) {
    knownSelectedValues.current.add(knownDynamicValueKey(resolutionContextKey, option.value))
    setLabels((current) => ({ ...current, [valueKey(option.value)]: option.label }))
    onChange(binding.cardinality === 'many'
      ? [...selectedValues.filter((candidate) => valueKey(candidate) !== valueKey(option.value)), option.value]
      : option.value)
    setResults([])
    setQueryState('idle')
    setQueryError(null)
    setActiveIndex(-1)
    activeOption.current = null
    setSearch('')
  }

  function dismissResults() {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchController.current?.abort()
    generation.current += 1
    setResults([])
    setQueryState('idle')
    setQueryError(null)
    setActiveIndex(-1)
    activeOption.current = null
  }

  return (
    <div className={`grid gap-2 rounded-md border p-3 ${binding.intent === 'include' ? 'border-border' : 'border-dashed border-border'}`}>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <Input
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-describedby={descriptionId}
          aria-activedescendant={activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined}
          aria-expanded={results.length > 0}
          aria-label={label}
          disabled={disabled || !dependenciesReady}
          role="combobox"
          value={search}
          onChange={(event) => runSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              dismissResults()
            } else if (event.key === 'Tab') {
              dismissResults()
            } else if (event.key === 'ArrowDown' && results.length > 0) {
              event.preventDefault()
              setActiveIndex((current) => {
                const next = Math.min(current + 1, results.length - 1)
                activeOption.current = results[next] ?? null
                return next
              })
            } else if (event.key === 'ArrowUp' && results.length > 0) {
              event.preventDefault()
              setActiveIndex((current) => {
                const next = Math.max(current - 1, 0)
                activeOption.current = results[next] ?? null
                return next
              })
            } else if (event.key === 'Enter' && (results[activeIndex] || activeOption.current)) {
              event.preventDefault()
              selectOption(results[activeIndex] ?? activeOption.current!)
            }
          }}
        />
        <p id={descriptionId} className="text-xs text-muted-foreground">{description}</p>
      </label>
      {!dependenciesReady ? <p className="text-xs text-muted-foreground">Complete the dependent filters first.</p> : null}
      {dependencyClearFeedback ? (
        <p className="break-words text-xs text-muted-foreground" role="status">
          {dependencyClearFeedback}
        </p>
      ) : null}
      {queryState !== 'idle' ? (
        <p className="text-xs text-muted-foreground" role="status">
          {queryState === 'loading'
            ? 'Searching provider options…'
            : queryState === 'empty'
              ? 'No matching provider options.'
              : queryState === 'auth'
                ? 'Provider authentication is required.'
                : queryState === 'too_long'
                  ? `Search must contain at most ${source.operations.search.maxSearchLength} characters.`
                : queryError?.code === 'provider_rejected' || queryError?.retryable === false
                  ? 'The provider rejected this search and it cannot be retried.'
                  : 'Provider options are temporarily unavailable.'}
        </p>
      ) : null}
      {queryState === 'error' && queryError?.retryable ? (
        <button
          className="w-fit text-xs font-medium text-foreground underline underline-offset-2"
          disabled={disabled}
          type="button"
          onClick={() => runSearch(search, false)}
        >
          Retry
        </button>
      ) : null}
      {selectedValues.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((selected) => (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs" key={valueKey(selected)}>
              {labels[valueKey(selected)] ?? displayValue(selected)}
              <button
                aria-label={`Remove ${labels[valueKey(selected)] ?? displayValue(selected)}`}
                className="text-muted-foreground hover:text-foreground"
                disabled={disabled}
                type="button"
                onClick={() => onChange(binding.cardinality === 'many'
                  ? selectedValues.filter((candidate) => valueKey(candidate) !== valueKey(selected))
                  : undefined)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onChange(binding.cardinality === 'many'
                    ? selectedValues.filter((candidate) => valueKey(candidate) !== valueKey(selected))
                    : undefined)
                }}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {(resolveCompatibility?.status === 'error' && resolveCompatibility.retryable)
        || resolveCompatibility?.status === 'auth_required' ? (
        <button
          className="w-fit text-xs font-medium text-foreground underline underline-offset-2"
          disabled={disabled}
          type="button"
          onClick={() => setResolveAttempt((attempt) => attempt + 1)}
        >
          Retry
        </button>
      ) : null}
      {results.length > 0 ? (
        <div className="grid gap-1 rounded-md border border-border bg-popover p-1" id={listboxId} role="listbox">
          {results.map((option, index) => (
            <button
              aria-selected={activeIndex === index}
              className="rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              id={`${listboxId}-option-${index}`}
              key={option.key}
              role="option"
              tabIndex={-1}
              type="button"
              onClick={() => selectOption(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function expectedIdentity(
  descriptor: InstalledConnectorDescriptor,
  sourceVersion: string,
) {
  return {
    connectorId: descriptor.connectorId,
    connectorVersion: descriptor.connectorVersion,
    filterSchemaVersion: descriptor.filterSchema!.version,
    catalogVersion: descriptor.dynamicOptions!.version,
    sourceVersion,
  }
}

function dynamicResolutionContextKey({
  dependencies,
  dependencyDeclarations,
  identity,
  instanceId,
  sourceId,
}: {
  dependencies: ReturnType<typeof readDependencies>
  dependencyDeclarations: string
  identity: ReturnType<typeof expectedIdentity>
  instanceId: string
  sourceId: string
}) {
  return JSON.stringify({
    instanceId,
    sourceId,
    ...identity,
    dependencyDeclarations,
    dependencies,
  })
}

function dependencyFilterValueSnapshot(
  source: DynamicOptions['sources'][number],
  filters: Record<string, unknown>,
) {
  const snapshot: Record<string, string> = {}
  for (const dependency of source.dependencies ?? []) {
    snapshot[dependency.filterPointer] = dependencyFilterValueToken(
      valueAtPointer(filters, dependency.filterPointer),
    )
  }
  return snapshot
}

function dependencyFilterValuesChanged(
  previous: Record<string, string> | null,
  current: Record<string, string>,
) {
  if (previous === null) return false
  for (const [pointer, currentValue] of Object.entries(current)) {
    if (Object.prototype.hasOwnProperty.call(previous, pointer) && previous[pointer] !== currentValue) {
      return true
    }
  }
  return false
}

function dependencyFilterValueToken(value: unknown) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (value === '') return 'empty'
  return valueKey(value)
}

function dependencyDeclarationScopeFingerprint(source: DynamicOptions['sources'][number]) {
  return JSON.stringify((source.dependencies ?? []).map((dependency) => ({
    id: dependency.id,
    filterPointer: dependency.filterPointer,
    cardinality: dependency.cardinality,
    required: dependency.required,
  })))
}

function readDependencies(
  source: DynamicOptions['sources'][number],
  filters: Record<string, unknown>,
) {
  const dependencies: Record<string, string | number | boolean | Record<string, string | number | boolean> | Array<string | number | boolean | Record<string, string | number | boolean>>> = {}
  for (const dependency of source.dependencies ?? []) {
    const value = valueAtPointer(filters, dependency.filterPointer)
    if (value === undefined || value === null || value === '') {
      if (dependency.required) return null
      continue
    }
    dependencies[dependency.id] = value as typeof dependencies[string]
  }
  return dependencies
}

function withProperty(filters: Record<string, unknown>, property: string, value: unknown) {
  const next = { ...filters }
  if (value === undefined || value === '') delete next[property]
  else next[property] = value
  return next
}

function valueAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return root
  let current = root
  for (const encoded of pointer.replace(/^\//, '').split('/')) {
    if (current === null || typeof current !== 'object') return undefined
    const segment = encoded.replace(/~1/g, '/').replace(/~0/g, '~')
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function pointerLeaf(pointer: string) {
  return pointer.split('/').at(-1)?.replace(/~1/g, '/').replace(/~0/g, '~') ?? pointer
}
