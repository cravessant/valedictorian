import React from 'react'
import ReactDOM from 'react-dom/client'
import AppRoot from './AppRoot.tsx'
import './index.css'
import { applyResolvedTheme } from './theme/theme-applier'
import { defaultAppSettings } from './settings/app-settings'
import { resolveTheme, type ResolvedTheme } from './theme/theme-registry'

const initialTheme = (window as Window & { valedictorianTheme?: ResolvedTheme }).valedictorianTheme
  ?? resolveTheme(defaultAppSettings.theme)

applyResolvedTheme(initialTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>,
)
