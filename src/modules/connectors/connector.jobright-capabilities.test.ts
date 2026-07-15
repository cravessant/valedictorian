import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectInstalledConnectorDescriptor } from './connector.capabilities'
import { createDefaultLocalConnectorRegistry } from './connector.registry'

describe('installed Jobright declarative capabilities', () => {
  const descriptor = projectInstalledConnectorDescriptor(
    createDefaultLocalConnectorRegistry().get('jobright.resolver')!,
  )

  it('declares every config, static filter, bounded enum, range, and required taxonomy field', () => {
    expect(Object.keys(descriptor.configSchema!.schema.properties)).toEqual([
      'discoveryCount',
      'maxRunElapsedMs',
      'maxRetryAttemptsPerSource',
    ])
    expect(Object.keys(descriptor.filterSchema!.schema.properties)).toEqual([
      'jobTaxonomyList',
      'excludedTitle',
      'locations',
      'minYearsOfExperienceRange',
      'jobTypes',
      'workModel',
      'country',
      'seniority',
      'daysAgo',
      'roleType',
      'companyStages',
      'annualSalaryMinimum',
      'isH1BOnly',
      'excludeSecurityClearance',
      'excludeUsCitizen',
      'excludeStaffingAgency',
      'companyCategory',
      'excludeCompanyCategory',
      'skills',
      'excludedSkills',
      'companies',
      'excludedCompanies',
    ])
    expect(descriptor.filterSchema!.schema.required).toEqual(['jobTaxonomyList'])
    expect(descriptor.filterSchema!.schema.properties.jobTypes).toMatchObject({
      type: 'array', items: { type: 'integer', enum: [1, 2, 3, 4] },
    })
    expect(descriptor.filterSchema!.schema.properties.daysAgo).toEqual({
      type: 'integer', enum: [1, 3, 7, 30],
    })
    expect(descriptor.filterSchema!.schema.properties.minYearsOfExperienceRange).toMatchObject({
      type: 'array', minItems: 2, maxItems: 2,
      items: { type: 'integer', minimum: 0, maximum: 11 },
    })
  })

  it('declares every named dynamic include/exclude binding without renderer provider branches', () => {
    expect(descriptor.dynamicOptions!.bindings).toEqual([
      { filterPointer: '/jobTaxonomyList', sourceId: 'jobright.taxonomy', cardinality: 'many', intent: 'include' },
      { filterPointer: '/excludedTitle', sourceId: 'jobright.title', cardinality: 'many', intent: 'exclude' },
      { filterPointer: '/companies', sourceId: 'jobright.company', cardinality: 'many', intent: 'include' },
      { filterPointer: '/excludedCompanies', sourceId: 'jobright.company', cardinality: 'many', intent: 'exclude' },
      { filterPointer: '/companyCategory', sourceId: 'jobright.industry', cardinality: 'many', intent: 'include' },
      { filterPointer: '/excludeCompanyCategory', sourceId: 'jobright.industry', cardinality: 'many', intent: 'exclude' },
      { filterPointer: '/skills', sourceId: 'jobright.skill', cardinality: 'many', intent: 'include' },
      { filterPointer: '/excludedSkills', sourceId: 'jobright.skill', cardinality: 'many', intent: 'exclude' },
      { filterPointer: '/locations', sourceId: 'jobright.location', cardinality: 'many', intent: 'include' },
    ])
    const rendererDirectory = path.resolve('src/settings/connector-filters')
    const rendererSource = fs.readdirSync(rendererDirectory)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.tsx'))
      .map((name) => fs.readFileSync(path.join(rendererDirectory, name), 'utf8'))
      .join('\n')
    expect(rendererSource).not.toMatch(/jobright/i)
  })
})
