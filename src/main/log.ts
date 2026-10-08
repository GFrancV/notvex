/**
 * Logs `tag` plus the error's `code` (or `name`) only. fs error messages and
 * stacks embed local paths (username, vault location, file name), which must
 * never reach stdout.
 */
export function logError(tag: string, e: unknown): void {
  const id = e instanceof Error ? ((e as NodeJS.ErrnoException).code ?? e.name) : typeof e
  console.error(tag, id)
}
