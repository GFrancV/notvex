import { chromium } from '../node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const contexts = browser.contexts()
let page = null
for (const ctx of contexts) {
  for (const p of ctx.pages()) {
    if (p.url().startsWith('http://localhost')) page = p
  }
}
if (!page) {
  console.log('NO PAGE FOUND')
  process.exit(1)
}
console.log('page url:', page.url())
await page.waitForTimeout(500)

await page.screenshot({ path: 'C:/Users/GFrancV/AppData/Local/Temp/claude/note-list-before.png' })
console.log('screenshot saved')

const info = await page.evaluate(() => {
  function rectOf(el) {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      tag: el.tagName,
      cls: el.className,
      rect: { top: r.top, bottom: r.bottom, height: r.height, width: r.width },
      overflowY: cs.overflowY,
      display: cs.display,
      minHeight: cs.minHeight
    }
  }
  const scrollAreaRoot = document.querySelector('[data-slot="scroll-area"]')
  const viewport = document.querySelector('[data-slot="scroll-area-viewport"]')
  const sidebarInset = document.querySelector('[data-slot="sidebar-inset"]')
  const noteListRoot = sidebarInset ? sidebarInset.children[0] : null
  const body = document.body
  return {
    body: rectOf(body),
    sidebarInset: rectOf(sidebarInset),
    noteListRoot: rectOf(noteListRoot),
    scrollAreaRoot: rectOf(scrollAreaRoot),
    viewport: rectOf(viewport),
    viewportScroll: viewport
      ? { scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight }
      : null,
    noteCount: document.querySelectorAll('[data-slot="scroll-area-viewport"] button').length
  }
})
console.log(JSON.stringify(info, null, 2))

await browser.close()
