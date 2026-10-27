import { Fragment, type JSX } from 'react'

import { formatShortcut } from '@/lib/shortcut'
import { Kbd, KbdGroup } from './ui/kbd'

/**
 * A keyboard shortcut in CodeMirror notation ("Mod-Shift-e"), one key per `Kbd`. The spaces
 * between keys don't render in the flex group, but keep the text "Ctrl Shift E" for screen
 * readers and tooltips.
 */
export function Shortcut({ keys }: { keys: string }): JSX.Element {
  return (
    <KbdGroup>
      {formatShortcut(keys).map((key, i) => (
        <Fragment key={key}>
          {i > 0 && ' '}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  )
}
