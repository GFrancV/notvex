import { type ReactNode } from 'react'

import { passwordStrength } from '@/lib/utils'

interface PasswordStrengthBarProps {
  password: string
}

export function PasswordStrengthBar({ password }: PasswordStrengthBarProps): ReactNode {
  const strength = passwordStrength(password)

  const segments = [
    strength === 'weak' ? 'bg-destructive' : strength === 'medium' ? 'bg-warning' : 'bg-success',
    strength === 'medium' ? 'bg-warning' : strength === 'strong' ? 'bg-success' : 'bg-secondary',
    strength === 'strong' ? 'bg-success' : 'bg-secondary'
  ]

  const label =
    password.length === 0
      ? ''
      : strength === 'weak'
        ? 'Weak'
        : strength === 'medium'
          ? 'Medium'
          : 'Strong'

  const labelColor =
    strength === 'weak'
      ? 'text-destructive'
      : strength === 'medium'
        ? 'text-warning'
        : 'text-success'

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-3 gap-1">
        {segments.map((color, i) => (
          <div key={i} className={`h-1 rounded-full transition-colors duration-200 ${color}`} />
        ))}
      </div>
      {label && <p className={`text-right text-xs ${labelColor}`}>{label}</p>}
    </div>
  )
}
