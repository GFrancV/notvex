import { describe, expect, it } from 'vitest'

import { parseInAppBlock } from '@main/updater/release-notes'

describe('parseInAppBlock', () => {
  it('returns the summary without the block delimiter lines', () => {
    const body = [
      'Release prose for the release page.',
      '',
      '<!-- in-app',
      'Faster search.',
      '- Highlight one',
      '-->',
      '',
      '## Fixed'
    ].join('\n')

    expect(parseInAppBlock(body)?.summary).toBe('Faster search.\n- Highlight one')
  })

  it('returns null when the body has no in-app block', () => {
    const body = 'Release prose only.\n\n## Fixed\n- A bug\n<!-- a regular comment -->'

    expect(parseInAppBlock(body)).toBeNull()
  })

  it('returns null when the block is unclosed', () => {
    const body = 'Release prose.\n\n<!-- in-app\nFaster search.\n\n## Fixed\n- A bug'

    expect(parseInAppBlock(body)).toBeNull()
  })

  it('uses only the first block when the body has two', () => {
    const body = '<!-- in-app\nFirst summary.\n-->\n\nProse.\n\n<!-- in-app\nSecond summary.\n-->'

    expect(parseInAppBlock(body)?.summary).toBe('First summary.')
  })

  it('returns null when the first block is unclosed even if a later one closes', () => {
    const body = '<!-- in-app\nFirst summary.\n\nProse.\n\n<!-- in-app\nSecond summary.\n-->'

    expect(parseInAppBlock(body)).toBeNull()
  })

  it('flags security when the block has the exact line "Security: yes"', () => {
    const body = '<!-- in-app\nPatched a crash.\nSecurity: yes\n-->'

    expect(parseInAppBlock(body)?.security).toBe(true)
  })

  it.each([
    'security: yes',
    'Security: no',
    'Security: yes please',
    ' Security: yes',
    'Security:yes'
  ])('does not flag security for the marker variant %j', (marker) => {
    const body = `<!-- in-app\nPatched a crash.\n${marker}\n-->`

    expect(parseInAppBlock(body)?.security).toBe(false)
  })

  it('does not flag security for a marker outside the block', () => {
    const body = 'Security: yes\n\n<!-- in-app\nPatched a crash.\n-->'

    expect(parseInAppBlock(body)?.security).toBe(false)
  })

  it('removes the marker line from the summary', () => {
    const body = '<!-- in-app\nPatched a crash.\nSecurity: yes\n- Safer links\n-->'

    expect(parseInAppBlock(body)?.summary).toBe('Patched a crash.\n- Safer links')
  })

  it('returns HTML in the summary as is, leaving rendering to the dialog', () => {
    const body = '<!-- in-app\n<img src="https://x.test/a.png"> <script>alert(1)</script>\n-->'

    expect(parseInAppBlock(body)?.summary).toBe(
      '<img src="https://x.test/a.png"> <script>alert(1)</script>'
    )
  })
})
