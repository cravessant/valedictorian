import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

configure({ asyncUtilTimeout: process.env.CI ? 15_000 : 1_000 })
