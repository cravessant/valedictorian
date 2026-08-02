import {
  sign,
  verify,
  type KeyObject,
} from 'node:crypto'
import type { WorkspaceReceipt } from '@sparxie/valedictorian-workspace-server'
import { canonicalJson } from './workspace-migration-canonical.js'

export interface WorkspaceReceiptAuthority {
  authorityId: string
  keyId: string
  privateKey?: KeyObject
  publicKey: KeyObject
}

export interface AuthenticatedWorkspaceReceipt {
  authentication: WorkspaceDocumentAuthentication
  receipt: WorkspaceReceipt
}

export interface WorkspaceDocumentAuthentication {
  algorithm: 'Ed25519'
  keyId: string
  signature: string
}

export interface AuthenticatedWorkspaceDocument<T> {
  authentication: WorkspaceDocumentAuthentication
  document: T
}

export function authenticateWorkspaceReceipt(
  receipt: WorkspaceReceipt,
  authority: WorkspaceReceiptAuthority,
): AuthenticatedWorkspaceReceipt {
  if (receipt.authorityId !== authority.authorityId) {
    throw new TypeError('Receipt authority does not match its signing authority.')
  }
  if (!authority.privateKey) {
    throw new TypeError('Receipt signing requires the issuing authority private key.')
  }
  const payload = Buffer.from(canonicalReceipt(receipt))
  return Object.freeze({
    authentication: Object.freeze({
      algorithm: 'Ed25519' as const,
      keyId: authority.keyId,
      signature: sign(null, payload, authority.privateKey).toString('base64'),
    }),
    receipt,
  })
}

export function verifyWorkspaceReceipt(
  envelope: AuthenticatedWorkspaceReceipt,
  authority: WorkspaceReceiptAuthority,
): void {
  if (
    envelope.receipt.authorityId !== authority.authorityId
    || envelope.authentication.algorithm !== 'Ed25519'
    || envelope.authentication.keyId !== authority.keyId
    || !verify(
      null,
      Buffer.from(canonicalReceipt(envelope.receipt)),
      authority.publicKey,
      Buffer.from(envelope.authentication.signature, 'base64'),
    )
  ) {
    throw new Error('Workspace migration receipt authentication failed.')
  }
}

export function authenticateWorkspaceDocument<T>(
  document: T,
  authority: WorkspaceReceiptAuthority,
): AuthenticatedWorkspaceDocument<T> {
  if (!authority.privateKey) {
    throw new TypeError('Document signing requires the issuing authority private key.')
  }
  return Object.freeze({
    authentication: Object.freeze({
      algorithm: 'Ed25519' as const,
      keyId: authority.keyId,
      signature: sign(
        null,
        Buffer.from(canonicalJson(document)),
        authority.privateKey,
      ).toString('base64'),
    }),
    document,
  })
}

export function verifyWorkspaceDocument<T>(
  envelope: AuthenticatedWorkspaceDocument<T>,
  authority: WorkspaceReceiptAuthority,
): void {
  if (
    envelope.authentication.algorithm !== 'Ed25519'
    || envelope.authentication.keyId !== authority.keyId
    || !verify(
      null,
      Buffer.from(canonicalJson(envelope.document)),
      authority.publicKey,
      Buffer.from(envelope.authentication.signature, 'base64'),
    )
  ) {
    throw new Error('Workspace migration checkpoint authentication failed.')
  }
}

function canonicalReceipt(receipt: WorkspaceReceipt): string {
  return canonicalJson(receipt)
}
