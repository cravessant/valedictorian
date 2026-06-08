import * as React from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'

interface ExternalLinkButtonProps {
  children: React.ReactNode
  className?: string
  href: string
  icon?: React.ReactNode
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
}

function ExternalLinkButton({
  children,
  className,
  href,
  icon,
  size = 'sm',
  variant = 'ghost',
}: ExternalLinkButtonProps) {
  return (
    <Button asChild className={className} size={size} variant={variant}>
      <a href={href} rel="noreferrer" target="_blank">
        {children}
        {icon}
      </a>
    </Button>
  )
}

export { ExternalLinkButton }
