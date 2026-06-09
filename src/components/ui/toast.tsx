import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'

import { cn } from '@/lib/utils'

const ToastProvider = ToastPrimitives.Provider

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    className={cn(
      'fixed bottom-0 right-0 z-50 flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:max-w-[420px]',
      className,
    )}
    ref={ref}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitives.Viewport.displayName

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & {
    variant?: 'default' | 'destructive' | 'success'
  }
>(({ className, variant = 'default', ...props }, ref) => (
  <ToastPrimitives.Root
    className={cn(
      'group pointer-events-auto relative grid w-full gap-1 overflow-hidden rounded-md border bg-popover p-4 text-popover-foreground shadow-lg transition-all data-[state=closed]:animate-out data-[state=open]:animate-in',
      variant === 'destructive' && 'border-destructive/40 bg-destructive/15 text-destructive',
      variant === 'success' && 'border-success/30 bg-success/15 text-success',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Toast.displayName = ToastPrimitives.Root.displayName

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title className={cn('text-sm font-semibold', className)} ref={ref} {...props} />
))
ToastTitle.displayName = ToastPrimitives.Title.displayName

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    className={cn('text-sm opacity-90', className)}
    ref={ref}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitives.Description.displayName

export { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport }
