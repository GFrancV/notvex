import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow } from 'date-fns'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDate(timestamp: number): string {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
}
