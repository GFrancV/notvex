import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'

import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { notvex } from '../lib/ipc'

const components: Components = {
  a({ href, children }) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault()
          if (href) void notvex.shell.openExternal(href)
        }}
        className="text-emerald-400 underline cursor-pointer"
      >
        {children}
      </a>
    )
  },
  input({ type, checked }) {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          disabled
          className="mr-1.5 align-middle accent-emerald-500"
        />
      )
    }
    return <input type={type} readOnly />
  },
}

interface NoteReadingViewProps {
  content: string
}

export function NoteReadingView({ content }: NoteReadingViewProps): JSX.Element {
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
