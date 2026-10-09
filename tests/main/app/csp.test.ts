import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// The CSP is a meta tag in the renderer's HTML, so a unit test can only hold the text in place.
function cspDirectives(): Map<string, string> {
  const html = readFileSync(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8')
  const content = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] ?? ''
  return new Map(
    content
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name!, sources.join(' ')])
  )
}

describe('renderer CSP', () => {
  it.each([
    ['default-src', "'self'"],
    ['script-src', "'self'"],
    // These don't fall back to default-src: after an HTML injection, <base href> would
    // repoint relative URLs and <form action> could post data off-app.
    ['base-uri', "'none'"],
    ['form-action', "'none'"],
    ['object-src', "'none'"]
  ])('sets %s to %s', (directive, value) => {
    expect(cspDirectives().get(directive)).toBe(value)
  })
})
