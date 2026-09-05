# Weplay Hand Tracker

A hand history manager for Weplay poker — import your hands, browse and
filter them, review any hand in its own window (original Weplay text or
CoinPoker format side by side), and convert them into CoinPoker's format so
Hand2Note / PokerTracker can also read them directly.

## Setup

Requires [Node.js](https://nodejs.org) **22.5 or later** (needed for the
built-in `node:sqlite` module the hand database is built on — see "Storage"
under Hand Database below) and an internet connection for the one-time
install.

```bash
npm install
npm start
```

That's it — no other dependencies. The zip export, hand-history parsing, and
hand database are all hand-rolled or built on Node's own built-ins, zero
external packages; `electron` (and `electron-builder`, only needed if you're
building the Windows installer below) are the only things `npm install`
needs to fetch.

## Building a Windows installer (.exe) to share with others

This packages the app into a normal Windows installer — double-click, click
through a wizard, get a Start Menu shortcut and an uninstaller, same as any
other Windows program. The people you send it to don't need Node.js,
Electron, or anything else installed; the installer bundles everything.

There's no code involved on their end — you build the `.exe` once, then just
send that one file around.

### Option A — build it on a Windows machine (simplest)

If you (or a friend) have a Windows PC with [Node.js](https://nodejs.org)
installed:

```bash
npm install
npm run dist
```

The installer shows up at `dist\Weplay Hand Converter Setup <version>.exe`.
Send that file to whoever wants it.

### Option B — build it without owning a Windows machine (GitHub Actions)

This repo includes a ready-to-use GitHub Actions workflow
(`.github/workflows/build-windows.yml`) that builds the installer on a real
Windows machine in the cloud, for free, on GitHub's own infrastructure:

1. Push this project to a GitHub repository (public or private — private
   repos get free Actions minutes too, this project is far too small to hit
   any limit).
2. Go to the repo's **Actions** tab → **Build Windows installer** → **Run
   workflow** (or just push a commit — it also runs automatically on every
   push to `main`).
3. When it finishes (a couple of minutes), open the completed run and
   download the `weplay-hand-converter-windows-installer` artifact — that's
   your `.exe`.

No Windows machine, no Wine, nothing to install locally beyond a GitHub
account.

### Option C — cross-compile from Mac/Linux

electron-builder can build a Windows installer from Mac or Linux too, but it
needs [Wine](https://www.winehq.org) installed to run the Windows-specific
installer tooling. On Linux: `sudo apt install wine` (or your distro's
equivalent), then `npm run dist` as above. This tends to be the fussiest of
the three options — Option A or B are more reliable if either is available
to you.

### A heads-up about SmartScreen

The installer isn't code-signed (that needs a paid certificate, generally
not worth it just to share a tool with friends), so Windows will likely show
a **"Windows protected your PC"** SmartScreen warning the first time someone
runs it. That's expected for any unsigned app, not a sign anything's wrong —
click **More info → Run anyway**. Worth mentioning to whoever you send it to
so they aren't caught off guard.

### .msi instead of .exe?

The config here produces an NSIS-based `.exe` installer (the standard,
polished option — install wizard, Start Menu shortcut, proper uninstaller).
electron-builder can also produce a real `.msi` if you specifically need one
(e.g. for Group Policy deployment in a corporate environment) by adding
`"target": "msi"` alongside `"nsis"` in the `build.win.target` array in
`package.json`. For sending a converter to friends, the `.exe` is simpler and
is what most people expect.

## Using it

The app has two tabs — **Hands** and **Import Hands**. **Hands** (the
default, and the primary way to use the app day-to-day) is a single merged
page: your persistent database, filters, a stats overview, and the hands
table all together — see "Player Overview & Advanced Stats" below for how those fit together.
**Import Hands** (last, since it matters less day-to-day now that the
database exists) is where the drag/drop area, Browse, Convert & Save, and
Import to Hand Database live — kept on its own tab so it doesn't clutter
the Hands page once you're just browsing or checking stats.

1. Switch to the **Import Hands** tab. Drag your Weplay `.txt` hand history
   file(s) — or a `.zip` archive containing them — onto the window, or click
   **Browse files…** (which also accepts both `.txt` and `.zip`). Zip
   archives are extracted automatically: nested folders inside are
   flattened, and non-hand-history entries (other file types, macOS junk
   like `__MACOSX/` or `.DS_Store`) are skipped silently. This is the
   easiest way to bring in a large batch at once. A spinner covers the
   window and every button is disabled while a large import (or convert or
   import-to-database) is in progress, so there's no ambiguity about
   whether it's still working. The file list itself just shows a one-line
   summary (file count and total hand count) rather than listing every file
   — click **Show files** if you want the detail view, including per-file
   removal. If the same hand ID shows up in more than one loaded file,
   that's flagged directly in the summary line — it usually means two
   overlapping exports got loaded together, which would otherwise silently
   double-count those hands in PokerTracker.
2. Leave **Replace my username with `Hero`** checked, unless you specifically
   want your real Weplay username preserved in the output.
3. Pick what you need:
   - **Import to Hand Database** → adds these hands to the persistent,
     browsable database, and the Hands page's stats overview updates to
     include them too. This is the one to use day-to-day.
   - **Convert & Save** → produces CoinPoker-format files and immediately
     opens the save dialog — a single file saves as `.txt`, multiple save as
     a `.zip` — no separate "Save" step needed. Check the results panel first
     (expand any file to see individual flagged hands, see "Reading the
     results panel" below), then point Hand2Note/PokerTracker's importer at
     the CoinPoker room.

## Reading the results panel

Every hand that produced a warning, or was skipped, shows up individually
(not just as a flat list) so you can see exactly which hand had which issue.
Each one is color-coded by how confident the conversion actually is:

- **Red — "New pattern"**: something this converter has never seen before
  (an unrecognized line format, an unrecognized hand description, and so
  on). These are the ones actually worth a look — every real bug found
  during development showed up first as exactly this. If you see one,
  clicking that hand's **Copy for support** button copies a ready-to-paste
  report (the raw Weplay hand, the warnings, and the converted output all
  together) — paste that back for a fix, no digging through the source file
  needed.
- **Amber — "Known caveat"**: an already-understood, documented best-effort
  case (a side pot, a run-it-twice hand, a reassigned button, and so on).
  These convert correctly as far as testing has been able to confirm, but
  are flagged because the underlying assumption isn't independently verified
  against a real CoinPoker sample — see the Scope section below for exactly
  which assumptions those are.
- **Red — "Skipped"**: the hand couldn't be converted at all, with the
  reason given directly (e.g. a genuinely corrupted source hand with no
  declared winner). Also has a **Copy for support** button.

The summary bar at the top of the results totals these up across every file
in the batch, so a quick glance tells you whether anything in a large batch
needs a second look before you import it.

## Player Overview & Advanced Stats

**Player Overview** and the hands table are the same page (still not
separate tabs) — one shared filter bar at the top drives both at once. See
"Layout" further down for the visual structure, and "Using it" for exactly
what each filter does.

Player Overview deliberately shows a compact, Dojson-HUD-style summary — 9
headline numbers (Hands, Winnings, VPIP, Home, Winrate, PFR, WWSF, Expected
V, 3Bet) plus the cumulative-results-over-time chart — not the full stat
breakdown. "Home" is whichever stake bucket has the most hands under the
current filters, not necessarily the currently-selected stakes filter.

**Advanced Stats** has the rest: a grouped HUD table covering every stat
`stats.js` computes (VPIP, PFR, RFI%, Limp%, Cold Call%, 3-Bet%/Fold to
3-Bet%, 4-Bet%/Fold to 4-Bet%, Squeeze%, Attempt to Steal%/Fold to Steal%,
Flop/Turn/River C-Bet% and Fold to C-Bet%, Flop/Turn/River Check-Raise%,
Aggression Factor, Flop/Turn/River Aggression, WTSD%, W$SD%, W$WSF%), plus
the hand-by-hand results graph underneath it. Both tabs read from the same
`aggregateStats()` payload — always computed over whatever the current
filters match, not the whole database unconditionally, by re-running the
same stats engine against the raw text of every matching hand (not a
separate, lighter computation), so neither tab can ever silently drift from
what the hands table itself is showing.

The grouped sections in Advanced Stats' HUD table (Preflop, Steal, C-Bet,
Check-Raise, Aggression & Showdown) are this app's own organization, not a
1:1 clone of Dojson's — Dojson's IP/OOP, BvB, and PROBE/DONK/STAB splits
need seat-position-relative tracking this app's stats engine doesn't have
yet (a deliberately deferred "Phase 3").

A few things worth knowing about how these numbers are computed:

- **Flop/Turn/River Aggression ("Agg% (PT)") is verified against a real
  PokerTracker 4 report, not just a documented definition** — `(bets +
  raises) / (bets + raises + calls + checks) × 100`, per street, with
  FOLDS excluded from the denominator. This has been through two rounds:
  it briefly switched to DriveHUD's "Agg%" (checks included, folds also
  included) after an investigation into why reported numbers looked
  flatteringly high, then got reverted back to the textbook AFq
  definition (`bets+raises over bets+raises+calls+folds`, checks
  excluded) per explicit instruction, since AFq is the most consistently
  documented formula across independent sources (PokerTracker's own
  forum, Upswing Poker, poker terminology glossaries) — the dominant
  industry convention, not a fringe one. That reasoning held right up
  until the user ran this app's own CoinPoker-converted export through
  real PokerTracker 4 and compared its actual generated report against
  this app's numbers: PT4's own per-street columns (labeled "HM F/T/R
  Agg%" in its CSV export — it borrows Hold'em Manager's convention
  specifically for this breakdown, not its own native AFq) do NOT use
  the textbook AFq formula at all. Checked against two real months of
  that report: once a month's hand count actually lined up between the
  two databases (July 2026, off by only ~1.3%), the folds-excluded/
  checks-included formula matched PokerTracker's reported 25.7/32.5/32.5
  within ~1.5 points on every street, while textbook AFq was off by
  roughly 15 points per street on the same hands. PokerTracker's own
  AGGREGATE stat is a different story — this app's textbook-AFq counts,
  summed across all three streets, matched PokerTracker's reported
  "Total AFq" almost exactly (45.2% vs. 45.27% for July) — so AFq itself
  isn't wrong, PokerTracker's own per-street report just doesn't use it.
  Kept distinct from "Agg% (DriveHUD)" (both folds AND checks included)
  reported alongside it, and from this app's existing Aggression Factor
  (a ratio, bets+raises over calls, folds and checks all excluded) — a
  genuinely different question (how aggressive vs. passive a player's
  postflop volume is, not a per-street breakdown of it) that isn't meant
  to be directly compared to either percentage.
