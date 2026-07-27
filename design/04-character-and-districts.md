# Design Exploration 05 — Character and Districts (Game B)

Supersedes §2 of `03-buildings-networks-and-eras.md`.

The correction: **character is not a quality axis.** There is no good vibe and bad
vibe, no desirability score with parks at one end and tanneries at the other.
Character is **plural and qualitative** — a district isn't better or worse, it's
*something*.

This turns out to fix several problems at once and makes the game considerably
better.

---

## 1. Why good-vs-bad was wrong

A single pleasant/grim axis has three failure modes, and they're all fatal to the
kind of town we want:

1. **It homogenises.** If pleasant is better, the optimal town is parks everywhere.
   Every player's city converges on the same answer.
2. **It makes most of your buildings a penalty.** Foundries, docks, tanneries,
   barracks — the entire productive half of the game becomes damage to be
   mitigated and hidden. That's a miserable relationship to have with your own
   economy.
3. **It's boring to look at.** A gradient from nice to nasty is one dimension. A
   town of distinct quarters is a place.

Replace the axis with a palette and all three invert: variety becomes the goal,
every building type becomes something you *want* somewhere, and the town becomes
composed rather than optimised.

> **The design goal is no longer "make a nice town." It's "make places that are
> strongly themselves."**

---

## 2. The mechanic: coherence, not quality

Every location carries a **blend** of characters at various strengths, emitted by
nearby buildings and flowing with terrain and wind.

Two things are read off that blend:

**Dominant character** — the strongest thread. This determines *what buildings
there become* as they evolve (`00`, Pillar B). A house doesn't get better or worse;
it becomes the house that belongs there.

**Coherence** — how dominant the dominant one is.

- **High coherence** → the district develops strongly **in its own idiom**. A
  thoroughly industrious quarter becomes a *great* industrious quarter: dense,
  proud, with its own terraces, its own pubs, its own soot-blackened dignity.
- **Low coherence** → nothing knows what to become. The district **stagnates**,
  and prolonged incoherence is what produces squalor.

**Squalor is not a character you place.** It's what happens when a place has no
character to develop into. That's a much more interesting model of urban decay than
a low score, and it means slums are something you *caused* structurally rather than
something you failed to fund.

### Harmony and discord

Some pairs reinforce each other; some cancel.

- **Harmonious:** mercantile + maritime, devout + learned, genteel + verdant,
  martial + industrious, rustic + devout.
- **Discordant:** genteel + industrious, devout + raucous, learned + maritime.

Discord isn't forbidden — it's a decision with consequences. Putting a music hall
in the cathedral close is a *choice*, and the resulting mess is legible and
sometimes worth it.

---

## 3. The palette

Target **10–14** characters. Six to eight for a first prototype, the rest as the
art and evolution content allows. Each needs emitting buildings, a visual identity,
and its own housing evolution outcomes — so each one is real content, and that's
the constraint on "as many as feasible."

| Character | Emitted by | Housing becomes | Strategic role |
|---|---|---|---|
| **Industrious** | Foundries, mills, workshops, yards | Workers' terraces, back-to-backs | Production output |
| **Mercantile** | Markets, warehouses, banks, exchanges | Merchants' houses over shops | Trade and wealth |
| **Maritime** | Docks, chandlers, fish market, sail lofts | Sailors' lodgings, harbour cottages | Trade reach, naval supply |
| **Genteel** | Crescents, private squares, tea rooms, assembly rooms | Villas, terraced townhouses | Strong cultural pressure |
| **Devout** | Churches, abbeys, shrines, almshouses | Cottages around a close | Stability; **resists foreign culture** |
| **Learned** | Schools, libraries, colleges, printers | Scholars' lodgings, dons' houses | Era advancement |
| **Raucous** | Taverns, theatres, music halls, fairgrounds | Lodgings over pubs, cheap rooms | Attracts migration |
| **Martial** | Barracks, walls, arsenals, drill grounds | Garrison housing, officers' quarters | Boosts military pressure |
| **Rustic** | Farms, commons, orchards, watermills | Farmhouses, labourers' cottages | Food; slow, stable |
| **Verdant** | Parks, lakes, woods, gardens | Garden cottages, lodge houses | Health; **harmonises neighbours** |
| **Grand** | Cathedrals, palaces, monuments, town halls | Mansions, ceremonial frontages | Prestige; wide-reaching culture |
| **Curative** | Baths, spa, pump room, hospital | Boarding houses, convalescent villas | Health; draws visitors |
| **Antique** | *Age itself* — surviving old buildings | Preserved, patched, characterful | **Very strong culture; highly resistant to conversion** |

