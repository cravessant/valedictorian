import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import AppRoot from './AppRoot.tsx'
import './index.css'
import { rendererQueryClient } from './app/query-client'
import { applyResolvedTheme } from './theme/theme-applier'
import { defaultAppSettings } from './settings/app-settings'
import { resolveTheme, type ResolvedTheme } from './theme/theme-registry'

const initialTheme = (window as Window & { valedictorianTheme?: ResolvedTheme }).valedictorianTheme
  ?? resolveTheme(defaultAppSettings.theme)

applyResolvedTheme(initialTheme)

// The one renderer-lifetime query client, built here at the composition root
// rather than inside any component render.
const queryClient = rendererQueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRoot />
    </QueryClientProvider>
  </React.StrictMode>,
)
