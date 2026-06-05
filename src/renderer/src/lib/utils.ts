import { clsx, type ClassValue } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDate(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
}

export function passwordStrength(password: string): 'weak' | 'medium' | 'strong' {
  if (password.length < 12) return 'weak'
  const hasUpper = /[A-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSymbol = /[^a-zA-Z0-9]/.test(password)
  if (password.length >= 16 && hasUpper && hasNumber && hasSymbol) return 'strong'
  if (hasUpper || hasNumber || hasSymbol) return 'medium'
  return 'weak'
}
