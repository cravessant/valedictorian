import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './sidebar'

afterEach(cleanup)

describe('Sidebar primitives', () => {
  it('exposes structural data-slots and forwards aside props', () => {
    render(
      <Sidebar aria-label="Application navigation" className="left-0 w-[280px]" data-testid="app-sidebar">
        <SidebarHeader data-testid="sidebar-header">Header</SidebarHeader>
        <SidebarContent data-testid="sidebar-content">
          <SidebarGroup data-testid="sidebar-group">
            <SidebarGroupLabel>Personal</SidebarGroupLabel>
            <SidebarGroupContent data-testid="sidebar-group-content">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton>Profile</SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter data-testid="sidebar-footer">Footer</SidebarFooter>
      </Sidebar>,
    )

    const sidebar = screen.getByTestId('app-sidebar')
    expect(sidebar.tagName).toBe('ASIDE')
    expect(sidebar).toHaveAttribute('data-slot', 'sidebar')
    expect(sidebar).toHaveAttribute('aria-label', 'Application navigation')
    expect(sidebar).toHaveClass('left-0', 'w-[280px]')
    expect(screen.getByTestId('sidebar-header')).toHaveAttribute('data-slot', 'sidebar-header')
    expect(screen.getByTestId('sidebar-content')).toHaveAttribute('data-slot', 'sidebar-content')
    expect(screen.getByTestId('sidebar-footer')).toHaveAttribute('data-slot', 'sidebar-footer')
    expect(screen.getByTestId('sidebar-group')).toHaveAttribute('data-slot', 'sidebar-group')
    expect(screen.getByText('Personal')).toHaveAttribute('data-slot', 'sidebar-group-label')
    expect(screen.getByTestId('sidebar-group-content')).toHaveAttribute(
      'data-slot',
      'sidebar-group-content',
    )
    expect(screen.getByRole('button', { name: 'Profile' }).closest('ul')).toHaveAttribute(
      'data-slot',
      'sidebar-menu',
    )
    expect(screen.getByRole('button', { name: 'Profile' }).closest('li')).toHaveAttribute(
      'data-slot',
      'sidebar-menu-item',
    )
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute(
      'data-slot',
      'sidebar-menu-button',
    )
  })

  it('marks active menu buttons and supports asChild composition', () => {
    render(
      <Sidebar>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive>Applications</SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="#profile">Profile link</a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </Sidebar>,
    )

    const active = screen.getByRole('button', { name: 'Applications' })
    expect(active).toHaveAttribute('data-active', 'true')
    expect(active).toHaveClass(
      'data-[active=true]:bg-accent',
      'data-[active=true]:text-accent-foreground',
    )

    const link = screen.getByRole('link', { name: 'Profile link' })
    expect(link).toHaveAttribute('href', '#profile')
    expect(link).toHaveAttribute('data-slot', 'sidebar-menu-button')
    expect(link).toHaveAttribute('data-active', 'false')
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
    expect(actionQueue).toHaveClass('focus-visible:ring-ring/50')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Disabled item' }))
    expect(onDisabledClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Disabled item' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Disabled item' })).toHaveClass(
      'disabled:pointer-events-none',
      'disabled:opacity-50',
    )

    expect(screen.getByRole('button', { name: 'Overview' }).closest('ul')).toHaveAttribute(
      'data-slot',
      'sidebar-menu-sub',
    )
  })
})
