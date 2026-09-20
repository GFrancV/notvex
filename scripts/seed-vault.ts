/**
 * seed-vault.ts — Generates a demo .nvx vault populated with realistic notes
 * and tags, for taking marketing/website screenshots of the app in use.
 *
 * Must run under Electron's Node runtime (not plain `node`) because
 * @journeyapps/sqlcipher is a native addon rebuilt for Electron's ABI. See
 * package.json "seed:vault" script.
 */
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { addTagToNote, createNote, createTag, dbRun, trashNote, updateNote } from '../src/main/db/queries'
import { closeVault, createVault, getDb, getMasterKey } from '../src/main/vault/vault'

const DEMO_PASSWORD = 'NotvexDemo2026!'
const VAULT_PATH = resolve(__dirname, '../demo/notvex-demo.nvx')

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.now()
const daysAgo = (n: number): number => NOW - n * DAY_MS

interface TagDef {
  name: string
  color: string
}

// Reuses the app's real preset palette (src/renderer/src/lib/tag-colors.ts).
// Two tags intentionally reuse a color — palettes run out in real usage too.
const TAGS: TagDef[] = [
  { name: 'Work', color: '#3b82f6' },
  { name: 'Personal', color: '#6366f1' },
  { name: 'Ideas', color: '#8b5cf6' },
  { name: 'Recipes', color: '#f97316' },
  { name: 'Travel', color: '#14b8a6' },
  { name: 'Finance', color: '#f59e0b' },
  { name: 'Reading', color: '#84cc16' },
  { name: 'Health', color: '#10b981' },
  { name: 'Project Aurora', color: '#ec4899' },
  { name: 'Urgent', color: '#ef4444' },
  { name: 'Journal', color: '#8b5cf6' },
  { name: 'Archive', color: '#3b82f6' }
]

interface NoteDef {
  title: string
  content: string
  tags: string[]
  createdDaysAgo: number
  updatedDaysAgo: number
  pinned?: boolean
  trashed?: boolean
  trashedDaysAgo?: number
}

