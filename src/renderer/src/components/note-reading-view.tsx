import { isValidElement, useRef, useState } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'

import { CheckIcon, CopyIcon } from 'lucide-react'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { useClipboardAutoClear } from '@/hooks/use-clipboard-auto-clear'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { notvex } from '@/lib/ipc'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'

function Pre({ children }: React.ComponentProps<'pre'>): React.JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  const codeElement = isValidElement<{ className?: string }>(children) ? children : null
  const language = /language-(\S+)/.exec(codeElement?.props.className ?? '')?.[1]

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div className="bg-card text-muted-foreground flex items-center justify-between border-b px-3 py-1.5">
        <span className="font-mono text-xs">{language ?? 'text'}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            const text = preRef.current?.textContent ?? ''
            void copyToClipboard(text)
            void notvex.clipboard.scheduleClear(text)
          }}
          className="text-muted-foreground size-6"
          title="Copy code"
          aria-label="Copy code"
        >
          {isCopied ? (
            <CheckIcon className="text-success size-3.5" />
          ) : (
            <CopyIcon className="size-3.5" />
          )}
        </Button>
      </div>
      <pre ref={preRef} className="m-0! rounded-none! border-0! bg-transparent! p-0!">
        {children}
      </pre>
    </div>
  )
}

const components: Components = {
  a({ href, children }) {
    return (
      <Button
        variant="link"
        onClick={(e) => {
          e.preventDefault()
          if (href) void notvex.shell.openExternal(href)
        }}
        className="h-fit p-0"
      >
        {children}
      </Button>
    )
  },
  input({ type, checked }) {
    if (type === 'checkbox') {
      return <Checkbox checked={checked ?? false} disabled className="mr-1.5 align-middle" />
    }
    return <input type={type} aria-label="Checkbox" readOnly />
  },
  pre: Pre
}

interface NoteReadingViewProps {
  content: string
}

export function NoteReadingView({ content }: NoteReadingViewProps): React.JSX.Element {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useClipboardAutoClear(container)

  return (
    <div className="h-full overflow-auto">
      <div ref={setContainer} className="prose prose-invert prose-sm max-w-none p-6">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSanitize, rehypeHighlight]}
          components={components}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
