// @vitest-environment jsdom
import { type ComponentProps, createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { SidebarProvider } = await import('@/components/ui/sidebar')
const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } =
  await import('@/components/ui/tooltip')

beforeEach(() => {
  vi.useFakeTimers()
  // Radix measures the tooltip's position; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe = (): void => {}
    unobserve = (): void => {}
    disconnect = (): void => {}
  }
  // SidebarProvider reads the viewport width through useIsMobile.
  window.matchMedia ??= ((): MediaQueryList =>
    ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {}
    }) as unknown as MediaQueryList) as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('tooltip delay', () => {
  it('is the root delay inside the sidebar layout too', () => {
    render(
      createElement(
        TooltipProvider,
        // createElement's typing wants children in props; they come as the next argument.
        { delayDuration: 500 } as ComponentProps<typeof TooltipProvider>,
        createElement(
          SidebarProvider,
          null,
          createElement(
            Tooltip,
            null,
            createElement(TooltipTrigger, null, 'Pin'),
            createElement(TooltipContent, null, 'Pin note')
          )
        )
      )
    )

    fireEvent.pointerMove(screen.getByText('Pin'))
    act(() => vi.advanceTimersByTime(100))
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('tooltip').textContent).toBe('Pin note')
  })
})