const NOTES: NoteDef[] = [
  {
    title: 'Q3 Product Roadmap',
    tags: ['Work', 'Project Aurora'],
    createdDaysAgo: 96,
    updatedDaysAgo: 1,
    pinned: true,
    content: `# Q3 Product Roadmap

High-level plan for Project Aurora through end of Q3. Keep this updated after each planning review.

## Themes

1. **Performance** — cut cold-start time in half
2. **Offline sync** — resilient reconnect after network drop
3. **Onboarding** — reduce time-to-first-note under 60s

## Milestones

- [x] Kickoff + scoping doc
- [x] Design review with Sam
- [ ] Beta build to internal testers
- [ ] Public changelog draft
- [ ] GA release

## Owners

| Workstream    | Owner  | Target date |
| ------------- | ------ | ------------ |
| Performance   | Priya  | Aug 15       |
| Offline sync  | Marco  | Aug 29       |
| Onboarding    | Dana   | Sep 5        |

> Reminder: freeze feature scope one week before GA. No exceptions this cycle — last time we shipped late.
`
  },
  {
    title: 'Standup Notes — Jun 30',
    tags: ['Work'],
    createdDaysAgo: 9,
    updatedDaysAgo: 9,
    content: `## Standup — Jun 30

**Me:**
- Finished pagination fix for the notes list
- Started on the offline sync spike

**Blockers:** none

**Team:**
- Priya: profiling cold start, found a slow migration check
- Marco: reviewing PR #214 (sync retry logic)
`
  },
  {
    title: 'Standup Notes — Jul 2',
    tags: ['Work'],
    createdDaysAgo: 7,
    updatedDaysAgo: 7,
    content: `## Standup — Jul 2

**Me:**
- Offline sync spike done, writing up findings
- Picking up the bug triage backlog today

**Blockers:** waiting on staging creds from Marco

**Team:**
- Dana: onboarding flow wireframes ready for review
`
  },
  {
    title: 'Bug Triage: Auth flow crash on logout',
    tags: ['Work', 'Urgent'],
    createdDaysAgo: 4,
    updatedDaysAgo: 1,
    content: `## Bug: crash on logout when offline

**Reported by:** support ticket #1042
**Severity:** High — affects ~3% of sessions

### Repro steps

1. Open the app while offline
2. Log out from the settings menu
3. App crashes instead of returning to the lock screen

### Notes

Looks like the session cleanup handler assumes the network call to invalidate
the token succeeds before clearing local state. Needs a local-first fallback.

\`\`\`js
async function logout() {
  await invalidateRemoteSession() // throws when offline — need try/catch
  clearLocalSession()
}
\`\`\`

- [x] Confirmed repro locally
- [ ] Patch + add offline test case
- [ ] Ship in next patch release
`
  },
  {
    title: 'Project Aurora — Architecture Notes',
    tags: ['Work', 'Project Aurora', 'Ideas'],
    createdDaysAgo: 88,
    updatedDaysAgo: 30,
    content: `# Architecture notes

Rough notes from whiteboarding the sync layer with Marco.

## Sync queue

- Every local write appends an op to a durable queue
- Queue flushes on reconnect, oldest first
- Conflicts resolved last-write-wins for now, revisit if it becomes an issue

\`\`\`sql
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY,
  op_type TEXT NOT NULL,
  payload BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
\`\`\`

## Open questions

- Do we need vector clocks eventually, or is LWW good enough long term?
- How do we surface conflicts to the user without being annoying?
`
  },
  {
    title: '1:1 with Sam — Jun 18',
    tags: ['Work'],
    createdDaysAgo: 21,
    updatedDaysAgo: 21,
    content: `## 1:1 with Sam

- Talked through Q3 roadmap priorities, agreed offline sync is the biggest bet
- Sam mentioned budget for one more contractor in August
- Action: send Sam the perf profiling doc by Friday
`
  },
  {
    title: 'Sprint Retro — Cycle 14',
    tags: ['Work'],
    createdDaysAgo: 14,
    updatedDaysAgo: 14,
    content: `## Retro — Cycle 14

**Went well**
- Shipped the pagination fix ahead of schedule
- Good pairing session on the sync spike

**Could improve**
- Standups ran long twice this cycle — keep to 10 min
- Need clearer bug severity definitions

**Action items**
- [ ] Write down severity guidelines in the wiki
- [ ] Timebox standups with a visible timer
`
  },
  {
    title: "Duplicate — Sprint Retro notes",
    tags: ['Work'],
    createdDaysAgo: 14,
    updatedDaysAgo: 14,
    trashed: true,
    trashedDaysAgo: 6,
    content: `## Retro — Cycle 14 (duplicate, use the other one)

Accidentally created this twice, real notes are in the other Sprint Retro note.
`
  },
  {
    title: "Grandma's Banana Bread",
    tags: ['Recipes'],
    createdDaysAgo: 60,
    updatedDaysAgo: 60,
    content: `# Grandma's Banana Bread

Never fails. Use the bananas once they're almost black.

## Ingredients

- 3 very ripe bananas, mashed
- 1/3 cup melted butter
- 3/4 cup sugar
- 1 egg, beaten
- 1 tsp vanilla
- 1 tsp baking soda
- pinch of salt
- 1 1/2 cups flour

## Steps

1. Preheat oven to 350°F (175°C), grease a loaf pan
2. Mix mashed banana with melted butter
3. Stir in sugar, egg, and vanilla
4. Sprinkle baking soda and salt over the mix, stir in
5. Add flour last, mix until just combined — don't overmix
6. Bake 55–60 minutes, until a toothpick comes out clean

> Tip: add a handful of walnuts or chocolate chips if you're feeling fancy.
`
  },
  {
    title: 'Weeknight Chicken Stir-Fry',
    tags: ['Recipes', 'Health'],
    createdDaysAgo: 33,
    updatedDaysAgo: 5,
    content: `# Weeknight Chicken Stir-Fry

20 minutes, one pan, always good.

## Ingredients

- 1 lb chicken breast, sliced thin
- 2 cups mixed vegetables (broccoli, carrot, snap peas)
- 3 tbsp soy sauce
- 1 tbsp rice vinegar
- 1 tsp sesame oil
- 2 cloves garlic, minced
- 1 tsp fresh ginger, grated

## Steps

1. Sear chicken in a hot pan until golden, set aside
2. Stir-fry vegetables 3–4 minutes, keep them crisp
3. Add garlic and ginger, cook 30 seconds until fragrant
4. Return chicken to the pan, add sauce, toss until glossy
5. Serve over rice

- [x] Buy snap peas
- [ ] Double the sauce next time — never enough
`
  },
  {
    title: 'Meal Prep Sunday Checklist',
    tags: ['Recipes', 'Health'],
    createdDaysAgo: 12,
    updatedDaysAgo: 2,
    content: `## Meal prep checklist

- [x] Grocery run
- [x] Cook grains (rice + quinoa)
- [x] Roast vegetables
- [ ] Portion into containers
- [ ] Prep overnight oats for the week
- [ ] Wash and cut fruit
`
  },
  {
    title: 'Japan Trip 2026 — Itinerary',
    tags: ['Travel'],
    createdDaysAgo: 70,
    updatedDaysAgo: 3,
    pinned: true,
    content: `# Japan Trip — Oct 2026

## Itinerary

| Days  | City   | Notes                         |
| ----- | ------ | ------------------------------ |
| 1–3   | Tokyo  | Shinjuku hotel, day trip Nikko |
| 4–5   | Hakone | Onsen ryokan, Mt Fuji views    |
| 6–9   | Kyoto  | Temples, Arashiyama bamboo     |
| 10    | Osaka  | Food crawl, fly home from KIX  |

## Bookings

- [x] Flights booked
- [x] JR Pass ordered
- [x] Ryokan in Hakone confirmed
- [ ] Book Ghibli Museum tickets (release date TBD)
- [ ] Reserve Kyoto kaiseki dinner

> Check visa requirements again closer to the date, rules changed last year.
`
  },
  {
    title: 'Packing List — Japan',
    tags: ['Travel'],
    createdDaysAgo: 15,
    updatedDaysAgo: 15,
    content: `## Packing list

- [x] Passport + printed itinerary
- [x] JR Pass exchange voucher
- [ ] Portable wifi router (or eSIM)
- [ ] Comfortable walking shoes
- [ ] Rain jacket — October can be wet
- [ ] Portable charger
- [ ] Cash (many places still don't take cards)
`
  },
  {
    title: 'Lisbon Weekend — Ideas',
    tags: ['Travel', 'Ideas'],
    createdDaysAgo: 40,
    updatedDaysAgo: 40,
    content: `## Lisbon long weekend, maybe spring 2027

Rough ideas, nothing booked yet.

- Alfama neighborhood for the views and fado bars
- Day trip to Sintra — Pena Palace
- Time Out Market for lunch on arrival day
- Try to catch a Benfica game if the dates line up
`
  },
  {
    title: '2026 Reading List',
    tags: ['Reading'],
    createdDaysAgo: 110,
    updatedDaysAgo: 8,
    content: `# 2026 Reading List

| Title                     | Author            | Status      |
| ------------------------- | ----------------- | ----------- |
| Atomic Habits              | James Clear        | Finished    |
| Deep Work                  | Cal Newport        | Finished    |
| Project Hail Mary          | Andy Weir          | Finished    |
| The Pragmatic Programmer   | Hunt & Thomas      | Reading     |
| Sapiens                    | Yuval Noah Harari  | Up next     |
| Thinking, Fast and Slow    | Daniel Kahneman    | Up next     |
`
  },
  {
    title: 'Notes: Atomic Habits',
    tags: ['Reading', 'Personal'],
    createdDaysAgo: 95,
    updatedDaysAgo: 95,
    content: `## Atomic Habits — notes

- Habits compound like interest — 1% better every day adds up
- Focus on **systems**, not goals — the goal is just the outcome of a good system
- Four laws: make it obvious, make it attractive, make it easy, make it satisfying
- Habit stacking: "After [current habit], I will [new habit]"

**Applying this:** stacked a 5-minute journal entry right after my morning coffee.
`
  },
  {
    title: 'Notes: Deep Work',
    tags: ['Reading'],
    createdDaysAgo: 80,
    updatedDaysAgo: 80,
    content: `## Deep Work — notes

- Deep work: cognitively demanding work done without distraction
- Shallow work is easy to do but rarely creates much value
- Schedule deep work like you'd schedule a meeting — block the calendar
- Quitting social media doesn't have to be all-or-nothing, but constant switching is the real cost
`
  },
  {
    title: 'Monthly Budget — June 2026',
    tags: ['Finance'],
    createdDaysAgo: 25,
    updatedDaysAgo: 6,
    content: `# Monthly Budget — June 2026

| Category      | Budgeted | Actual  |
| -------------- | -------- | ------- |
| Rent           | $1,450   | $1,450  |
| Groceries      | $350     | $392    |
| Transport      | $120     | $98     |
| Dining out     | $150     | $210    |
| Savings        | $500     | $500    |
| Misc           | $100     | $76     |

**Notes:** dining out crept up again — two birthday dinners this month. Groceries
also a bit over because of the trip prep shopping.
`
  },
  {
    title: 'Passwords to Rotate',
    tags: ['Finance', 'Urgent'],
    createdDaysAgo: 3,
    updatedDaysAgo: 0,
    pinned: true,
    content: `## Passwords to rotate this month

- [ ] Bank login (haven't changed in 2 years)
- [ ] Email recovery codes — regenerate and print
- [x] Work VPN password
- [ ] Home wifi password (kids keep sharing it with friends)

> Use the password manager, don't reuse anything across these.
`
  },
  {
    title: 'Freelance Invoice Tracker',
    tags: ['Finance', 'Work'],
    createdDaysAgo: 50,
    updatedDaysAgo: 4,
    content: `## Invoice tracker

| Client       | Invoice # | Amount | Status  |
| ------------- | --------- | ------ | ------- |
| Northwind Co. | INV-014   | $1,200 | Paid    |
| Northwind Co. | INV-015   | $1,200 | Sent    |
| Blue Harbor   | INV-006   | $800   | Overdue |

- [ ] Follow up with Blue Harbor about INV-006
- [ ] Send INV-016 to Northwind next Friday
`
  },
  {
    title: 'Morning Journal — Jul 8',
    tags: ['Journal', 'Personal'],
    createdDaysAgo: 1,
    updatedDaysAgo: 1,
    content: `## Jul 8

Slept better last night, felt it this morning. Went for a short run before
work instead of after — might stick with that.

Feeling good about the roadmap doc, just need Sam's sign-off. A little
anxious about the Blue Harbor invoice being overdue, should just call them
instead of emailing again.

Small win: finally fixed the squeaky drawer in the kitchen.
`
  },
  {
    title: 'Journal — New Job Reflections',
    tags: ['Journal', 'Personal'],
    createdDaysAgo: 45,
    updatedDaysAgo: 45,
    content: `## Three months in

Hard to believe it's been three months already. Things I've noticed:

- The team is much more async than my last job, took a while to adjust
- I undersold my sync experience in the interview — turns out it's exactly
  what they needed for Project Aurora
- Still figuring out the right work/life boundary with a fully remote setup

Overall: glad I made the move.
`
  },
  {
    title: 'Workout Log — Week 27',
    tags: ['Health'],
    createdDaysAgo: 2,
    updatedDaysAgo: 2,
    content: `## Week 27

| Day       | Workout                  | Notes                  |
| --------- | ------------------------ | ----------------------- |
| Mon       | 5k easy run               | Felt good, 26:40        |
| Tue       | Rest                      |                         |
| Wed       | Strength — legs           | New squat PR: 185 lb    |
| Thu       | 5k easy run               | Slower, humid, 28:10    |
| Fri       | Rest                      |                         |
| Sat       | Long run — 10k            | 58:20, kept even pace   |
`
  },
  {
    title: 'Running Plan — Half Marathon',
    tags: ['Health', 'Personal'],
    createdDaysAgo: 30,
    updatedDaysAgo: 2,
    content: `## Half marathon training — 12 weeks out

Goal: sub 1:55 at the fall half.

- [x] Weeks 1–4: base building, 3 runs/week
- [x] Weeks 5–8: add tempo runs
- [ ] Weeks 9–10: peak mileage
- [ ] Weeks 11–12: taper
- [ ] Race day — Oct 18

**Notes:** knee felt a little tight after the last long run, keep an eye on it
and don't skip the stretching.
`
  },
  {
    title: "Book Club — 'Project Hail Mary' Discussion",
    tags: ['Reading', 'Personal'],
    createdDaysAgo: 18,
    updatedDaysAgo: 18,
    content: `## Book club — Project Hail Mary

Everyone loved this one, best pick in a while.

- Favorite part: the friendship arc, surprisingly emotional for a hard sci-fi book
- Debated whether the ending was too neat — split opinions
- Next pick: **Sapiens** — meeting in 3 weeks
`
  },
  {
    title: 'Random Ideas Dump',
    tags: ['Ideas'],
    createdDaysAgo: 55,
    updatedDaysAgo: 10,
    content: `## Random ideas, unsorted

- A tiny CLI that reminds me to stand up every hour
- Weekend project: build a simple budgeting spreadsheet template to share
- Newsletter idea: short weekly writeup of what I learned at work
- Maybe finally learn how to bake sourdough properly
`
  },
  {
    title: 'Useful CLI Snippets',
    tags: ['Work', 'Ideas'],
    createdDaysAgo: 65,
    updatedDaysAgo: 20,
    content: `## CLI snippets I keep looking up

Find the largest files in a directory tree:

\`\`\`bash
du -ah . | sort -rh | head -20
\`\`\`

Kill whatever's listening on a port:

\`\`\`bash
lsof -ti:3000 | xargs kill -9
\`\`\`

Quick local server for a static folder:

\`\`\`bash
python3 -m http.server 8000
\`\`\`
`
  },
  {
    title: 'SQL Cheatsheet (old)',
    tags: ['Work', 'Ideas', 'Archive'],
    createdDaysAgo: 100,
    updatedDaysAgo: 100,
    trashed: true,
    trashedDaysAgo: 20,
    content: `## Old SQL notes, superseded by the team wiki page

\`\`\`sql
SELECT n.id, n.title
FROM notes n
JOIN note_tags nt ON nt.note_id = n.id
WHERE nt.tag_id = ?;
\`\`\`

Keeping this around just in case, but the wiki version is more complete now.
`
  }
]

