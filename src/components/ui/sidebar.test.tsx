import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Sidebar,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './sidebar'

afterEach(cleanup)

describe('Sidebar primitives', () => {
  it('exposes labeled complementary navigation with asChild accessible links', () => {
    render(
      <Sidebar aria-label="Application navigation">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="#profile">Profile link</a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </Sidebar>,
    )

    expect(screen.getByRole('complementary', { name: 'Application navigation' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Profile link' })
    expect(link).toHaveAttribute('href', '#profile')
  })

  it('handles click activation, keyboard focus, and disabled semantics', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onDisabledClick = vi.fn()

    render(
      <Sidebar>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onClick}>Action Queue</SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton disabled onClick={onDisabledClick}>
              Disabled item
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild>
                <button type="button">Overview</button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </SidebarMenu>
      </Sidebar>,
    )

    const actionQueue = screen.getByRole('button', { name: 'Action Queue' })
    await user.click(actionQueue)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(actionQueue).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Disabled item' }))
    expect(onDisabledClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Disabled item' })).toBeDisabled()
  })
})
