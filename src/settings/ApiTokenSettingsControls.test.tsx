import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiTokenSettingsControls } from './ApiTokenSettingsControls'

const SAVED_CANARY = 'saved-ui-token-canary-1a2b'
const REPLACEMENT_CANARY = 'replacement-ui-token-canary-3c4d'

afterEach(() => {
  cleanup()
})

describe('ApiTokenSettingsControls', () => {
  it('sets a token from a local draft, clears the input, and shows configured status', async () => {
    const onSettingsPatch = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <ApiTokenSettingsControls apiTokenConfigured={false} onSettingsPatch={onSettingsPatch} />,
    )

    expect(screen.getByTestId('api-token-status')).toHaveTextContent('Not configured')
    expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('API token'), { target: { value: SAVED_CANARY } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    expect(onSettingsPatch).toHaveBeenCalledWith({ apiToken: SAVED_CANARY })
    await waitFor(() => {
      expect(screen.getByLabelText('API token')).toHaveValue('')
    })
    expect(screen.queryByDisplayValue(SAVED_CANARY)).not.toBeInTheDocument()
    expect(screen.queryByText(SAVED_CANARY)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(SAVED_CANARY)

    rerender(
      <ApiTokenSettingsControls apiTokenConfigured={true} onSettingsPatch={onSettingsPatch} />,
    )
    expect(screen.getByTestId('api-token-status')).toHaveTextContent('Configured')
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled()
    expect(screen.getByLabelText('API token')).toHaveValue('')
    expect(screen.queryByDisplayValue(SAVED_CANARY)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(SAVED_CANARY)
  })

  it('disables mutations while a save is pending and clears only after success', async () => {
    let resolvePatch!: () => void
    const onSettingsPatch = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolvePatch = resolve
      }),
    )
    render(
      <ApiTokenSettingsControls apiTokenConfigured={false} onSettingsPatch={onSettingsPatch} />,
    )

    fireEvent.change(screen.getByLabelText('API token'), { target: { value: SAVED_CANARY } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByLabelText('API token')).toBeDisabled()
    expect(screen.getByLabelText('API token')).toHaveValue(SAVED_CANARY)

    resolvePatch()
    await waitFor(() => {
      expect(screen.getByLabelText('API token')).toHaveValue('')
    })
    expect(document.body.textContent).not.toContain(SAVED_CANARY)
  })

  it('keeps the draft and shows a value-free failure when set fails, then allows retry', async () => {
    const onSettingsPatch = vi.fn()
      .mockRejectedValueOnce(new Error(`Secure storage failed for ${SAVED_CANARY}`))
      .mockResolvedValueOnce(undefined)
    render(
      <ApiTokenSettingsControls apiTokenConfigured={false} onSettingsPatch={onSettingsPatch} />,
    )

    fireEvent.change(screen.getByLabelText('API token'), { target: { value: SAVED_CANARY } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    await waitFor(() => {
      expect(screen.getByTestId('api-token-error')).toHaveTextContent('API token could not be saved.')
    })
    expect(screen.getByLabelText('API token')).toHaveValue(SAVED_CANARY)
    expect(screen.getByTestId('api-token-status')).toHaveTextContent('Not configured')
    expect(JSON.stringify(screen.getByTestId('api-token-error').textContent)).not.toContain(SAVED_CANARY)

    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    await waitFor(() => {
      expect(screen.getByLabelText('API token')).toHaveValue('')
    })
    expect(screen.queryByTestId('api-token-error')).not.toBeInTheDocument()
    expect(onSettingsPatch).toHaveBeenCalledTimes(2)
  })

  it('keeps configured status and draft when replace fails', async () => {
    const onSettingsPatch = vi.fn().mockRejectedValue(
      new Error(`replace failed ${REPLACEMENT_CANARY}`),
    )
    render(
      <ApiTokenSettingsControls apiTokenConfigured={true} onSettingsPatch={onSettingsPatch} />,
    )

    fireEvent.change(screen.getByLabelText('API token'), {
      target: { value: REPLACEMENT_CANARY },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))

    await waitFor(() => {
      expect(screen.getByTestId('api-token-error')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('API token')).toHaveValue(REPLACEMENT_CANARY)
    expect(screen.getByTestId('api-token-status')).toHaveTextContent('Configured')
    expect(document.body.textContent).not.toMatch(/Secure storage failed|replace failed/)
  })

  it('keeps configured status when delete fails', async () => {
    const onSettingsPatch = vi.fn().mockRejectedValue(new Error(`delete failed ${SAVED_CANARY}`))
    render(
      <ApiTokenSettingsControls apiTokenConfigured={true} onSettingsPatch={onSettingsPatch} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.getByTestId('api-token-error')).toHaveTextContent('API token could not be deleted.')
    })
    expect(screen.getByTestId('api-token-status')).toHaveTextContent('Configured')
    expect(JSON.stringify(screen.getByTestId('api-token-error').textContent)).not.toContain(SAVED_CANARY)
  })

  it('replaces and deletes without rehydrating the saved token into the draft', async () => {
    const onSettingsPatch = vi.fn().mockResolvedValue(undefined)
    render(
      <ApiTokenSettingsControls apiTokenConfigured={true} onSettingsPatch={onSettingsPatch} />,
    )

    expect(screen.getByLabelText('API token')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'replacement-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() => {
      expect(onSettingsPatch).toHaveBeenCalledWith({ apiToken: 'replacement-token' })
    })
    expect(screen.getByLabelText('API token')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(onSettingsPatch).toHaveBeenCalledWith({ apiToken: '' })
    })
    expect(screen.getByLabelText('API token')).toHaveValue('')
    expect(screen.queryByDisplayValue(SAVED_CANARY)).not.toBeInTheDocument()
  })

  it('propagates successful token patches so parents can mark restart required', async () => {
    const onSettingsPatch = vi.fn().mockResolvedValue(undefined)
    render(
      <ApiTokenSettingsControls apiTokenConfigured={false} onSettingsPatch={onSettingsPatch} />,
    )

    fireEvent.change(screen.getByLabelText('API token'), { target: { value: SAVED_CANARY } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    await waitFor(() => {
      expect(onSettingsPatch).toHaveBeenCalledWith({ apiToken: SAVED_CANARY })
    })
    await expect(onSettingsPatch.mock.results[0]?.value).resolves.toBeUndefined()
  })
})