- **An August 2026 comparison against that same PokerTracker report
  surfaced a separate, unresolved discrepancy worth flagging: this
  database had 23,723 hero hands for August vs. PokerTracker's reported
  15,125** — bomb pots don't explain it (only 1,081 of the extra ~8,600).
  July's gap is much smaller (17,655 vs. 17,427) and squares with the
  Agg% (PT) numbers matching almost exactly that month specifically —
  strongly suggesting August's residual Agg% (PT) gap is a population
  difference (a different set of hands being compared), not a formula
  error, but the root cause of the August hand-count gap itself hasn't
  been investigated yet.
- **The "opportunities" count can exceed the number of times a street was
  seen** — this looks like it should be a bug at first glance (this
  project's own flop opportunities came out higher than hands that saw a
  flop at all) but isn't: a single street can have more than one decision
  point if the action comes back around — check, then facing a bet and
  folding is two decisions on one flop, both counted, confirmed by
  tracing a real hand with exactly that pattern against the raw text
  before trusting the aggregate number.

- **3-Bet% and Fold to 3-Bet% denominators were a real bug, now fixed.**
  3-Bet% is `(times you re-raised while facing exactly one prior raise) /
  (times you faced exactly one prior raise at all, regardless of what you
  did about it)`. The bug: it was dividing by *every hand played* instead of
  just the real opportunities — most hands never even give you a
  single-raise decision to respond to, so that made the rate look far lower
  than it really was (verified against a real 216-file batch: 3-Bet% went
  from a bogus ~3.6% to a believable 9.7% after the fix). Fold to 3-Bet% has
  the matching bug fixed the same way: the denominator is now `(times your
  own open specifically got re-raised)`, not `(every hand you opened)` —
  most opens never get 3-bet in the first place, so counting all of them
  inflated the denominator and deflated the rate (~9% → a believable 57.1%
  on the same real batch).
- **WTSD only counts a genuine multi-way contest, and divides by hands that
  saw a flop** (PokerTracker's own convention), not by every hand dealt —
  also a real bug, also fixed. Weplay shows the same `*** SHOW DOWN ***`
  header text even when a hand ends via an uncontested fold-out with zero
  cards ever shown, and dividing by all hands (rather than just flop-seen
  ones) understates the rate on top of that. Real-batch numbers went from a
  nonsensical 86% W$SD / 6.6% WTSD in an early version to a believable
  58.9% W$SD / 26.9% WTSD after both fixes.
- **Bomb pot hands are automatically excluded from VPIP, PFR, 3-Bet, Fold to
  3-Bet, and the by-position table.** A bomb pot has no preflop betting round
  at all — including those hands would silently deflate every one of those
  rates. They're still counted in the overall hand count, net result, and
  winrate. Since a table with "Bomb Pot" in its name is actually mostly
  normal hands with bomb pots mixed in periodically (confirmed from real
  data), this distinction matters more than it might sound.
- **Hands with no resolution anywhere are excluded**, not counted as a $0
  hand — mirrors the same real Weplay data gap the converter itself handles
  (e.g. a disconnect at showdown that's never resolved in the source).
- **Winrate (bb/100) is normalized per-hand by that hand's own big blind
  size** before combining, so mixed stakes in one batch don't distort the
  overall figure.
- Position labels reflect how many players were actually seated in that
  specific hand, not the table's nominal max-seats — very often shorthanded.

This has its own dedicated test suite (`test/stats.test.js`) covering every
edge case above with a synthetic hand, but it's newer and less battle-tested
against real data at scale than the converter itself — worth treating the
numbers as a solid estimate rather than a fully audited final answer, the
same way you'd sanity-check any new tracker software before fully trusting it.

### EV winrate

"EV winrate" — sometimes called all-in adjusted winnings, or $EV — removes
run-out variance from hands where the money went in before the hand was
fully dealt out. Instead of counting what actually happened (which depends
on which of the remaining cards came, i.e. luck), it counts what should
have happened on average given each player's known hand at the moment no
more decisions were left to make. Shown right next to regular Winrate on
the Stats tab; the gap between the two is what's usually called "luck" in
tracker software.

**How it's computed:**
1. **Find the all-in moment** — the point after which every remaining street
   has zero actions (both players fully committed, nothing left to decide).
2. **Compute each player's equity there** — their win probability given
   both known hands and the board so far. This needed a real poker hand
   evaluator (`src/handEvaluator.js`, ranks any 5–7 card hand) and an
   equity engine (`src/equity.js`): exact full-board enumeration when cheap
   (a turn or river all-in — at most ~1,000 board combinations), Monte
   Carlo sampling (10,000 trials) when it isn't (a preflop all-in means up
   to ~1.7 million combinations — exact enumeration there was measured at
   over 2.5 minutes for a single hand, confirming Monte Carlo is the right
   call, not a shortcut).
3. **Replace the actual result with the expected one** for that pot:
   `equity × pot` instead of the actual payout, everything else about the
   hand's result unchanged.
4. **Combine into bb/100** the same way regular winrate is — this is exactly
   the formula you described; the part that needed real engineering was
   computing "equity" itself, not the formula on top of it.

**Verified against a real, authoritative source, not just self-consistency.**
AA vs KK preflop is one of the most commonly cited poker statistics, so it's
a good benchmark. First pass gave 81.26% for AA — a real discrepancy against
TryBluff's cited "81.9% equity, exact figures from full board enumeration."
Rather than wave that off, it got debugged properly: the combination
generator was verified correct in isolation, specific boards were hand-
checked against the evaluator's own judgment, and exact enumeration was
cross-checked against independent Monte Carlo sampling (both agreed with
each other, ruling out a method-specific bug). The actual explanation turned
out to be suit alignment, a real and well-documented poker phenomenon, not a
bug: `AcAd vs KhKs` (no shared suit between the two hands) is genuinely
~81.2% for AA; `AhAd vs KhKs` (one shared suit) reproduces TryBluff's exact
81.9% figure. Both numbers this engine produces are correct — the earlier
draft of this README had assumed one universal "the" AA-vs-KK number, which
isn't actually how it works. A second independent benchmark (AK vs QQ, the
classic "coinflip" spot, commonly cited at 43–46% for AK) landed at 42.8%,
consistent with published figures. Full evaluator and equity test suites
(`test/handEvaluator.test.js`, `test/equity.test.js`) lock all of this in.

