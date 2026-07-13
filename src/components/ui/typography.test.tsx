import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { typography, typographyClass } from './typography'

describe('typography', () => {
  it('applies shared recipes for heading hierarchy, muted copy, code, and lists', () => {
    render(
      <article>
        <p className={typography.pageEyebrow}>Job automation</p>
        <h1 className={typographyClass('pageTitle', 'mt-1')}>Applications</h1>
        <p className={typography.pageDescription}>Track roles across workspaces.</p>

        <h2 className={typography.sectionTitle}>General</h2>
        <p className={typography.sectionDescription}>Choose how this app talks to job data.</p>

        <h3 className={typography.panelTitle}>Backend mode</h3>
        <p className={typography.muted}>
          Current selection: <code className={typography.inlineCode}>local-shared</code>
        </p>

        <pre className={typographyClass('codeBlock', 'mt-3')}>
          <code>valedictorian-cli --json workspaces list</code>
        </pre>

        <ul className={typography.list}>
          <li>Authenticate connectors</li>
          <li>Review sourcing findings</li>
        </ul>
      </article>,
    )

    const pageTitle = screen.getByRole('heading', { level: 1, name: 'Applications' })
    expect(pageTitle).toHaveClass(
      'mt-1',
      'text-2xl',
      'font-semibold',
      'tracking-normal',
      'text-foreground',
    )
    expect(pageTitle).not.toHaveClass('font-bold')

    expect(screen.getByText('Job automation')).toHaveClass(
      'text-xs',
      'font-medium',
      'uppercase',
      'text-muted-foreground',
    )
    expect(screen.getByText('Track roles across workspaces.')).toHaveClass(
      'mt-1',
      'text-sm',
      'text-muted-foreground',
    )

    const sectionTitle = screen.getByRole('heading', { level: 2, name: 'General' })
    expect(sectionTitle).toHaveClass('text-xl', 'font-semibold', 'text-foreground')
    expect(screen.getByText('Choose how this app talks to job data.')).toHaveClass(
      'mt-1',
      'text-sm',
      'text-muted-foreground',
    )

    const panelTitle = screen.getByRole('heading', { level: 3, name: 'Backend mode' })
    expect(panelTitle).toHaveClass('text-sm', 'font-semibold', 'text-foreground')

    const muted = screen.getByText(/Current selection:/)
    expect(muted).toHaveClass('text-sm', 'text-muted-foreground')
    expect(within(muted).getByText('local-shared')).toHaveClass(
      'rounded',
      'bg-muted',
      'font-mono',
      'text-sm',
      'font-semibold',
    )

    const codeBlock = screen.getByText('valedictorian-cli --json workspaces list').closest('pre')
    expect(codeBlock).toHaveClass(
      'mt-3',
      'whitespace-pre-wrap',
      'break-all',
      'rounded-md',
      'bg-background',
      'p-3',
      'text-xs',
      'text-foreground',
    )

    const list = screen.getByRole('list')
    expect(list.tagName).toBe('UL')
    expect(list).toHaveClass('ml-4', 'list-disc')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })
})
