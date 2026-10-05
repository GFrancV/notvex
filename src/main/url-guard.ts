// The one scheme check for every route that hands a URL to the OS
// (shell:open-external and setWindowOpenHandler), so they can't drift (#56).
export function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
