import { describe, expect, it } from 'vitest'
import {
  invalidProfileDocumentError,
  ProfileCapabilityError,
  profileDocumentError,
} from './profile.errors.js'
import {
  parseProfileJsonDocument,
  serializeProfileJsonDocument,
} from './profile.json.document.js'
import { mergeProfile, normalizeProfilePatch } from './profile.normalize.js'
import { computeProfileRevision, emptyProfileDocument } from './profile.revision.js'

describe('profile JSON document parse/serialize', () => {
  const filePath = '/tmp/workspace/.valedictorian/profile.json'

  it('parses a strict on-disk document and derives revision without trusting a revision field', () => {
    const empty = emptyProfileDocument()
    const text = serializeProfileJsonDocument(empty)
    expect(JSON.parse(text)).toEqual({
      schemaVersion: 1,
      profile: empty.profile,
    })
    expect(text).not.toContain('"revision"')
    expect(text.endsWith('\n')).toBe(true)

    const parsed = parseProfileJsonDocument(text, filePath)
    expect(parsed.document).toEqual(empty)
    expect(parsed.document.revision).toBe(empty.revision)
  })

  it('rejects malformed syntax with line and column and local filePath detail', () => {
    expect(() => parseProfileJsonDocument('{', filePath)).toThrow(ProfileCapabilityError)
    try {
      parseProfileJsonDocument('{\n  "schemaVersion":\n', filePath)
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        filePath,
        body: expect.objectContaining({
          code: 'invalid_profile_document',
          path: [],
          line: expect.any(Number),
          column: expect.any(Number),
        }),
      })
      expect(JSON.stringify((error as ProfileCapabilityError).body)).not.toContain(filePath)
    }
  })

  it('rejects duplicate keys at every nesting level before schema validation', () => {
    const text = `{
  "schemaVersion": 1,
  "profile": {
    "email": "one@example.com",
    "email": "two@example.com",
    "answers": [],
    "education": []
  }
}`
    try {
      parseProfileJsonDocument(text, filePath)
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        filePath,
        body: expect.objectContaining({
          path: ['profile', 'email'],
          line: expect.any(Number),
          column: expect.any(Number),
        }),
      })
    }
  })

  it('maps unknown numeric schema versions to unsupported_profile_schema_version', () => {
    const text = JSON.stringify({
      schemaVersion: 99,
      profile: emptyProfileDocument().profile,
    })
    try {
      parseProfileJsonDocument(text, filePath)
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'unsupported_profile_schema_version',
        filePath,
        body: {
          code: 'unsupported_profile_schema_version',
          message: 'The profile document schema version is unsupported.',
        },
      })
    }
  })

  it('rejects unknown top-level fields, unknown profile fields, secret keys, and impossible values', () => {
    const unknownTopLevel = `{
  "schemaVersion": 1,
  "revision": "user-controlled",
  "profile": ${JSON.stringify(emptyProfileDocument().profile)}
}`
    try {
      parseProfileJsonDocument(unknownTopLevel, filePath)
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        body: expect.objectContaining({
          path: ['revision'],
          line: 3,
          column: expect.any(Number),
        }),
      })
    }

    try {
      parseProfileJsonDocument(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            profile: {
              ...emptyProfileDocument().profile,
              unexpected: true,
            },
          },
          null,
          2,
        )}\n`,
        filePath,
      )
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        body: expect.objectContaining({
          path: ['profile', 'unexpected'],
          line: expect.any(Number),
          column: expect.any(Number),
        }),
      })
    }

    try {
      parseProfileJsonDocument(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            profile: {
              ...emptyProfileDocument().profile,
              ssnLast4: '5125',
            },
          },
          null,
          2,
        )}\n`,
        filePath,
      )
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        body: expect.objectContaining({
          path: ['profile', 'ssnLast4'],
          line: expect.any(Number),
          column: expect.any(Number),
        }),
      })
    }

    try {
      parseProfileJsonDocument(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            profile: {
              ...emptyProfileDocument().profile,
              dateOfBirth: '2024-02-30',
            },
          },
          null,
          2,
        )}\n`,
        filePath,
      )
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        body: expect.objectContaining({
          path: ['profile', 'dateOfBirth'],
          line: expect.any(Number),
          column: expect.any(Number),
        }),
      })
    }
  })

  it('keeps unsupported schema version wire body canonical while attaching local-only details', () => {
    const text = `${JSON.stringify(
      {
        schemaVersion: 99,
        profile: emptyProfileDocument().profile,
      },
      null,
      2,
    )}\n`
    try {
      parseProfileJsonDocument(text, filePath)
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'unsupported_profile_schema_version',
        filePath,
        details: expect.objectContaining({
          filePath,
          path: ['schemaVersion'],
          line: expect.any(Number),
          column: expect.any(Number),
        }),
        body: {
          code: 'unsupported_profile_schema_version',
          message: 'The profile document schema version is unsupported.',
        },
      })
      expect(JSON.stringify((error as ProfileCapabilityError).body)).not.toContain(filePath)
      expect(JSON.stringify((error as ProfileCapabilityError).body)).not.toContain('schemaVersion')
    }
  })

  it('rejects comments and trailing commas', () => {
    expect(() =>
      parseProfileJsonDocument(
        `{
  // comment
  "schemaVersion": 1,
  "profile": ${JSON.stringify(emptyProfileDocument().profile)}
}`,
        filePath,
      ),
    ).toThrow(ProfileCapabilityError)

    expect(() =>
      parseProfileJsonDocument(
        `{
  "schemaVersion": 1,
  "profile": ${JSON.stringify(emptyProfileDocument().profile)},
}`,
        filePath,
      ),
    ).toThrow(ProfileCapabilityError)
  })

  it('keeps canonical error helpers available for non-document codes', () => {
    expect(profileDocumentError('profile_backup_unavailable').filePath).toBeUndefined()
    expect(invalidProfileDocumentError(['profile'], { line: 2, column: 3 }, filePath)).toMatchObject({
      filePath,
      body: { path: ['profile'], line: 2, column: 3 },
    })
  })

  it('runs shared profile normalization before deriving revision', () => {
    const empty = emptyProfileDocument().profile
    const rawProfile = {
      ...empty,
      email: '  kenny@example.com  ',
      answers: [
        {
          answer: 'Yes',
          category: null,
          includeInAgentContext: false,
          key: 'Work Authorization?',
          label: 'Work Authorization?',
          questionPattern: 'authorized',
        },
      ],
    }
    const text = `${JSON.stringify({ schemaVersion: 1, profile: rawProfile }, null, 2)}\n`
    const parsed = parseProfileJsonDocument(text, filePath)
    expect(parsed.document.profile.email).toBe('kenny@example.com')
    expect(parsed.document.profile.answers[0]?.key).toBe('work_authorization')

    const serviceNormalized = mergeProfile(
      emptyProfileDocument().profile,
      normalizeProfilePatch(
        {
          email: rawProfile.email,
          answers: rawProfile.answers,
        },
        { pathPrefix: ['profile'] },
      ),
    )
    expect(parsed.document.profile).toEqual(serviceNormalized)
    expect(parsed.document.revision).toBe(computeProfileRevision(serviceNormalized))

    const reserialized = serializeProfileJsonDocument(parsed.document)
    expect(reserialized).not.toBe(text)
    expect(parseProfileJsonDocument(reserialized, filePath).document).toEqual(parsed.document)

    try {
      parseProfileJsonDocument(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            profile: {
              ...empty,
              answers: [
                {
                  answer: '',
                  category: null,
                  includeInAgentContext: false,
                  key: 'k',
                  label: 'Label',
                  questionPattern: 'q',
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        filePath,
      )
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        body: expect.objectContaining({
          path: ['profile', 'answers', 0, 'answer'],
        }),
      })
    }

    try {
      parseProfileJsonDocument(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            profile: {
              ...empty,
              answers: [
                {
                  answer: 'x',
                  category: null,
                  includeInAgentContext: false,
                  key: 'k',
                  label: '   ',
                  questionPattern: 'q',
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
        filePath,
      )
      throw new Error('expected throw')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_profile_document',
        body: expect.objectContaining({
          path: ['profile', 'answers', 0, 'label'],
        }),
      })
    }
  })
})
