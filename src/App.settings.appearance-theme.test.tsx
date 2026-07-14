import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import {
  createApplication,
  createListResult,
  createSettingsApi,
  openSettingsPage,
} from './App.test-helpers'

afterEach(cleanup)

describe('workspace theme settings', () => {
  it('selects presets, layers custom colors, and resets all customizations', async () => {
    const settingsApi = createSettingsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))

    expect(screen.getByRole('radio', { name: 'Catppuccin Blur Mocha' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Catppuccin Latte' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Graphite' })).toBeInTheDocument()
    expect(screen.getByTestId('theme-preview')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Catppuccin Latte' }))
    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        theme: { presetId: 'catppuccin-latte', overrides: {} },
      })
    })

    fireEvent.change(screen.getByLabelText('Primary hex value'), {
      target: { value: '#12345678' },
    })
    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        theme: {
          presetId: 'catppuccin-latte',
          overrides: { primary: '#12345678' },
        },
      })
    })
    fireEvent.change(screen.getByLabelText('Foreground hex value'), {
      target: { value: '#222222' },
    })
    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        theme: {
          presetId: 'catppuccin-latte',
          overrides: { primary: '#12345678', foreground: '#222222' },
        },
      })
    })
    expect(screen.getByRole('button', { name: 'Reset theme' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset theme' }))
    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        theme: { presetId: 'catppuccin-latte', overrides: {} },
      })
    })
    expect(screen.getByRole('button', { name: 'Reset theme' })).toBeDisabled()
  })

  it('clears existing overrides when selecting a different preset', async () => {
    const settingsApi = createSettingsApi({
      theme: {
        presetId: 'graphite',
        overrides: { primary: '#123456', foreground: '#222222' },
      },
    })

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getByRole('button', { name: 'Reset theme' })).toBeEnabled()

    fireEvent.click(screen.getByRole('radio', { name: 'Catppuccin Latte' }))
    await waitFor(() => {
      expect(settingsApi.update).toHaveBeenCalledWith({
        theme: { presetId: 'catppuccin-latte', overrides: {} },
      })
    })
  })

  it('shows contrast feedback for an inaccessible custom pair', async () => {
    const settingsApi = createSettingsApi()

    render(
      <App
        applicationLoader={() => Promise.resolve(createListResult([createApplication()]))}
        settingsApi={settingsApi}
      />,
    )

    await openSettingsPage()
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
    fireEvent.change(screen.getByLabelText('Foreground hex value'), {
      target: { value: '#222222' },
    })
    fireEvent.change(screen.getByLabelText('Background hex value'), {
      target: { value: '#333333' },
    })

    expect(await screen.findByText('Review contrast')).toBeInTheDocument()
    expect(screen.getByText(/Foreground on Background/)).toBeInTheDocument()
  })
})
