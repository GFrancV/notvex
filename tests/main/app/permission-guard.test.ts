import { beforeEach, describe, expect, it, vi } from 'vitest'

type RequestHandler = (
  wc: unknown,
  permission: string,
  callback: (granted: boolean) => void
) => void
type CheckHandler = (wc: unknown, permission: string) => boolean

const defaultSession = {
  setPermissionRequestHandler: vi.fn<(handler: RequestHandler) => void>(),
  setPermissionCheckHandler: vi.fn<(handler: CheckHandler) => void>()
}

vi.mock('electron', () => ({ session: { defaultSession } }))

const DENIED = ['media', 'clipboard-read', 'notifications', 'geolocation', 'not-a-permission']

describe('installPermissionGuard', () => {
  let requestHandler: RequestHandler
  let checkHandler: CheckHandler

  beforeEach(async () => {
    vi.clearAllMocks()
    const { installPermissionGuard } = await import('@main/permission-guard')
    installPermissionGuard()
    expect(defaultSession.setPermissionRequestHandler).toHaveBeenCalledOnce()
    expect(defaultSession.setPermissionCheckHandler).toHaveBeenCalledOnce()
    requestHandler = defaultSession.setPermissionRequestHandler.mock.calls[0]![0]
    checkHandler = defaultSession.setPermissionCheckHandler.mock.calls[0]![0]
  })

  function request(permission: string): boolean {
    const callback = vi.fn<(granted: boolean) => void>()
    requestHandler(null, permission, callback)
    expect(callback).toHaveBeenCalledOnce()
    return callback.mock.calls[0]![0]
  }

  it('grants clipboard write, which navigator.clipboard.writeText needs', () => {
    expect(request('clipboard-sanitized-write')).toBe(true)
    expect(checkHandler(null, 'clipboard-sanitized-write')).toBe(true)
  })

  it.each(DENIED)('denies %s', (permission) => {
    expect(request(permission)).toBe(false)
    expect(checkHandler(null, permission)).toBe(false)
  })
})
