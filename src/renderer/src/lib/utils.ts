import { clsx, type ClassValue } from 'clsx'
import { format, formatDistanceToNow } from 'date-fns'
import millify from 'millify'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatTimeAgo(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
}

export function formatDateTime(timestamp: number): string {
  return format(new Date(timestamp), 'PP p')
}

export function formatFileSize(bytes: number): string {
  return millify(bytes, {
    units: ['B', 'KB', 'MB', 'GB', 'TB'],
    space: true
  })
}

export function truncatePath(path: string, maxLen = 54): string {
  if (path.length <= maxLen) return path
  const half = Math.floor((maxLen - 3) / 2)
  return path.slice(0, half) + '…' + path.slice(path.length - half)
}

export function passwordStrength(password: string): 'weak' | 'medium' | 'strong' {
  if (password.length < 12) return 'weak'
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)
  const varietyCount = [hasUpper, hasNumber, hasSymbol].filter(Boolean).length
  if (hasUpper && hasLower && hasNumber && hasSymbol) return 'strong'
  if (varietyCount >= 2) return 'medium'
  return 'weak'
}
