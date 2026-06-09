import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'

import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { notvex } from '@/lib/ipc'
import { Checkbox } from './ui/checkbox'

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
  }
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
