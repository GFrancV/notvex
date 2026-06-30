import type { NotvexAPI } from '@shared/types'

declare global {
  interface Window {
    notvex: NotvexAPI
  }
}

export const notvex = window.notvex
