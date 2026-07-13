import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Input } from './input'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
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

    const field = screen.getByRole('group')
    expect(field).toHaveAttribute('data-slot', 'field')
    expect(field).toHaveAttribute('data-orientation', 'vertical')

    const input = screen.getByLabelText('Workspace name')
    expect(input).toHaveAttribute('id', 'workspace-name')
    expect(screen.getByText('Workspace name')).toHaveAttribute('data-slot', 'field-label')

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
    expect(screen.getByText('Used by the local backend health check.')).toHaveAttribute(
      'data-slot',
      'field-description',
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
    expect(error).toHaveAttribute('data-slot', 'field-error')
    expect(error).toHaveTextContent('URL must start with http.')
    expect(screen.getByRole('group')).toHaveAttribute('data-invalid', 'true')
  })

  it('applies orientation contracts for horizontal and responsive layouts', () => {
    const { rerender } = render(
      <Field orientation="horizontal">
        <FieldLabel htmlFor="schedule-mode">Schedule mode</FieldLabel>
        <FieldContent>
          <Input id="schedule-mode" />
        </FieldContent>
      </Field>,
    )

    let field = screen.getByRole('group')
    expect(field).toHaveAttribute('data-orientation', 'horizontal')
    expect(field).toHaveClass('flex-row', 'items-center')
    expect(screen.getByRole('group').querySelector('[data-slot="field-content"]')).toHaveClass(
      'group/field-content',
      'flex-1',
    )

    rerender(
      <Field orientation="responsive">
        <FieldLabel htmlFor="schedule-mode">Schedule mode</FieldLabel>
        <Input id="schedule-mode" />
      </Field>,
    )

    field = screen.getByRole('group')
    expect(field).toHaveAttribute('data-orientation', 'responsive')
    expect(field).toHaveClass('@md/field-group:flex-row')
  })

  it('dims FieldLabel when the field group is marked disabled', () => {
    render(
      <Field data-disabled>
        <FieldLabel htmlFor="locked-path">Workspace path</FieldLabel>
        <Input disabled id="locked-path" />
      </Field>,
    )

    expect(screen.getByRole('group')).toHaveAttribute('data-disabled', 'true')
    expect(screen.getByText('Workspace path')).toHaveClass(
      'group-data-[disabled=true]/field:opacity-50',
    )
    expect(screen.getByLabelText('Workspace path')).toBeDisabled()
  })

  it('groups related fields through FieldGroup without owning page layout grids', () => {
    const { container } = render(
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="jobright-email">Email</FieldLabel>
          <Input id="jobright-email" />
        </Field>
        <Field>
          <FieldLabel htmlFor="jobright-password">Password</FieldLabel>
          <Input id="jobright-password" type="password" />
        </Field>
      </FieldGroup>,
    )

    const group = container.querySelector('[data-slot="field-group"]')
    expect(group).not.toBeNull()
    expect(group).toHaveClass('flex', 'flex-col', 'gap-7', '@container/field-group')
    expect(group!.querySelectorAll('[data-slot="field"]')).toHaveLength(2)
    expect(screen.getByLabelText('Email')).toHaveAttribute('id', 'jobright-email')
    expect(screen.getByLabelText('Password')).toHaveAttribute('id', 'jobright-password')
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
