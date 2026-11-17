import { type ReactNode, useEffect, useRef, useState } from 'react'

import { ChevronDownIcon, ExternalLinkIcon, TriangleAlertIcon } from 'lucide-react'

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
import { Spinner } from '@/components/ui/spinner'
import { notvex } from '@/lib/ipc'
import { KEY_DERIVATION_DOCS_URL } from '@/lib/links'
import {
  DEFAULT_KDF_LEVEL_ID,
  KDF_LEVELS,
  type KdfLevel,
  type KdfMeasurement
} from '@shared/kdf-levels'

// The 128 MiB level sits between two described ones, so it carries only its unlock time.
const HINTS: Readonly<Record<number, string>> = {
  7: 'Least memory, fastest unlock',
  4: 'Balances unlock time and resistance to guessing on most computers',
  2: 'Most memory, slowest unlock'
}

// What measuring found, by level id.
type Measured = Readonly<Partial<Record<number, KdfMeasurement>>>

function levelLabel(level: KdfLevel): string {
  return `${level.memoryMiB} MiB${level.id === DEFAULT_KDF_LEVEL_ID ? ' (recommended)' : ''}`
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

// Argon2id time grows with memory at a fixed pass count, so one measurement prices the others.
const BASE_LEVEL = KDF_LEVELS[0]

interface UnlockTime {
  text: string
  estimated: boolean
}

// "0.4 s" once the level is measured, "~0.8 s" while it is only priced from the base level.
function unlockTime(level: KdfLevel, measured: Measured): UnlockTime | undefined {
  const own = measured[level.id]
  if (own)
    return own.status === 'measured'
      ? { text: `${seconds(own.ms)} s`, estimated: false }
      : undefined
  const base = measured[BASE_LEVEL.id]
  if (base?.status !== 'measured') return undefined
  const estimate = seconds((base.ms * level.memoryMiB) / BASE_LEVEL.memoryMiB)
  return { text: `~${estimate} s`, estimated: true }
}

interface TimeSlotProps {
  measuring: boolean
  failed: boolean
  time: UnlockTime | undefined
}

// What stands at the right of a card: a spinner while the level is measured, the failure when it
// could not be, otherwise its time. A failed measurement says nothing about whether the level
// fits, so it is a warning and the level stays selectable.
function TimeSlot({ measuring, failed, time }: TimeSlotProps): ReactNode {
  if (measuring) return <Spinner aria-hidden className="text-muted-foreground" />
  if (failed) {
    return (
      <span className="text-warning flex items-center gap-1.5 text-xs">
        <TriangleAlertIcon className="size-3" aria-hidden />
        Couldn&apos;t measure
      </span>
    )
  }
  if (!time) return null
  return (
    <>
      <span
        className={`text-sm tabular-nums ${time.estimated ? 'text-muted-foreground' : 'font-medium'}`}
      >
        {time.text}
      </span>
      <span className="sr-only">to unlock on this computer</span>
    </>
  )
}

interface KdfLevelChooserProps {
  value: number
  onChange: (levelId: number) => void
}

export function KdfLevelChooser({ value, onChange }: KdfLevelChooserProps): ReactNode {
  const selected = KDF_LEVELS.find((l) => l.id === value)
  const [measured, setMeasured] = useState<Measured>({})
  const [busy, setBusy] = useState(false)
  // Read out by screen readers only: the cards already show each result.
  const [status, setStatus] = useState('')
  const [outcome, setOutcome] = useState<'done' | 'failed' | null>(null)
  // Levels whose measurement failed in the last run: unlike an unavailable level, they may still fit.
  const [failedIds, setFailedIds] = useState<number[]>([])
  // The level whose time is being measured now; its card shows a spinner in place of the time.
  const [measuringId, setMeasuringId] = useState<number | null>(null)
  const measuring = useRef(false)
  // Each measurement blocks main for seconds, so a chooser that is gone must not start another.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleOpenChange = (open: boolean): void => {
    if (!open || measuring.current) return
    measuring.current = true
    setMeasuringId(BASE_LEVEL.id)
    // A failed measurement is tried again the next time the section opens.
    const retryOnNextOpen = (): void => {
      measuring.current = false
    }
    void notvex.vault
      .measureKdfLevel(BASE_LEVEL.id)
      .then((res) => {
        if (res.success) {
          const measurement = res.data
          setMeasured((m) => ({ ...m, [BASE_LEVEL.id]: measurement }))
        } else retryOnNextOpen()
      })
      .catch(retryOnNextOpen)
      .finally(() => setMeasuringId((id) => (id === BASE_LEVEL.id ? null : id)))
  }

  // One level at a time, so each card's spinner and the status follow the level in turn.
  // Main runs derivations back to back anyway, so timings stay accurate either way.
  const handleMeasureAll = async (): Promise<void> => {
    setBusy(true)
    setOutcome(null)
    setFailedIds([])
    let result = ''
    const failed: number[] = []
    const unavailable = new Set<number>()
    try {
      for (const [i, level] of KDF_LEVELS.entries()) {
        const prefix = result && `${result}. `
        setStatus(`${prefix}Measuring ${level.memoryMiB} MiB (${i + 1} of ${KDF_LEVELS.length})`)
        setMeasuringId(level.id)
        const res = await notvex.vault.measureKdfLevel(level.id).catch(() => null)
        if (!mounted.current) return
        if (res?.success) {
          const measurement = res.data
          setMeasured((m) => ({ ...m, [level.id]: measurement }))
          if (measurement.status === 'unavailable') unavailable.add(level.id)
          const found =
            measurement.status === 'measured' ? `${seconds(measurement.ms)} s` : 'unavailable'
          result = `${level.memoryMiB} MiB: ${found}`
        } else {
          failed.push(level.id)
          result = `${level.memoryMiB} MiB: couldn't measure`
        }
      }
      const fitting = KDF_LEVELS.filter((l) => !unavailable.has(l.id))
      if (unavailable.has(value) && fitting.length > 0) {
        const fallback = fitting[fitting.length - 1]
        onChange(fallback.id)
        result += `. Switched to ${fallback.memoryMiB} MiB`
      }
      setStatus(result)
      setFailedIds(failed)
      setOutcome(failed.length > 0 ? 'failed' : 'done')
    } finally {
      setMeasuringId(null)
      setBusy(false)
    }
  }

  return (
    <Collapsible onOpenChange={handleOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="group w-full justify-start">
          Key derivation{' '}
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
          passes. The time on each level is how long unlocking takes on this computer; ~ marks an
          estimate.
        </p>
        <RadioGroup
          value={String(value)}
          onValueChange={(id) => onChange(Number(id))}
          disabled={busy}
          aria-label="Key derivation level"
        >
          {KDF_LEVELS.map((level) => {
            const time = unlockTime(level, measured)
            const unavailable = measured[level.id]?.status === 'unavailable'
            return (
              <FieldLabel key={level.id} htmlFor={`kdf-level-${level.id}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{levelLabel(level)}</FieldTitle>
                    {HINTS[level.id] && <FieldDescription>{HINTS[level.id]}</FieldDescription>}
                    {unavailable && (
                      <FieldDescription className="text-destructive">
                        Not enough memory on this computer to use this level
                      </FieldDescription>
                    )}
                  </FieldContent>
                  <TimeSlot
                    measuring={measuringId === level.id}
                    failed={failedIds.includes(level.id)}
                    time={time}
                  />
                  <RadioGroupItem
                    value={String(level.id)}
                    id={`kdf-level-${level.id}`}
                    disabled={unavailable}
                  />
                </Field>
              </FieldLabel>
            )
          })}
        </RadioGroup>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || measuringId !== null}
            onClick={() => void handleMeasureAll()}
          >
            {busy ? (
              <>
                <Spinner aria-hidden />
                Measuring…
              </>
            ) : outcome === 'failed' ? (
              'Measure again'
            ) : (
              'Measure all levels'
            )}
          </Button>
          <p role="status" aria-atomic="true" className="sr-only">
            {status}
          </p>
          {outcome === 'done' && (
            <p className="text-muted-foreground text-xs">Measured all levels</p>
          )}
        </div>
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