**Performance and caching.** Running this fresh every time the Stats tab
loads was tested and rejected — Monte Carlo sampling for every qualifying
hand in the real 22,889-hand database took over 30 seconds (after an
evaluator speed optimization that already cut the naive version from ~104
seconds). Instead, each hand's EV adjustment is computed once, at import
time, and cached in the hand record (`src/handStore.js`) — visiting Stats
just sums the cached numbers, same pattern already used for every other
stats field. This does mean import itself takes longer when a batch has
all-in hands in it; still one-time and spinner-covered, not something that
grows with how often you check your stats.

**Scope, stated plainly:** only genuine 2-player all-ins are adjusted — a
hand needs exactly two players reaching a real showdown with both hands
shown. 3+-way all-ins keep their actual result for now; extending to
multi-way needs separate per-opponent side-pot equity math (each player's
equity depends on exactly who they're contesting which pot with), which is
a reasonable next step but a distinct piece of work, not a small addition.

## Hand Database

Click **Import to Hand Database** (alongside Convert, under the **Import
Hands** tab) to add the currently loaded files into a persistent hand
database — a real hand manager, like PokerTracker/Hold'em Manager/Hand2Note,
not just a one-off conversion or a session summary. The **Hands** tab loads
it automatically — it's the default tab the app opens on.

### Exporting

The **Import Hands** tab also has an **Export from Database** section,
below the import workflow — the reverse direction: pull hands *out* of the
database as a plain text file, for sharing with someone else (say,
building up a shared pool knowledge base from hands teammates send each
other) rather than converting freshly-loaded files.

**Exports whatever the shared filter bar currently matches** — the same
player, dates, stakes, hand category, and every other filter already
narrowing Player Overview and Advanced Stats, not the files currently loaded
in the Import tab above it, which is a separate, unrelated set. The count
shown next to "Export from Database" is exactly `tableState.total`, the
same number already being tracked for the Hands table's own pagination —
not a second query, just the same live value displayed a second place.

**Two output formats** — a dropdown, not a fixed choice: **Weplay
original** (the exact text as stored — this app never actually stores
hands in CoinPoker format internally, only the original Weplay text; worth
clearing up since it's a reasonable but incorrect assumption to make) or
**CoinPoker format** (converted on the way out, the same converter this
app already uses for "Convert & Save" and the formatted hand viewer). One
combined `.txt` file either way, hands separated by a blank line — the
same shape a multi-hand Weplay export already has, and the same shape this
app's own importer already knows how to read.

**Verified as a genuine round-trip, not just "produces text that looks
right"**: exported a real filtered subset of this project's own data,
wrote it to a file, then re-imported that exact file into a fresh
database and confirmed it produced the identical hand count with zero
skipped — the actual scenario a colleague receiving an exported file would
hit, not just a shape check on the output.

### Backup &amp; Restore

Also on the **Import Hands** tab, below Export. A different thing from
Export from Database, worth being clear about: Export is a *filtered*
subset in plain text, for sharing specific hands with someone. Backup is
the *entire* database — every hand, every player, regardless of any
filter — as one real `.db` file, for disaster recovery: a corrupted drive,
a wiped laptop, or just keeping the pool's collected history somewhere
safe as it grows. Built after flagging, unprompted, that this was a real
pre-release gap — a database that's becoming a genuinely valuable shared
asset (hands from teammates that might not be re-obtainable) with no way
to protect it.

**Backup** checkpoints the database first, then copies the resulting file.
This app runs SQLite in WAL mode (readers don't block on an in-progress
import), which means recent writes can sit in a separate `-wal` sidecar
file rather than the main `.db` file itself — a plain file copy without
checkpointing first could miss them. Verified directly, not assumed: a
database with several megabytes of pending WAL data drops to a zero-byte
WAL file after the checkpoint, and the backed-up file was confirmed
independently openable afterward with the exact right hand count.

**Restore is deliberately cautious, not a plain overwrite.** Three real
safeguards, not just a file copy:
- The chosen file is validated first — checked for the actual tables this
  app depends on — and rejected before anything is touched if it doesn't
  look like a real hand-tracker database (tested against a garbage text
  file, an unrelated SQLite database with the wrong schema, a nonexistent
  path, and a real valid database — all four behaved correctly).
- **The current database is always preserved first**, to a fixed sidecar
  file, regardless of whether the restore choice was correct — a mistaken
  restore should never be a one-way door. Verified with the actual
  scenario this protects against: backed up a smaller, older database
  state, then grew the live database further, then restored the old
  backup — confirmed the newer, larger state was safely preserved in the
  sidecar file rather than silently lost.
- Restoring reopens through the exact same startup path as launching the
  app fresh, including the schema migration and deep-stats backfill — so
  a backup taken with an older version of this app catches up
  automatically, not something that needs a manual fix-up step.

### Tabs always reflect the current database — a real bug fixed

Reported after importing more hands onto an already-populated database: the
Import Hands page correctly showed the new count, but the Player Overview
and Advanced Stats tabs kept showing the count from before that import. The
backend itself was verified correct first (a real incremental-import test,
adding a second batch onto an already-populated database, confirms every
downstream query reflects the new total exactly), so the fix is entirely on
the renderer side, and covers more than the single reported case:

- **Any tab switch to Player Overview or Advanced Stats now re-fetches
  fresh data, every time, not just on first load.** Previously, only the
  very first visit to the Player Overview tab triggered a data fetch;
  everything after that relied entirely on specific actions (a filter change, an import)
  correctly triggering a refresh. If any of those ever failed silently,
  the tab would stay stale indefinitely with nothing forcing a reload
  short of restarting the app. Now, simply clicking into either tab is
  itself a guarantee of current data — it can't get permanently stuck
  showing the past.
- **The refresh sequence itself no longer fails silently.** It had no
  error handling at all — if any step threw, everything downstream
  silently never happened, with no visible sign to the user that anything
  was wrong (this is the most likely explanation for the reported
  symptom, though it couldn't be reproduced directly). Now wrapped in a
  try/catch that surfaces a clear toast on failure instead.
- **The post-import toast shows the unfiltered database grand total**,
  not just "added/updated/skipped" (which only ever describe that one
  import batch, never the database as a whole, and can't answer "did
  this actually land" on their own). This gives a direct, unambiguous
  number to compare against whatever a filtered tab shows afterward — if
  a "different hero" perspective filter is why a tab's count doesn't
  match what was just imported, that's now visible as a real difference
  between two shown numbers, not an unexplained discrepancy.
- Fixing the redundant-refresh side effect this created was its own
  small piece of care: the import handler already runs its own more
  thorough refresh sequence (including refreshing the player and filter
  dropdowns, which a plain tab switch doesn't cover), so it uses a
  separate `setActiveTab()` (pure UI toggle, no refresh) rather than the
  auto-refreshing `switchTab()` — otherwise two unawaited refreshes would
  race each other on every import.

### Storage: SQLite via Node's built-in `node:sqlite`

The database is a real SQLite file (`hands.db`, in Electron's per-OS user
data directory), not JSON anymore — a deliberate refactor once the hand
count reached real scale (tens of thousands of hands, with a stated target
of several hundred thousand). JSON meant loading the *entire* database into
memory and rewriting the *entire* file on every import; SQLite means
indexed queries that only ever touch the page of hands actually being
displayed, confirmed on the real 22,889-hand batch: a filtered, paginated
query consistently runs in well under 100ms regardless of how much data is
in the database, versus scaling with total hand count before.

This uses Node's **built-in** `node:sqlite` module (stable since Node 22.5)
rather than a third-party package like `better-sqlite3` — zero new
dependencies, no native compilation, no per-platform binary complexity for
electron-builder to handle. The trade-off: it requires bumping this
project's Electron dependency to a current major version (Electron 31, what
this app previously pinned, bundles Node 20.14, which predates
`node:sqlite` entirely — Electron's whole ecosystem moved to Node 22 as a
minimum in early 2025, so any current Electron version has it). Node itself
still flags the module "experimental" — worth knowing, though the risk is
API surface changes in a future Node version, not the underlying SQLite
engine's reliability (it's the same mature C library everything else built
on SQLite uses).

**Schema — two tables, not one, and why that split matters:**

```sql
hands           -- one row per hand: date, stakes, table, board, pot, rake, raw text
hand_players    -- one row per (hand, player) pair: seat, position, stack,
                --   hole cards (when known), and — only for whichever
                --   player is "hero" in that specific hand — net, VPIP,
                --   PFR, hand category, EV adjustment
```

Splitting hand-level facts from per-player facts is what makes two things
possible that a single hero-centric table couldn't do:

- **A hand doesn't need you in it to be stored.** "Hero" isn't a fixed
  identity — it's whichever player's hole cards happen to be revealed in a
  given file (via Weplay's own `Dealt to X [cards]` line, the same
  auto-detection used everywhere else in this app). Import a friend's
  export and *their* cards make *them* hero for *their* hands — full
  position/stack/results tracking works the same way it does for your own.
- **Querying by any player, not just yourself.** `queryHands` accepts a
  `perspectivePlayer` filter — omit it and you get your own hands (default:
  whoever is hero), or name a specific player and you get every hand *they*
  played in, whether or not you were even at the table. This is real
  groundwork for treating the database as an actual shared knowledge base
  (joins across players, "hands where both of us played," and so on), not
  just a personal log.

**What's populated for every player, not just hero.** Net result, VPIP, PFR,
hand category, and Saw Flop are computed for *every* seated player at
import time now, not just whoever happened to be hero in that specific
file — see "Viewing any player" below for the full story of that change.
EV adjustment is the one deliberately deferred exception, still hero-only —
a separate, more involved generalization (`src/evAnalysis.js`), not
bundled into this change. Seat, position, starting stack, hole cards
(yours always; anyone else's only if they showed at a real showdown), and
whether they won / reached showdown were already correct for any player
before this — cheap to compute, read directly off the hand's own showdown
and winner data.

### Viewing any player

The player dropdown lists every name this app has ever seen sit at a
table, not just the ones you've specifically imported your own hand
history for. Select any of them and the whole app — stat cards, the
Advanced Stats HUD table, the hands table, and clicking into an individual hand — all
switch to *their* perspective: their net result, their VPIP/PFR, their
position in each hand, their cards when known.

This is a real architectural change, not just a bigger dropdown, worth
being clear about why it took real work rather than being a one-line
addition. The underlying analysis function, `analyzeHand` in
`src/stats.js`, was never actually hardcoded to "hero" — it always took a
player name as a parameter. What was missing: `buildHandRecords` (the
import pipeline, `src/handStore.js`) only ever *called* it once per hand,
for whoever was hero in that file, and stored deep stats for that one
player's row only. Every other seated player's row had `net` (and
VPIP/PFR/hand category/saw flop) sitting `NULL` in the database — not
because the numbers couldn't be computed, but because nothing had ever
asked for them. Confirmed this concretely before assuming it, not just
reasoning about it: querying this project's own real data for its most
frequent non-hero opponent (`Javolimpero`, 1,024 hands in one test batch)
showed `net IS NULL` for all 1,024 rows.

The fix: `buildHandRecords` now calls `analyzeHand` once per seated player,
reusing the already-computed result for hero and computing fresh for
everyone else — verified this doesn't meaningfully slow down import first,
not after: ~0.66ms per hand even analyzing all 8 seated players on a real
table, extrapolating to about 15 extra seconds across this project's
entire 22,888-hand batch. The perspective filter itself (`hp.player_name =
?` in `buildWhereClause`) dropped its old `AND hp.is_hero = 1` requirement,
since that was only ever needed because non-hero rows had nothing
computed to show — once they do, requiring `is_hero = 1` just means
selecting an opponent by name silently misses their own hands.

**A follow-on gap found and fixed while wiring this up, not before
shipping it**: the hand-detail window (`getHandById`) always fetched
whichever player was `is_hero = 1` for a hand, regardless of which player
the person was actually browsing as — so clicking into a hand from an
opponent's filtered table would still show the *file's own* hero's cards
and position, not the opponent's. Fixed by threading a `perspectivePlayer`
argument all the way through: `getHandById`, the `get-hand-detail` IPC
handler, the `open-hand-window` handler and its window-tracking key (now
`handId + perspectivePlayer` together, since the same hand viewed as two
different players is genuinely different content, not a duplicate to
collapse into one window), and the hand-detail window's own URL query
params. The formatted hand view itself also now highlights whichever
player is being viewed as "hero" (bold action lines, cards when known),
not always the file's original hero.

**Existing databases needed a backfill, not just new code going forward** —
`backfillDeepStats` (replacing the earlier, narrower `backfillSawFlop`)
covers both gaps in one pass: hands imported before deep stats were
generalized to every player (net itself was never computed for
non-hero rows), and hero rows imported between when the `saw_flop` column
was added and now (net/VPIP/PFR already there, saw_flop specifically
still missing). Wired into `getDb()` in `main.js` to run automatically,
once, on startup — idempotent, so it's a fast no-op on every subsequent
launch. Verified against this project's real 22,888-hand batch in the
worst case (every row forced back to `NULL` first): 140,253 total
player-rows backfilled correctly in under 10 seconds, and a second run
confirmed to find nothing left to do.

**What's still hero-only, on purpose**: EV Winrate. For any other
player's perspective, it falls back to matching their regular Winrate (the
adjustment defaults to zero for hands where it was never computed) rather
than breaking or showing a wrong number — a real, documented limitation,
not a silent gap. Generalizing it means the same kind of work Saw Flop and
the rest just went through, applied to `src/evAnalysis.js`'s equity math
instead of `stats.js` — a reasonable next step if it's wanted, not
something this round took on.

**Migration:** a pre-existing JSON-format store from an older version of
this app is detected and migrated in automatically the first time the
database opens (`src/migrateJsonStore.js`) — every stored hand is re-run
through the exact same import path a fresh file would take (not a
field-by-field remap of the old shape), so a migrated hand ends up
byte-for-byte identical to importing that same raw text fresh, multi-player
rows included. The old JSON file is renamed to `hands.json.migrated-backup`
afterward rather than deleted, in case anything about the migration ever
needs double-checking.

**A real bug found and fixed while building this:** writing a synthetic
heads-up (2-player) test for the new multi-player storage surfaced that
heads-up positions had been backwards since this project's position-labeling
logic was first written — the button/small-blind poster was labeled "BB"
and the actual big-blind poster was labeled "BTN". Confirmed against real
data too (26 genuine heads-up hands in the same 22,889-hand batch used
throughout this project) after the fix. It went uncaught through every
prior round of real-data testing because heads-up play is rare in the
batches actually tested — mostly 6-max/8-max tables with several real
players seated — so this is apparently the first time that exact code path
ever ran against a true 2-player hand. Fixed at the source
(`positionLabelsFor(2)` in `src/stats.js`, shared by the stats engine and
the hand replay engine — one fix corrects both), with regression tests
added in both `test/stats.test.js` and `test/handReplay.test.js`.

### Layout

The **filters bar sits above the tab navigation itself**, not inside any
one tab — it's shared page chrome, not scoped to whichever tab happens to
be active. This matters concretely: switch to **Advanced Stats** and the
same filters still apply there too, exactly as they do on the **Player
Overview** tab, since both read from the same filter state and the same
underlying query. (**Import Hands** shows the filters bar too, even though
it isn't functionally relevant there — kept simple rather than
conditionally hiding it per tab.)

**The filters bar and tab navigation align with the content box below
them**, which took a real fix, not just a glance: `main` (holding the
actual content) is centered with a `max-width: 1500px` cap, but the
filters bar and tab nav had no width constraint of their own — on a
narrow window this happens to look aligned by coincidence, but on a
maximized wide display (the normal case) they'd stretch to the full
window width while the content below stayed centered and narrower,
visibly misaligned. Fixed differently for each, since they're not the
same kind of element: `.filters-bar` is a bordered card like the panels
below it, so it gets the same *content* width as `main` (`main`'s
max-width minus `main`'s own side padding, via `calc()`, not just
`main`'s outer box, which would leave it wider than the panel underneath
it). `.tab-nav` has a full-bleed dark background meant to span the whole
window regardless of content width, so it needed an inner wrapper instead
— the background stays full-width, the buttons inside it align with the
content.

Three tabs: **Player Overview** (the default — 9 headline stat cards on the
left, a compact cumulative-results chart on the right, and the hands table
below both, all in one panel), **Advanced Stats** (a grouped HUD table of
every stat `stats.js` computes, plus the fuller hand-by-hand results graph
underneath it — see below), and **Import Hands** (the drag/drop area,
Convert & Save, Import to Hand Database).

The first stat card on Player Overview is **Hands** — how many hands match
the current filters, always. This exists specifically so the rest of the
numbers next to it (Winnings, VPIP, and so on) always have their sample
size sitting right there, rather than requiring a glance elsewhere to know
how much data a given percentage is actually based on.

**The By Position / By Stake breakdown *tables* have been removed
entirely**, not just fixed. They started as a native `<details>`/`<summary>`
accordion, then got rebuilt as a plain button + `classList.toggle('hidden')`
after real bugs were reported (one accordion sometimes opening both, height
becoming unstable after repeated toggling, content occasionally failing to
render — most likely from how Chromium animates native `<details>`
transitions interacting with this app's CSS, though that specific
diagnosis was never fully confirmed). Rather than keep chasing it, the full
breakdown tables themselves were dropped: they only made sense as a picture
of the *whole* database, and this page is now built entirely around
showing whatever the current filters narrow things down to — a
by-position or by-stake split of an already-filtered set doesn't carry the
same meaning. `stats.byPosition` is still computed but not rendered
anywhere. `stats.byStake` is now used for exactly one derived value —
Player Overview's "Home" card (whichever stake bucket has the most hands) —
not as a full breakdown table, so the "not a full picture of an
already-filtered set" reasoning above still holds for it.

The hands table shows roughly 10 rows at a time (still fetches and holds
25 by default — this only limits the visible viewport, with the rest
reachable via the scrollbar inside the table). A **jump-to-page** input
sits next to Prev/Next now — with a real database this can mean hundreds
of pages (this project's own real batch is ~916 pages at the default page
size), where Prev/Next alone doesn't scale.

A **Bomb** column sits next to Table — a 💣 icon when a hand's table
category includes a bomb pot, empty otherwise. Purely a display
convenience derived from the same `tableCategory` field the Table column
already shows (no new query or database field needed) — for filtering to
bomb pots specifically, that's still the existing Table filter dropdown.

**Hole cards render as colored card badges, not plain text — in both the
table and the hand-detail window.** Getting this actually right took
several rounds, worth being honest about since it was asked about
directly: every earlier round scaled the box *and* the font up together,
proportionally — which keeps the exact same amount of empty space around
the letter, just bigger overall. That's not what "make the symbol fill
more of the box" means. The actual fix needed the box *smaller* and the
padding *tighter*, with the font large relative to that smaller box (plus
`line-height: 1`, to stop the font's own default line spacing from adding
back vertical padding the box's own CSS had just removed) — a different
axis of change than "bigger," which is why repeating the same wrong
adjustment several times never converged on it.

### Hand Detail Window

Simplified down to just the street-by-street formatted view — the field
grid at the top (Hand ID, Date, Stakes, Position, Pot, Net) and the toggle
for "Weplay original" / "CoinPoker format" raw-text views are both gone.
That metadata and those two alternate views aren't shown anywhere else in
the window now; this was a deliberate simplification, not an oversight —
ask if any of it should come back.

**Download as image**, saved via Electron's own `capturePage()` rather
than a third-party screenshot/canvas library — consistent with how this
app has handled every other "would need an external library" moment: a
library is something this sandbox has no way to install and verify
actually works, while `capturePage()` is a documented, built-in Electron
API. It only captures the current viewport, though, not the full
scrollable page, so a long hand (many streets, run-it-twice, a multi-way
showdown) could easily be taller than the window and get cropped. Worked
around by resizing the window to the content's actual measured height
right before capturing, then restoring the original size afterward. This
piece is genuinely less verified than most of this app: there's no real
Electron runtime available in the sandbox this was built in, so beyond a
syntax check, the capture-and-resize sequence itself hasn't been run.

### Advanced Stats

The tab's actual content is the grouped HUD table described above (see
"Player Overview & Advanced Stats"); the rest of this section covers the
results graph underneath it — a larger, more detailed version of the same
cumulative-results chart shown on Player Overview, same filters applying to
it, just given more of the tab's space than the small chart gets (though
now sharing that space with the HUD table above it, not the whole tab to
itself).

**The x-axis is hand number, not calendar date.** A separate series
(`stats.handTimeline` in `src/stats.js`) drives this chart specifically —
one point per hand, sorted chronologically (date, then time — which meant
adding a `time` field to `analyzeHand`'s output, since it didn't exist
before), not aggregated by date the way the small chart's `timeline` still
is (unchanged, on purpose — the small chart keeps its own date-based
series). A date-based x-axis understates how much actually happened on a
busy day versus a quiet one; a date with 5 hands and a date with 2,000
hands would otherwise take up the same horizontal space. Verified against
this project's real 22,888-hand batch: chronological order confirmed with
zero out-of-order entries, and the final cumulative value matches the
established $4,804.25 ground truth exactly.

**Three lines, not one** — green (total, matching the small chart), blue
(the same total but only from hands where hero's cards were literally
shown), and red (the same, but from hands where they weren't). Showdown +
non-showdown always sums to exactly the total, for every hand — an
explicit, tested invariant (`test/stats.test.js`), verified to
floating-point precision against the real batch (max drift: ~1.5e-11, i.e.
zero).

**A real distinction was found and fixed here, not just a display tweak.**
The first version split red/blue using `reachedShowdown` — the same
structural definition this app already uses for WTSD% elsewhere: did the
hand reach a genuine 2+-way contest, regardless of whether hero's own
cards ended up revealed. That's the standard poker-tracking definition,
and it's correct for WTSD% (left unchanged there) — but it's a genuinely
different question from "did hero's result come from hands where their
cards were shown," which is what this chart is actually trying to show.
Checked directly against the real batch: 1,512 hands reach a genuine
showdown, but hero's cards are only literally shown (a real `shows` line
for hero specifically, `heroCardsShown` — new, separate from
`reachedShowdown`) in 1,232 of them — 312 real cases, essentially all
losses where hero mucked without revealing (normal poker behavior, not a
bug in itself, but the wrong bucket for this specific chart). Switching to
`heroCardsShown` for this split changed the real numbers substantially:
blue moved from $4,765.82 to $7,331.26, red from $38.43 (suspiciously flat
— the tell that something was being conflated) to a real -$2,527.01.

**The axis needs to cover more than just the total line can imply.** The
red and blue lines can each individually swing further from zero than the
green line does — confirmed with a specific test built around exactly the
scenario worth checking: a case where the showdown line is solidly
profitable while the non-showdown line is solidly negative, even though
the total on any given hand tells a different story than either component
alone (`test/stats.test.js`). This is real, not just theoretical — with
the corrected `heroCardsShown` split, this project's own batch has a
non-showdown line that dips to about -$2,527 even though the total stays
positive throughout. The chart's Y-axis range is computed across all three
lines together, not just the green one, so the red/blue lines are never
clipped.

Other differences from the small chart:
- **No area fill under the line** — just the lines themselves.
- **Real vertical and horizontal axis lines, with axis titles** ("Money
  Won ($)" and "Hand Number"), not just floating tick numbers with nothing
  marking what they belong to — the previous version had tick values but
  no line marking the axis itself, which was very likely why the money
  axis read as "not visible."
- **At least 5 Y-axis ticks, guaranteed** — the "nice numbers for graph
  labels" algorithm (`src/chartMath.js`) can sometimes land on fewer ticks
  than requested depending on rounding; `computeNiceTicks` now takes a
  minimum-count parameter and retries with a smaller step until the
  guarantee holds, rather than leaving that possibility for someone to
  notice only by looking at a sparse axis. This is pure math with no
  rendering dependency, so — unlike almost everything else about how this
  app's UI actually looks — it's fully unit tested
  (`test/chartMath.test.js`) rather than something that can only be
  checked by eye.
- **Axis label color switched from the deliberately-muted `text-faint` to
  the more legible `text-dim`** — gridlines stay faint (they're supposed to
  be de-emphasized), but the actual numbers on the axis are reference
  information that needs to be readable, not decoration.
- **A legend with real, descriptive labels** ("Total Profit" / "Went to
  Showdown" / "No Showdown," not "Total" / "Blue line" / "Red line" —
  fixed after being flagged as signifying nothing on their own, which was
  fair; a color name only means something next to the color itself, and
  standing alone in a legend it doesn't) above the chart, since three
  differently-colored lines need one — and it updates with the filter
  below, not static.

**The chart responds to the "Went to Showdown" filter, not just the data
underneath it.** Filtering to Yes or No doesn't just narrow which hands
feed the chart (every hand fed in already belongs to that one bucket once
filtered) — it also recolors the single remaining line to match and hides
the other two, rather than showing three lines where two are flat at zero
or redundant with the third. Verified this is mathematically sound before
wiring it up, not just visually plausible: filtered to "Yes," the total and
the showdown series are exactly equal (confirmed against real data —
`total === cumulativeShowdown` to floating point, `cumulativeNonShowdown
=== 0`), so recoloring the total line blue is drawing the correct data,
not a shortcut. The legend hides the swatches for whichever lines aren't
currently drawn.

The general stats-caveat text (what VPIP/PFR/WTSD/etc. do and don't
include) has moved out of the stats panel into a small docked footer at
the very bottom of the window — background info that's useful to have
around but shouldn't compete for space with the actual numbers.

The window itself opens maximized by default (not OS-level fullscreen —
normal title bar and window controls, just sized to fill the screen) so
this whole layout has room to breathe rather than being squeezed into a
default-sized window.

### Using the Hands page

**Re-importing the same or an overlapping file is always safe.** Every hand
is keyed by its Weplay hand ID, so importing a file you've already imported
(or one that overlaps with a previous export) updates those hands in place
rather than duplicating them — confirmed by importing the same 22,889-hand
batch twice and checking the database size didn't change.

**Filters, in order:**
- **Player** — whose hands/stats you're looking at, and now genuinely
  anyone this app has ever seen at a table, not just people whose own file
  you've imported — see "Viewing any player" above for the full story.
  Defaults to whichever player has the most hands in the database (in
  practice, almost always "you" — the main user of this specific install,
  since your own imports vastly outnumber any single opponent's). This is
  never left blank once a second player exists — leaving it unset would
  silently blend every player's results together, which is never what you
  want. Clicking **Reset filters** deliberately does *not* reset this one,
  for the same reason. Worth noting since it's a real reversal, not just
  an addition: selecting a player used to deliberately *exclude* hands
  where they were merely an opponent at someone else's table (back when
  "select player" meant "view a specific person's own separate export,"
  and opponent rows had no computed stats to show anyway). Now that every
  seated player gets their stats computed regardless of whose file the
  hand came from, that exclusion stopped making sense — selecting
  `Javolimpero` now correctly means "everywhere `Javolimpero` has been
  seen playing," including hands from someone else's export, not just
  hands from a file specifically imported as his.
- **Date range**
- **Table** — a combined "6max (Ante)" / "8max (Ante)" / "8max (Bomb Pot)"
  value, generated from what's actually in your data rather than a
  hardcoded list, so a table type that doesn't exist yet (like a 6-max bomb
  pot) would show up automatically if it ever does.
- **Stakes** — also generated from your data, sorted by actual big-blind
  size rather than alphabetically (a naive text sort would put "$10/$20"
  before "$2/$4", which matters now that stakes aren't assumed to stay
  within a fixed NL20–NL100 range).
- **Position**, **Hand category** (see below), **Went to Showdown**, **Saw
  Flop**, **Pot (BB) min/max**, and free-text **Search** (hand ID, source
  file, or hole cards).

**Saw Flop is a three-way dropdown (Both / Yes / No)** — distinguishes
hands where the selected player saw a flop (called or raised preflop and
stayed in) from folding out before one ever came. Backed by a new
`saw_flop` column on `hand_players`, populated the same way `vpip`/`pfr`
are — for every seated player, not just hero (see "Viewing any player"
above). Adding this column to an *existing* database needed real care:
`CREATE TABLE IF NOT EXISTS` only helps a brand-new database file — one
that already exists on disk keeps whatever columns it had when first
created, so this app now runs a small, idempotent migration
(`ensureColumn` in `src/db.js`, checking `PRAGMA table_info` before an
`ALTER TABLE ADD COLUMN`) every time it opens a database, tested directly
against a simulated pre-existing database (old schema, real data) to
confirm the column gets added and nothing already there is lost.

**A real bug shipped in that first version, reported and fixed.** Adding
the *column* isn't the same as adding the *data* — `ALTER TABLE ADD
COLUMN` sets every existing row's new column to `NULL`, not a recomputed
value, and nothing backfilled it for hands imported before this feature
existed. A `NULL` there doesn't mean "no" — it means "never computed" —
but the filter's SQL (`saw_flop = 1` / `saw_flop = 0`) correctly matches
neither for a `NULL` row, so a database with only pre-existing hands (the
exact real situation for anyone updating from an earlier version) returned
*zero* results for both "Yes" and "No", which is exactly what got
reported. Reproduced first with a simulated pre-existing database before
touching anything, then fixed with a proper backfill
(`backfillSawFlop` in `src/handStore.js`): recomputed straight from each
hand's own stored `raw_text` — already in the database, no re-import
needed — and wired into `getDb()` (`main.js`) to run automatically, once,
on startup. Verified against this project's real 22,888-hand batch with
the column artificially nulled out first to reproduce the exact
before-state: correctly restores the 5,631 saw-flop / 17,257 didn't split,
in about 1.3 seconds — a one-time, barely noticeable cost on first launch
after updating, confirmed idempotent (a second run finds nothing left to
backfill and does nothing) so it's safe to run on every subsequent launch
too.

**Went to Showdown is a three-way dropdown (Both / Yes / No), not the
checkbox it used to be.** The old checkbox is gone — replaced because it
only supported "showdown hands only", with no way to isolate the *other*
side (hands where cards weren't shown), and because its underlying
definition needed reconciling with a real discrepancy found while
building the Advanced Stats graph (see that section above): this dropdown now
uses the exact same `heroCardsShown` signal as the graph's blue/red lines,
kept deliberately in sync (down to the same redacted-cards guard,
`hasValidCards`, ported into `src/stats.js` to match `src/handReplay.js`'s
existing check) — so filtering to "Yes" here shows exactly the hands
contributing to the "Went to Showdown" line on that chart, not a
differently-defined subset that happens to share a name. (The dropdown's
own option text used to say "Blue line" / "Red line" too, matching the
graph's old, since-renamed legend — changed to plain "Yes"/"No" for the
same reason the legend changed, and to match the identically-shaped Saw
Flop filter right next to it rather than inventing new wording.)

**Pot (BB) min/max filters by pot size in big blinds**, not dollars — "10
to 25" means 10–25bb at *every* stake at once, converted against each
hand's own `bb_stake` at query time (`h.pot_size >= h.bb_stake * ?`), so it
means the same thing whether a hand's at NL20 or NL500 rather than
requiring a different dollar range per stake.

**Hand category** classifies each hand by its preflop aggression pattern,
from the selected player's perspective: `SRP (as raiser)`, `SRP (as
caller)`, `3-Bet Pot (as raiser)`, `3-Bet Pot (as caller)`, `4-Bet Pot (as
raiser)`, `4-Bet Pot (as caller)`. "SRP" means Single Raised Pot — exactly
one preflop raise occurred, by anyone. Whether you were the one who made
that raise (or the 3-bet, or the 4-bet) determines "raiser"; whether you
called it determines "caller". A hand deliberately falls into **none** of
these six categories (not forced into the nearest one) when it doesn't
actually fit — folding to a 3-bet you didn't call, a fully limped pot with
no raise at all, or a 5-bet-or-higher pot, none of which any of the six
buckets actually describes. This combines with **Went to Showdown** and
**Pot (BB)** as a genuine composite filter (all apply together), and is
meant to grow — more hand-category distinctions (limped pots, squeeze
pots, cold-4-bets, isolation raises, and so on) are a natural next step
once there's a reason to add them, not a closed set.

**Filters now genuinely drive both Stats and the hands table together** —
selecting, say, "3-Bet Pot (as raiser)" narrows the stats overview down to
just those hands at the same time it narrows the table, from one shared
filter state. This was flagged as a deliberate next step in an earlier
version; it's done now.

**The hands table is a plain HTML table, not a third-party grid library.**
The history here is worth being honest about: this app tried Tabulator
across several rounds, and every single round surfaced a new problem that
could only be found by a real person actually running the app — the table
showing nothing at all, wrong colors, broken row-clicks, wrong width. The
common thread is this project's one hard constraint: the sandbox it's built
in has no network access, so no third-party library's actual behavior could
ever be verified before shipping it — only guessed at from documentation.
That risk doesn't go away by picking a *different* grid library; it's
inherent to depending on one at all under this constraint. So the table was
rewritten from scratch in plain HTML/CSS/JS instead — the same way every
other part of this app's UI is built, and the same way it's been possible
to verify everything else in this project end-to-end before calling it done.

What it actually needed didn't turn out to require a grid engine:
- **Sortable** — Date, Stakes, Table, Position, Pot, Net, WTSD. Click a
  header, or use the "Sort by" dropdown + direction button above the table
  (both do the same thing; the dropdown exists as a guaranteed-to-work path
  using only standard `change`/`click` events, independent of whatever the
  header click handler does).
- **Resizable columns** — a drag handle at the trailing edge of each header
  cell adjusts that column's `<col>` width directly via plain
  `mousedown`/`mousemove`/`mouseup`, the same standard, stable browser APIs
  used everywhere, not a library-specific interaction system.
- **Full width** — a plain `<table style="width:100%">` inside its
  container. No column-fitting algorithm to second-guess.
- **Adjustable page size, pagination, click-to-open** — all already
  working before this rewrite, since none of those were ever actually
  Tabulator's job in this app (the query — filtering, sorting, pagination —
  has been server-side SQL the whole time, in `src/handStore.js`); this
  rewrite only changed how the *result* gets drawn on screen.
- **Hole cards as colored badges** — same 4-color-deck convention as the
  hand-detail window's cards, reused directly (`.mini-card-badge`,
  `.suit-s/-h/-d/-c` — the same class-naming pattern, just sized for a
  table row instead of the larger formatted hand view).

Tabulator has been fully removed — the npm dependency, the CSS/script tags,
the electron-builder packaging entry all deleted, not just unused.

**Click any hand** to open it in its own window — matching how PokerTracker
and Hold'em Manager actually show a hand history (a separate, independently
resizable window per hand, not a modal that blocks the main one), with three
views to toggle between: **Formatted** (the default — a readable,
PokerTracker-style layout: players with position and starting stack in BB,
antes/blinds, hole cards, street-by-street action with the pot size and
player count at each street, showdown, and the winner), **Weplay original**
(the raw source text), and **CoinPoker format** (the converted output).
Clicking a hand that's already open focuses that window instead of opening
a duplicate.

The Formatted view is built on a dedicated hand-replay engine
(`src/handReplay.js`) that fully simulates the hand — tracking the pot size
and which players are still active through every single action, not just
the final result — verified against the real 22,889-hand batch with zero
exceptions and zero unparseable hands (besides the one genuinely corrupted
hand the rest of the app already knows about). This is deliberately built as
reusable simulation data, not just display formatting, since a future visual
replayer needs exactly this same street-by-street state.

A few notes on how the Formatted view is built, matching this project's
usual practice of flagging every simplification rather than hiding it:
- **Equity percentages are not shown** in the Formatted hand viewer itself
  (though the Stats tab's EV Winrate, below, is built on exactly this kind
  of calculation now) — some reference hand-history tools show something
  like `(Pre 68%, Flop 54%, Turn 75%)` next to a shown hand, which this view
  doesn't reproduce.
- **Fold actions render as a bare `fold`** in the formatted view, matching
  the reference format exactly — the underlying data still records who
  folded (needed for a future replayer), the display just doesn't attribute
  every fold individually, the same way the reference tool doesn't.
- **Player coloring is simplified.** Some reference tools color player names
  based on something in their own external database (possibly a
  known-player/notes indicator) that varies in ways unrelated to what
  actually happens in the hand itself — not something this app has an
  equivalent for. Hero is bold and highlighted; everyone else uses a single
  neutral color.

**What's next for this:** a visual hand replayer (animated table, seats,
cards, and chips stepping through the hand street-by-street, the way
Hold'em Manager 3's replayer works) is planned but not yet built. The data
model already captures everything it needs (this is exactly what
`src/handReplay.js` produces); the replayer itself is a separate,
substantial UI project on top of it, not a data-layer change.

**A performance note:** importing a hand into the database runs the
converter, the full stats analysis, and (for the small fraction of hands
that qualify — genuine 2-player all-ins) EV equity sampling, all once, at
import time. A full 22,889-hand import (including 130 EV-qualifying hands
in that real batch) takes on the order of 40 seconds — covered by the
loading spinner, and importantly a **one-time** cost per import, not
something that scales with how often you check your stats or browse hands
afterward — that's the entire point of computing and caching this at import
time rather than on every view.

## Scope
Built and verified against two real hand history samples (a CoinPoker export
and a Weplay export), not guessed from documentation. What that means
concretely:

**Confirmed against real CoinPoker output**, so trustworthy:
- Header, seat listing, antes, blinds, hole cards
- All streets, folds/checks/calls/bets/raises
- All-in handling (`ALLIN ₮X`)
- Uncalled bet returns (`X: RETURN ₮Y`)
- Showdown (`shows`, `mucks`, hand-description translation)
- Summary line rules (position tags stripped, `folded before Flop (didn't
  bet)`, `collected` → `won`)
- The "no flop reached" edge case (`Board [  ]`)
- A "dead button" on a seat vacated mid-session (player left) is detected
  and reassigned to the nearest occupied seat before the small blind,
  matching standard poker rules, instead of producing a button that points
  at an empty seat
- A folded player whose cards get revealed anyway (a real Weplay quirk —
  happens when someone folds to an all-in but the site shows their cards for
  transparency) is handled correctly: dropped from the showdown section
  entirely and the summary line truncated to a plain fold, matching how
  CoinPoker only ever lists genuine showdown participants. This also covers
  the rarer case where the reveal comes back partially redacted (`[## 5c]`)
  rather than fully empty (`[]`).
- Run-it-twice hands: fully converted, not skipped. Structure confirmed
  against two independent real CoinPoker run-it-twice hands — every street
  is prefixed `FIRST`/`SECOND` (even ones that never diverge), streets are
  emitted in CoinPoker's own sequential order (all of FIRST, then all of
  SECOND, not interleaved the way Weplay writes them), and there are two
  separate `*** FIRST SHOWDOWN ***` / `*** SECOND SHOWDOWN ***` blocks. Two
  specific pieces are inferred rather than confirmed, and flagged per-hand:
  - Weplay only reports **one** hand-type description per player (not one
    per board), so the same label is reused for both showdown blocks — the
    true hand type against the second board isn't independently verified.
  - When the same player wins both boards, Weplay shows one combined payout
    line instead of two; it's split into two near-equal halves (matching the
    pattern in the confirmed CoinPoker samples), but the exact split isn't
    independently verified. When two *different* players win one board
    each, Weplay's two payout lines are assumed to be board1-then-board2 in
    that order — confirmed against one real example, not more broadly.
  - A run-it-twice hand can also have a side pot (a short-stacked all-in
    covered by a bigger stack). The side pot isn't re-run — only the
    contested main pot splits across the two boards — so its payout is
    attached once to the FIRST showdown section. Verified against one real
    combined example (all three payout lines correctly preserved; this used
    to silently drop the side-pot line entirely — a real bug caught by
    testing against a 191-file, ~19,800-hand real batch).
- Multi-tier side pots (`Side pot-1`, `Side pot-2`, ... for 3+-way all-ins at
  different stack depths), not just the single-tier case.
- Ante-only bomb-pot hands with no blinds and no preflop betting round
  (action goes straight from hole cards to the flop).
- Multi-word usernames (`MAMBA 444`, `ema dayı`) — a real batch test found
  these were corrupting summary-line parsing (the name/description split
  assumed no spaces in a username); fixed by splitting on known description
  keywords instead of the first whitespace.
- Weplay doesn't zero-pad the hour in a hand's timestamp when it's a single
  digit (`0:40:13` instead of `00:40:13`) — this alone caused ~300 hands in
  a real batch to fail to parse at all before being fixed.
- Ante or blind posts that are also the poster's whole remaining stack
  (`posts the ante $2.69 and is all-in`).
- `X: activates time bank` and a Weplay logging quirk where a duplicate
  `*** HOLE CARDS ***` block appears mid-hand (same player, same cards, no
  new information) are both treated as noise and dropped.

**Rake and side pots — the model actually used:**
Rake is deducted from the winner's collected amount, never from the stated
`Total pot` (which always stays exactly as Weplay wrote it). For a hand with
a side pot, rake is distributed **proportionally across every pot tier**
(main pot and each side pot), not taken from the main pot alone — an earlier
"main pot only" assumption was proven mathematically impossible by a real
sample (`Main pot ₮0.28` with `Rake ₮0.66` — rake alone exceeds the entire
main pot, so it can't have come from there exclusively). Proportional
distribution is the best-evidenced model available and can't produce a
negative or impossible result, but it still isn't confirmed against a real
CoinPoker side-pot sample, so every side-pot hand gets a warning flagging it
for a manual check.

**Best-effort, flagged when it occurs, not confirmed against a real sample:**
- Side pots — the rake-distribution model above is evidence-based but not
  independently confirmed. Any hand with a side pot gets an explicit warning
  in the results panel.
- `Four Of A Kind`, `Straight Flush`, `Royal Flush` hand-type labels — the
  Weplay-side phrasing for all three has now been seen and matches the
  expected pattern, but no real CoinPoker sample has confirmed the exact
  output label for any of them yet, so they're still flagged as inferred.
- `Game ended:` timestamp — Weplay doesn't record a hand-end time, so this is
  approximated as start time + 1 minute.
- `Splash Fee` — CoinPoker has this concept, Weplay doesn't expose an
  equivalent figure, so it's always written as `₮0.00`.

**Not supported — skipped with a clear reason, not silently mangled:**
- Hands with no resolution anywhere in the source. Every legitimate hand has
  at least one "X collected $Y from pot" line (confirmed across thousands of
  real hands — walks, splits, side pots, run-it-twice all have this); a
  hand with zero is a genuine gap in Weplay's own data, not something this
  converter can parse around. Seen for real: a player disconnecting right at
  showdown, where Weplay's log ends there and never records a winner or
  payout at all. There's no data to reconstruct a result from, so the hand
  is skipped rather than emitted with a missing/wrong winner.

**Not a limitation — works automatically:**
- 3BB bomb-pot ante tables: the converter reads each player's actual posted
  ante amount from the file rather than computing it from a formula, so
  unusual ante sizes carry through correctly without special-casing bomb
  pots at all.
- 6-max and 8-max tables: nothing in the converter is seat-count-specific.
- Two "big blind" posts in the same hand (happens when a player catches up
  after joining mid-orbit) — passes through correctly since each blind line
  is handled independently.

**Real-world scale test:** verified against a 191-file, ~19,800-hand batch
spanning 6-max ante, 8-max ante, and 8-max bomb-pot tables at multiple
stakes — 0 hands skipped, 0 pot-math mismatches. Several real bugs above
were only found this way; three sample files alone wouldn't have surfaced
them.



## How "Hero" detection works

Your Weplay export only reveals one player's hole cards per hand — yours.
The converter finds that player automatically (whoever's cards appear) and,
if the checkbox is on, renames them to `Hero` everywhere in the output. This
matches CoinPoker's own convention for personal hand history exports, which
is likely what Hand2Note/PokerTracker's CoinPoker parser expects in order to
identify you as the tracked player.

## Project layout

```
main.js                     Electron main process (file dialogs, save-as, IPC, hand database, hand windows)
preload.js                   Safe IPC bridge to the main window's renderer
handDetailPreload.js          Safe IPC bridge to each hand-detail sub-window
src/db.js                     SQLite schema + connection (node:sqlite)
src/converter.js              Core Weplay → CoinPoker line-by-line converter
src/stats.js                  PokerTracker-style stats engine
src/handStore.js              Hand database: build/query/filter records (SQLite-backed)
src/migrateJsonStore.js        One-time migration from the old JSON-format store
src/handReplay.js              Hand replay simulation engine (powers the Formatted hand view)
src/handEvaluator.js            Poker hand evaluator (ranks 5-7 card hands)
src/equity.js                   Equity engine (exact enumeration + Monte Carlo)
src/evAnalysis.js               All-in detection + EV adjustment, on top of the two above
src/chartMath.js                 Chart axis tick math (nice-number ticks) — UMD, used by both the browser and npm test
src/handDescriptions.js      Hand-strength label translator
src/zipWriter.js             Dependency-free .zip writer (used for "Save as .zip")
src/zipReader.js              Dependency-free .zip reader (used for zip import — drag/drop or Browse)
test/converter.test.js        Regression tests — run with `npm test`
test/stats.test.js             Stats engine tests — run with `npm test`
test/zipReader.test.js          Zip import tests — run with `npm test`
test/handStore.test.js          Hand database tests — run with `npm test`
test/handReplay.test.js          Hand replay engine tests — run with `npm test`
test/handEvaluator.test.js        Hand evaluator tests — run with `npm test`
test/equity.test.js               Equity engine tests — run with `npm test`
test/evAnalysis.test.js           EV adjustment tests — run with `npm test`
test/chartMath.test.js            Chart axis math tests — run with `npm test`
renderer/index.html, renderer.js, style.css   Main window (Player Overview, Advanced Stats, Import Hands tabs)
renderer/hand-detail.html, hand-detail.js, hand-detail.css   Per-hand detail sub-window (Formatted / raw / CoinPoker views)
build/icon.ico, icon.png       App icon (installer + window/taskbar)
.github/workflows/            GitHub Actions workflow to build the Windows installer
```

`src/converter.js`, `src/stats.js`, `src/zipWriter.js`, `src/zipReader.js`,
`src/handStore.js`, `src/handReplay.js`, `src/handEvaluator.js`,
`src/equity.js`, `src/evAnalysis.js`, and `src/chartMath.js` have no Electron
dependency and can be unit-tested directly with plain Node if you want to
verify behavior
against more sample hands later.
