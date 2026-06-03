import * as React from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-9 w-full rounded-md border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-1 text-sm text-[#e5e5e5] shadow-sm transition-colors',
      'placeholder:text-[#737373] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
