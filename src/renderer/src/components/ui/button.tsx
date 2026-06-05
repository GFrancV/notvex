import * as React from 'react'

import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-emerald-600 text-white shadow hover:bg-emerald-500',
        destructive: 'bg-red-700 text-white shadow-sm hover:bg-red-600',
        outline: 'border border-[#2a2a2a] bg-transparent shadow-sm hover:bg-[#222] text-[#e5e5e5]',
        secondary: 'bg-[#222] text-[#e5e5e5] shadow-sm hover:bg-[#2a2a2a]',
        ghost: 'hover:bg-[#222] text-[#e5e5e5]',
        link: 'text-emerald-400 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
)
Button.displayName = 'Button'

export { Button, buttonVariants }
