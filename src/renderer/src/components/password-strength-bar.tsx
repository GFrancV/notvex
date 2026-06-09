import { type JSX } from 'react'

import { passwordStrength } from '@/lib/utils'

interface PasswordStrengthBarProps {
  password: string
}

export function PasswordStrengthBar({ password }: PasswordStrengthBarProps): JSX.Element {
  const strength = passwordStrength(password)

  const segments = [
    strength === 'weak' ? 'bg-destructive' : strength === 'medium' ? 'bg-warning' : 'bg-success',
    strength === 'medium' ? 'bg-warning' : strength === 'strong' ? 'bg-success' : 'bg-[#2a2a2a]',
    strength === 'strong' ? 'bg-success' : 'bg-[#2a2a2a]'
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
      ? 'text-red-400'
      : strength === 'medium'
        ? 'text-yellow-400'
        : 'text-emerald-400'

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
