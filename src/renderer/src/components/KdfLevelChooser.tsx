import { type ReactNode, useRef, useState } from 'react'

import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { notvex } from '@/lib/ipc'
import { KEY_DERIVATION_DOCS_URL } from '@/lib/links'
import { DEFAULT_KDF_LEVEL_ID, KDF_LEVELS, type KdfLevel } from '@shared/kdf-levels'

// The 128 MiB level sits between two described ones, so it carries only its unlock time.
const HINTS: Readonly<Record<number, string>> = {
  7: 'Least memory, fastest unlock',
  4: 'Balances unlock time and resistance to guessing on most computers',
  2: 'Most memory, slowest unlock'
}

function levelLabel(level: KdfLevel): string {
  return `${level.memoryMiB} MiB${level.id === DEFAULT_KDF_LEVEL_ID ? ' (recommended)' : ''}`
}

// Argon2id time grows with memory at a fixed pass count, so one measurement prices the others.
const BASE_LEVEL = KDF_LEVELS[0]

function unlockTime(level: KdfLevel, baseMs: number | null): string | undefined {
  if (baseMs === null) return undefined
  const seconds = ((baseMs * level.memoryMiB) / BASE_LEVEL.memoryMiB / 1000).toFixed(1)
  return `${level.id === BASE_LEVEL.id ? '' : 'about '}${seconds} s to unlock on this computer`
}

function description(level: KdfLevel, baseMs: number | null): string {
  return [HINTS[level.id], unlockTime(level, baseMs)].filter(Boolean).join(' · ')
}

interface KdfLevelChooserProps {
  value: number
  onChange: (levelId: number) => void
}

export function KdfLevelChooser({ value, onChange }: KdfLevelChooserProps): ReactNode {
  const selected = KDF_LEVELS.find((l) => l.id === value)
  const [baseMs, setBaseMs] = useState<number | null>(null)
  const measuring = useRef(false)

  const handleOpenChange = (open: boolean): void => {
    if (!open || measuring.current) return
    measuring.current = true
    void notvex.vault.measureKdfLevel(BASE_LEVEL.id).then((res) => {
      if (res.success && res.data.status === 'measured') setBaseMs(res.data.ms)
    })
  }

  return (
    <Collapsible onOpenChange={handleOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="group w-full justify-start">
          Key derivation
          <span className="text-muted-foreground ml-auto font-normal">
            {selected && levelLabel(selected)}
          </span>
          <ChevronDownIcon className="transition-transform duration-300 group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 py-4">
        <p className="text-muted-foreground text-xs">
          Higher levels make offline password guessing slower, and take longer to open on slower
          computers. Pick one the slowest computer you&apos;ll use can open. Each level uses 3
          passes.
        </p>
        <RadioGroup
          value={String(value)}
          onValueChange={(id) => onChange(Number(id))}
          aria-label="Key derivation level"
        >
          {KDF_LEVELS.map((level) => (
            <FieldLabel key={level.id} htmlFor={`kdf-level-${level.id}`}>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{levelLabel(level)}</FieldTitle>
                  {description(level, baseMs) && (
                    <FieldDescription>{description(level, baseMs)}</FieldDescription>
                  )}
                </FieldContent>
                <RadioGroupItem value={String(level.id)} id={`kdf-level-${level.id}`} />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
        <Button
          variant="link"
          className="h-auto gap-1.5 p-0 text-xs font-normal"
          onClick={() => void notvex.shell.openExternal(KEY_DERIVATION_DOCS_URL)}
          aria-label="How to choose a level (opens in your browser)"
        >
          How to choose a level
          <ExternalLinkIcon className="size-3" aria-hidden />
        </Button>
      </CollapsibleContent>
    </Collapsible>
  )
}
