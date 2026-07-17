import {
  createScanner,
  findNodeAtLocation,
  parseTree,
  type Node,
  type ParseError,
} from 'jsonc-parser'
import {
  profileDocumentSchemaVersion,
  userProfileSchema,
  type ProfileDocument,
  type UserProfile,
} from 'sparxie'
import { z } from 'zod'
import {
  invalidProfileDocumentError,
  issuePath,
  profileDocumentError,
  type ProfileCapabilityError,
} from './profile.errors'
import { mergeProfile, normalizeProfilePatch } from './profile.normalize'
import { computeProfileRevision } from './profile.revision'

const onDiskProfileDocumentSchema = z
  .object({
    profile: userProfileSchema,
    schemaVersion: z.number(),
  })
  .strict()

export function serializeProfileJsonDocument(document: ProfileDocument): string {
  return `${JSON.stringify(
    {
      schemaVersion: document.schemaVersion,
      profile: document.profile,
    },
    null,
    2,
  )}\n`
}

export function parseProfileJsonDocument(
  text: string,
  filePath: string,
): { document: ProfileDocument; text: string } {
  rejectCommentsAndTrailingCommas(text, filePath)
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { allowEmptyContent: false, disallowComments: true })
  if (!tree || errors.length > 0) {
    const error = errors[0]
    const location = error ? offsetToLocation(text, error.offset) : undefined
    throw invalidProfileDocumentError([], location, filePath)
  }

  const duplicate = findDuplicateKey(tree, text)
  if (duplicate) {
    throw invalidProfileDocumentError(duplicate.path, duplicate.location, filePath)
  }

  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw invalidProfileDocumentError([], undefined, filePath)
  }

  return {
    document: validateOnDiskDocument(value, tree, text, filePath),
    text,
  }
}

function validateOnDiskDocument(
  value: unknown,
  tree: Node,
  text: string,
  filePath: string,
): ProfileDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidProfileDocumentError([], offsetToLocation(text, tree.offset), filePath)
  }

  const record = value as Record<string, unknown>
  if (typeof record.schemaVersion === 'number' && record.schemaVersion !== profileDocumentSchemaVersion) {
    const location = locationForPath(tree, text, ['schemaVersion'])
    throw profileDocumentError('unsupported_profile_schema_version', {
      filePath,
      details: {
        filePath,
        path: ['schemaVersion'],
        ...location,
      },
    })
  }

  const parsed = onDiskProfileDocumentSchema.safeParse(value)
  if (!parsed.success) {
    throw zodIssueToError(parsed.error, tree, text, filePath)
  }

  const profile = normalizeOnDiskProfile(parsed.data.profile)
  return {
    profile,
    revision: computeProfileRevision(profile),
    schemaVersion: profileDocumentSchemaVersion,
  }
}

function normalizeOnDiskProfile(profile: UserProfile): UserProfile {
  const patch = normalizeProfilePatch(profile, { pathPrefix: ['profile'] })
  return mergeProfile(profile, patch)
}

function zodIssueToError(
  error: z.ZodError,
  tree: Node,
  text: string,
  filePath: string,
): ProfileCapabilityError {
  const issue = error.issues[0] as
    | (z.ZodIssue & { keys?: string[] })
    | undefined
  const unrecognizedKey = issue?.code === 'unrecognized_keys' ? issue.keys?.[0] : undefined
  const path =
    unrecognizedKey === undefined
      ? issuePath(issue?.path)
      : [...issuePath(issue?.path), unrecognizedKey]
  const location = locationForPath(tree, text, path)
  return invalidProfileDocumentError(path, location, filePath)
}

function locationForPath(
  tree: Node,
  text: string,
  path: ReadonlyArray<string | number>,
): { line: number; column: number } | undefined {
  if (path.length === 0) return offsetToLocation(text, tree.offset)

  const valueNode = findNodeAtLocation(tree, [...path])
  if (valueNode) return offsetToLocation(text, valueNode.offset)

  // For unknown keys, prefer the property key node when the value path is absent.
  if (path.length > 0) {
    const parentPath = path.slice(0, -1)
    const key = path[path.length - 1]
    if (typeof key === 'string') {
      const parent = parentPath.length === 0 ? tree : findNodeAtLocation(tree, [...parentPath])
      if (parent?.type === 'object' && parent.children) {
        for (const property of parent.children) {
          const keyNode = property.children?.[0]
          if (keyNode?.type === 'string' && keyNode.value === key) {
            return offsetToLocation(text, keyNode.offset)
          }
        }
      }
    }
  }

  return undefined
}

function rejectCommentsAndTrailingCommas(text: string, filePath: string): void {
  // jsonc-parser exposes SyntaxKind as an ambient const enum; use stable numeric values.
  const CloseBraceToken = 2
  const CloseBracketToken = 4
  const CommaToken = 5
  const LineCommentTrivia = 12
  const BlockCommentTrivia = 13
  const LineBreakTrivia = 14
  const Trivia = 15
  const EOF = 17

  const scanner = createScanner(text, false)
  while (scanner.scan() !== EOF) {
    const token = scanner.getToken()
    if (token === LineCommentTrivia || token === BlockCommentTrivia) {
      throw invalidProfileDocumentError(
        [],
        { line: scanner.getTokenStartLine() + 1, column: scanner.getTokenStartCharacter() + 1 },
        filePath,
      )
    }
    if (token === CommaToken) {
      const afterCommaOffset = scanner.getTokenOffset() + scanner.getTokenLength()
      const lookahead = createScanner(text, false)
      lookahead.setPosition(afterCommaOffset)
      let next = lookahead.scan()
      while (next === Trivia || next === LineBreakTrivia) {
        next = lookahead.scan()
      }
      if (next === CloseBraceToken || next === CloseBracketToken) {
        throw invalidProfileDocumentError(
          [],
          { line: scanner.getTokenStartLine() + 1, column: scanner.getTokenStartCharacter() + 1 },
          filePath,
        )
      }
    }
  }
}

function findDuplicateKey(
  node: Node,
  text: string,
  path: Array<string | number> = [],
): { path: Array<string | number>; location: { line: number; column: number } } | null {
  if (node.type === 'object' && node.children) {
    const seen = new Map<string, Node>()
    for (const property of node.children) {
      const keyNode = property.children?.[0]
      const valueNode = property.children?.[1]
      if (!keyNode || keyNode.type !== 'string' || keyNode.value === undefined) continue
      const key = String(keyNode.value)
      const existing = seen.get(key)
      if (existing) {
        return {
          path: [...path, key],
          location: offsetToLocation(text, keyNode.offset),
        }
      }
      seen.set(key, property)
      if (valueNode) {
        const nested = findDuplicateKey(valueNode, text, [...path, key])
        if (nested) return nested
      }
    }
  }

  if (node.type === 'array' && node.children) {
    for (let index = 0; index < node.children.length; index += 1) {
      const child = node.children[index]
      if (!child) continue
      const nested = findDuplicateKey(child, text, [...path, index])
      if (nested) return nested
    }
  }

  return null
}

function offsetToLocation(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let column = 1
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}
