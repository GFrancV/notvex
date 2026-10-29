import { format, formatDistanceToNow } from 'date-fns'
import millify from 'millify'

// Every TooltipProvider uses it, so hover hints wait the same everywhere.
export const TOOLTIP_DELAY = 500

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

/** A vault's file name, for places too tight for its path; show the path in a tooltip there. */
export function vaultName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
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
