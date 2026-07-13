import { cn } from '@/lib/utils'

/**
 * Shared semantic typography class recipes.
 * Apply to native elements — do not wrap in React components.
 */
export const typography = {
  pageEyebrow: 'text-xs font-medium uppercase text-muted-foreground',
  pageTitle: 'text-2xl font-semibold tracking-normal text-foreground',
  pageDescription: 'mt-1 text-sm text-muted-foreground',
  sectionTitle: 'text-xl font-semibold text-foreground',
  sectionDescription: 'mt-1 text-sm text-muted-foreground',
  panelTitle: 'text-sm font-semibold text-foreground',
  muted: 'text-sm text-muted-foreground',
  inlineCode:
    'relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
  codeBlock:
    'whitespace-pre-wrap break-all rounded-md bg-background p-3 text-xs text-foreground',
  list: 'ml-4 list-disc [&>li]:mt-1',
} as const

export type TypographyVariant = keyof typeof typography

export function typographyClass(
  variant: TypographyVariant,
  className?: string,
): string {
  return cn(typography[variant], className)
}
