export interface ErrorLike {
  name: string
  stack: string
}

// V8's stack starts with the error's header, `${name}: ${message}`, and a message can span lines
// shaped like frames. So the header is cut by the message's exact text, not line by line. The
// name is not used to find it: a subclass that sets this.name after super() leaves "Error" there.
// A message that isn't in the stack (reassigned after V8 formatted it) means the header can't be
// told apart from the frames, so none are kept.
function framesOnly(stack: string, message: string): string {
  if (!message) return stack
  const at = stack.indexOf(message)
  return at >= 0 ? stack.slice(at + message.length) : ''
}

// An Error's getters can throw (a Proxy, a hostile subclass), and a non-Error value can be
// anything, so nothing is read beyond name, message and stack, and a non-Error is never
// stringified. Callers must not let this throw past them: the error path has nowhere to go.
export function toErrorLike(e: unknown): ErrorLike {
  try {
    if (e instanceof Error) {
      const stack = typeof e.stack === 'string' ? e.stack : ''
      const message = typeof e.message === 'string' ? e.message : ''
      return { name: String(e.name), stack: framesOnly(stack, message) }
    }
  } catch {
    /* fall through */
  }
  return { name: 'NonError', stack: '' }
}
