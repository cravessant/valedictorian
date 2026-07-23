import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ValedictorianHttpError,
  ValedictorianTransportError,
  valedictorianFailureKindMessages,
} from '@sparxie/sdk'
import { PolicySettingsPanel } from './PolicySettingsPanel'
import { createPolicyApi } from '../App.test-helpers'

afterEach(cleanup)

describe('PolicySettingsPanel load surface selection', () => {
  it('renders AuthenticationFailure with Retry for typed authentication load failures', async () => {
    const policyApi = createPolicyApi()
    const defaultConfig = await policyApi.config.get()
    vi.mocked(policyApi.config.get)
      .mockRejectedValueOnce(new ValedictorianHttpError({
        body: null,
        kind: 'authentication',
        message: 'policy auth dump /secret',
        status: 401,
      }))
      .mockResolvedValueOnce(defaultConfig)

    render(<PolicySettingsPanel policyApi={policyApi} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'authentication-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.authentication)
    expect(alert).not.toHaveTextContent('/secret')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(policyApi.config.get).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('button', { name: 'Save Action Queue decisions' })).toBeInTheDocument()
  })

  it('renders GlobalFailureAlert with Retry for typed transport unavailability', async () => {
    const policyApi = createPolicyApi()
    const defaultConfig = await policyApi.config.get()
    vi.mocked(policyApi.config.get)
      .mockRejectedValueOnce(new ValedictorianTransportError({
        cause: new Error('ECONNREFUSED /var/policy/secret'),
      }))
      .mockResolvedValueOnce(defaultConfig)

    render(<PolicySettingsPanel policyApi={policyApi} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-slot', 'global-failure')
    expect(alert).toHaveTextContent(valedictorianFailureKindMessages.unavailable)
    expect(alert).not.toHaveTextContent('ECONNREFUSED')
    expect(document.querySelector('[data-slot="scoped-load-failure"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(policyApi.config.get).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('button', { name: 'Save Action Queue decisions' })).toBeInTheDocument()
  })
})
