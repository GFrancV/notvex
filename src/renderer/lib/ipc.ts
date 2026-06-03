import type { NotvexAPI } from '../../preload/index'

declare global {
  interface Window {
    notvex: NotvexAPI
  }
}

export const notvex = window.notvex