### Antique deserves a note

It's the only character emitted by **time rather than by buildings**. A quarter that
survives from one era into the next starts radiating it. Your medieval streets
still standing in 1900 *become* the old town, and that's mechanically valuable —
strong cultural pressure, hard for a rival to convert.

It makes preservation a strategy. It's Pillar E (`00`) turned into a mechanic, and
it rewards exactly the thing that makes medieval-to-modern progression emotionally
satisfying: **not knocking your history down.**

---

## 4. What this does to the chain

The chain from `03` survives, but the middle link changes and improves:

> **Placement → Character → Coherence → Evolution → Culture → Territory**

The critical revision:

> **Cultural pressure comes from strength of character, not from niceness.**

A fiercely industrious dockside radiates as much culture as a genteel crescent. It
is simply a *different* culture. This fixes the homogenising problem in `01` — you
no longer win territory by making everything pretty, you win it by making places
that are unmistakably themselves.

And it makes the border story far richer. A rival's culture pushing into your land
is no longer "they're nicer than you." It's **"their character is stronger here
than yours."** You might even choose *not* to convert an inherited district — a
quarter with strong foreign character is interesting, productive, and it still
radiates. Conquest becomes something you can absorb rather than something you must
erase.

### Different characters do different strategic jobs

This is what stops any single character dominating. A town of nothing but parks is
weak. **You need quarters**, and which quarters you build is your strategy:

- Border districts want **Devout** or **Antique** — they resist conversion.
- Interior wants **Genteel** and **Grand** — they project the furthest.
- **Martial** amplifies military pressure, so frontier fortress towns are a real
  archetype.
- **Learned** drives era advancement, so it's the tempo choice.

That's a genuine strategic layer built entirely out of flavour.

---

## 5. Making it visible (Pillar A)

Many characters is a large art investment, so it has to carry the no-numbers UI, and
it does — better than a scalar ever could. Each character gets:

- **A palette.** Soot and brick. Stone and slate. Stucco and railings. Salt-bleached
  timber.
- **An architectural idiom.** Roof pitch, window rhythm, materials, density.
- **Street furniture.** Bollards, railings, drying lines, mooring rings, lamp
  standards, gravestones, market awnings.
- **Ambient sound.** Hammering. Bells. Gulls. A piano through a wall. Birdsong.
- **Crowd behaviour.** Who's out, when, how fast they move, whether they linger.

**The test: you should know what quarter you're standing in from any corner of it,
with the labels off.** If that works, coherence and discord are legible without a
single number, and the whole vibe system reads at a glance.

---

## 6. Open questions

1. **How many before it stops reading?** Twelve characters may exceed what a player
   can distinguish at a glance. The visual identities have to do the work — if two
   characters look similar, one of them shouldn't exist.
2. **Is coherence too punishing early?** A young town is inevitably a muddle of a
   few buildings. Small settlements probably need a grace period, or coherence
   should scale with district size.
3. **Squalor from incoherence — is it legible?** The player must be able to see
   *why* a district went bad. "Nothing here agrees with anything else" needs a clear
   visual signature, or it reads as arbitrary.
4. **Discord pairs: authored or emergent?** A hand-authored table is controllable
   and explicable. Deriving discord from underlying properties (noise, dirt, pace,
   wealth) is more elegant and might produce surprises. Probably start authored.
5. **Does Antique unbalance the late game?** If old quarters radiate strongly and
   resist conversion, a long-established player may be untouchable. May need a decay
   term, or a cap on how much of your territory can be carried by Antique.
