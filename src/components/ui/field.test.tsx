import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from './input'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from './field'

afterEach(cleanup)

describe('Field', () => {
  it('associates a control through FieldLabel htmlFor so clicking the label focuses the input', async () => {
    const user = userEvent.setup()
    render(
      <Field>
        <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
        <Input id="workspace-name" />
      </Field>,
    )

    const input = screen.getByLabelText('Workspace name')
    expect(input).toHaveAttribute('id', 'workspace-name')

    await user.click(screen.getByText('Workspace name'))
    expect(input).toHaveFocus()
  })

  it('wires description and error ids for aria-describedby while marking invalid state', () => {
    const { rerender } = render(
      <Field>
        <FieldLabel htmlFor="remote-api-url">Remote API URL</FieldLabel>
        <Input
          aria-describedby="remote-api-url-description"
          id="remote-api-url"
        />
        <FieldDescription id="remote-api-url-description">
          Used by the local backend health check.
        </FieldDescription>
      </Field>,
    )

    expect(screen.getByLabelText('Remote API URL')).toHaveAttribute(
      'aria-describedby',
      'remote-api-url-description',
    )

    rerender(
      <Field data-invalid>
        <FieldLabel htmlFor="remote-api-url">Remote API URL</FieldLabel>
        <Input
          aria-describedby="remote-api-url-error"
          aria-invalid
          id="remote-api-url"
        />
        <FieldError id="remote-api-url-error">URL must start with http.</FieldError>
      </Field>,
    )

    const input = screen.getByLabelText('Remote API URL')
    const error = screen.getByRole('alert')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', error.id)
    expect(error).toHaveTextContent('URL must start with http.')
  })

  it('renders FieldError from an errors list and deduplicates repeated messages', () => {
    render(
      <Field data-invalid>
        <FieldLabel htmlFor="min-score">Min score</FieldLabel>
        <Input aria-invalid id="min-score" />
        <FieldError
          errors={[
            { message: 'Must be between 0 and 10.' },
            { message: 'Must be between 0 and 10.' },
            { message: 'Must be a number.' },
          ]}
        />
      </Field>,
    )

    const error = screen.getByRole('alert')
    expect(error.querySelectorAll('li')).toHaveLength(2)
    expect(error).toHaveTextContent('Must be between 0 and 10.')
    expect(error).toHaveTextContent('Must be a number.')
  })
})