async function main(): Promise<void> {
  mkdirSync(dirname(VAULT_PATH), { recursive: true })
  if (existsSync(VAULT_PATH)) unlinkSync(VAULT_PATH)
  if (existsSync(VAULT_PATH + '.lock')) unlinkSync(VAULT_PATH + '.lock')

  console.log(`Creating demo vault at ${VAULT_PATH} ...`)
  await createVault(VAULT_PATH, DEMO_PASSWORD)

  const db = getDb()
  const masterKey = getMasterKey()

  const tagIdByName = new Map<string, string>()
  for (const [i, tag] of TAGS.entries()) {
    const created = await createTag(db, { name: tag.name, color: tag.color })
    tagIdByName.set(tag.name, created.id)
    // Spread tag creation dates out too, oldest tags roughly track the oldest notes.
    await dbRun(db, 'UPDATE tags SET created_at = ? WHERE id = ?', [
      daysAgo(110 - i * 8),
      created.id
    ])
  }

  for (const note of NOTES) {
    const created = await createNote(db, { title: note.title, content: note.content }, masterKey)

    for (const tagName of note.tags) {
      const tagId = tagIdByName.get(tagName)
      if (!tagId) throw new Error(`Unknown tag "${tagName}" referenced by note "${note.title}"`)
      await addTagToNote(db, created.id, tagId)
    }

    if (note.pinned) {
      await updateNote(db, created.id, { isPinned: true }, masterKey)
    }
    if (note.trashed) {
      await trashNote(db, created.id)
    }

    const createdAt = daysAgo(note.createdDaysAgo)
    const updatedAt = daysAgo(note.updatedDaysAgo)
    const trashedAt = note.trashed ? daysAgo(note.trashedDaysAgo ?? note.updatedDaysAgo) : null

    await dbRun(db, 'UPDATE notes SET created_at = ?, updated_at = ?, trashed_at = ? WHERE id = ?', [
      createdAt,
      updatedAt,
      trashedAt,
      created.id
    ])
  }

  await closeVault()

  console.log('')
  console.log('Demo vault created:')
  console.log(`  Path:     ${VAULT_PATH}`)
  console.log(`  Password: ${DEMO_PASSWORD}`)
  console.log(`  Notes:    ${NOTES.length} (${NOTES.filter((n) => n.trashed).length} in trash, ${NOTES.filter((n) => n.pinned).length} pinned)`)
  console.log(`  Tags:     ${TAGS.length}`)
}

main().catch((err) => {
  console.error('Seeding failed:', err)
  process.exit(1)
})
