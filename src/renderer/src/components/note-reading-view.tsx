import { useRef } from 'react'

import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'

import { CheckIcon, CopyIcon } from 'lucide-react'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { notvex } from '@/lib/ipc'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'

function Pre({ children }: React.ComponentProps<'pre'>): React.JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  return (
    <div className="group relative">
      <pre ref={preRef}>{children}</pre>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void copyToClipboard(preRef.current?.textContent ?? '')}
        className="text-muted-foreground absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
        title="Copy code"
      >
        {isCopied ? (
          <CheckIcon className="text-success size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
    </div>
  )
}

const components: Components = {
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href) void notvex.shell.openExternal(href)
        }}
        className="text-primary cursor-pointer underline"
      >
        {children}
      </a>
    )
  },
  input({ type, checked }) {
    if (type === 'checkbox') {
      return <Checkbox checked={checked ?? false} disabled className="mr-1.5 align-middle" />
    }
    return <input type={type} readOnly />
  },
  pre: Pre
}

interface NoteReadingViewProps {
  content: string
}

export function NoteReadingView({ content }: NoteReadingViewProps): React.JSX.Element {
  return (
    <div className="h-full overflow-auto">
      <div className="prose prose-invert prose-sm max-w-none p-6">
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
