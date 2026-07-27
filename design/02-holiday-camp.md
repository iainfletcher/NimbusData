# Design Exploration 03 — The Holiday Camp Game

Working title options: **The Season** / **Sunny Days** / **Welcome to Sandy Bay**.
("The Season" is the favourite — it means the summer season *and* the theatrical
season, which is exactly the double meaning the game is about.)

A British holiday camp builder. Butlin's, 1936 to the 1970s. Chalets, Redcoats,
the Tannoy, knobbly knees contests, and an outdoor pool nobody can bear to get
into.

---

## 1. Is this the same game as `00`/`01`? No — and it should be built first.

**Different game.** Different scale, subject, and tone, and the dual-pressure
territory system doesn't transfer at all — a holiday camp has no borders.

**But it shares almost all the machinery**, which is the useful part:

- Visible agents with legible desires (the Theme Park channel)
- Place buildings, then watch them age and evolve
- The no-numbers, read-it-by-looking UI experiment
- Real-time with pause
- "Legible and alive, never opaque and demanding"
- Small, dense, toy scale

**Recommendation: build the camp game first**, for five reasons that are about
strategy rather than taste:

1. **Bounded scope.** A camp is small and finite. A country is not. Enormously
   less content, less simulation, less everything.
2. **It de-risks the other game cheaply.** Agent legibility, the no-numbers UI,
   building evolution and decay, real-time pacing — every shared uncertainty gets
   tested on a small target before you commit to the big one.
3. **The aesthetic is a moat.** Nobody has properly made "British holiday camp
   sim." Everybody has made a city builder. One of these two gets noticed on sight.
4. **It has a natural ending.** 1936 to the 70s is a real historical arc with a
   real conclusion, which solves the "when is this over" problem city builders
   never solve.
5. **No combat needed**, which defers the most novel and riskiest system in the
   other design rather than betting the first project on it.

The city game isn't cancelled. It's second, and it inherits a proven engine and a
proven UI philosophy.

---

## 2. The two-verb structure

The single best structural idea here, and it solves a problem `00` was struggling
with.

> **Winter: you build. Summer: you programme and watch.**

Camps ran Easter to September and shut for the winter. So:

- **Winter (empty camp).** Construction, renovation, demolition, hiring, planning.
  Nobody is on site. You have the place to yourself and all the time you want.
- **Summer (full camp).** You cannot build. You *programme* — what's on, when,
  where, and which Redcoat runs it — and then you watch it happen and react.

This gives two distinct verbs that never compete for attention, which is exactly
what the city game couldn't achieve in pure real-time. The building phase and the
watching phase are separated by the calendar, diegetically, with no turn gate
needed.

### The week is the heartbeat

Guests arrived Saturday and left the following Saturday. That gives a natural
cadence inside the summer:

**Saturday arrival** (see who you got) → **the week plays out** (watch, react,
salvage) → **Saturday departure** (the verdict, and word of mouth) → repeat.

This is a turn structure that isn't a turn structure. It's just how the business
worked. It supplies the punchy decision beats that real-time normally loses, for
free and without stopping the world.

---

## 3. Weather is the antagonist

This is the British part, and it's the game's central tension.

- **Rain drives everyone indoors.** Without indoor capacity, you get misery at
  scale — hundreds of people in a chalet listening to rain on a tin roof.
- **The core building trade-off:** outdoor attractions are cheap, lovely, and
  worthless in rain. Indoor attractions are expensive, less exciting, and always
  work. (This is *why* the real Butlin's built enormous indoor everything — the
  heated indoor pool at Skegness was a genuine landmark.)
- **The forecast is uncertain.** You programme the week against a forecast you
  can't fully trust. Real decision-making under risk, with zero fiddle and no
  arithmetic.
- **A washout week can be salvaged** by good indoor programming and a great
  Redcoat. That's the most satisfying thing in the game: rescuing a ruined week.

Weather is a better pressure source than anything in the city design — continuous,
thematic, entirely outside your control, and never a punishment for bad
bookkeeping. It's Axis 7 of `00` done properly.

---

## 4. Guests: the family is the unit, and the family argues

Theme Park's great trick was visible individual desire. The improvement here:

> **You don't get guests. You get families, and they want different things.**

The dad wants the bar. Nan wants bingo and a sit down. The kids want the pool. The
teenager is mortified to be there and wants to be anywhere else. A family arrives
as a group, **splits up**, does different things, and **reconvenes** — and you can
watch the whole negotiation happen on screen.

Why this is better than individual guests:
- "Did this holiday work?" becomes a genuinely richer question than a happiness bar.
- It's *funny*, and the comedy is observational rather than written.
- It creates real design problems: you need somewhere for the teenager to sulk,
  and it needs to be near enough that the family still functions.
- A family that never manages to do anything together had a bad holiday even if
  every individual was fine. That's a lovely, legible failure state.

Guest archetypes are where a huge amount of the Britishness lives, and they should
be observed with affection, never sneered at. (See §8.)

---

## 5. Redcoats are characters, not staff

The Theme Park mistake was staff salary negotiation — admin bolted onto a toy. The
fix is that Redcoats are the **named few** idea from the city design, and they fit
here better than they fit there, because a holiday camp genuinely does revolve
around its entertainment staff.

- Each Redcoat is a **named character** with a personality and a speciality —
  ballroom, kids, sport, compère, singer.
- You assign them to **activities, not shifts.** No rotas, no wages, no sliders.
- They **develop**. A nervous new Redcoat becomes the one who can hold a wet
  Wednesday together. Some leave. Some become legends people book to come back for.
- A great Redcoat can rescue a rained-off week single-handed — which makes
  assignment the most interesting decision in the summer phase.

Tonal reference: *Hi-de-Hi!* The Redcoats are the cast, and the camp is the set.

---

## 6. The Tannoy is the interface

**Diegetic UI.** The camp announcer tells you what's happening over the public
address system.

> *"Would the owner of a blue Ford Anglia, registration…"*
> *"Ladies and gentlemen, the Glamorous Grandmother final will now take place in
> the Gaiety Ballroom — moved indoors, on account of the weather."*

This is the notification system, and it's *funny* rather than intrusive. It also
neatly resolves the no-numbers problem for events: **you hear your game state.**
The game's UI is a voice, and the voice has a personality.

Bad news arrives the same way it really did — cheerfully, over a horn speaker,
slightly too loud.

---

## 7. Reputation, and where your guests come from

Guests go home and tell people. Bookings next season follow.

Different guests spread **different** reputations, so you gradually become the camp
for families, or for young people courting, or for the slightly posher end. That's
a real positioning choice with consequences for who turns up and what they want.

**Map layer worth exploring:** renown as a field over Britain. Watch your
reputation spread out from the towns your guests come from — the coach trade from
the Midlands, the works outings from the north. It recycles the pressure-field
thinking from `01` with no combat attached, and it would be a gorgeous second
screen. Probably not v1, but it's the natural place for the game to grow.

---

## 8. The arc, and the ending

The historical shape is a gift, and it should be the campaign:

- **1936 — the founding.** A field near the sea and an idea nobody's had yet.
- **1939 — the war.** The camps were requisitioned as naval training bases. This
  genuinely happened, and it's an extraordinary mid-game interruption: your camp is
  taken away and given back changed.
- **1946–1960 — the boom.** The golden age. Full weeks, waiting lists, the works
  outing, the Tannoy at seven in the morning.
- **1960s — the peak and the first cracks.** Bigger, brasher, rock 'n' roll on the
  bill. (Ringo Starr really did play the camps before the Beatles.)
- **1970s — Benidorm.** Cheap package holidays to Spain. Your guests start going
  abroad, and *you cannot beat this.*

The late game is an **unwinnable pressure you manage rather than defeat.** Do you
modernise? Chase a different market? Go upmarket? Or accept the decline with some
grace and run a good camp for the people who still come?

Games are famously bad at endings. This one has a real one, with real pathos, and
it's historically true. That's worth a great deal.

---

## 9. Aesthetic and sound

**Look:** isometric, chunky, warm pixel art — the Amiga/CD32 register, Bullfrog and
Sensible Software. The palette of a faded seaside postcard, sun-bleached and a bit
overexposed.

**Typography and signage carry an enormous share of the Britishness.** Hand-painted
boards, period lettering, the Tannoy horns on their posts, the notice board with
the week's programme pinned to it. Get the signs right and the game is instantly
placed.

**Sound may be half the identity.** The Tannoy. A distant ballroom organ. Seagulls.
Rain on a chalet roof. The shriek from the pool. A ukulele somewhere. Applause
through a wall. This is a game you could recognise with your eyes shut, and that's
worth designing for deliberately rather than treating as polish.

---

## 10. Risks

1. **Very British. Might not travel.** Counter-argument: specificity travels better
   than blandness — *Papers, Please* and *Disco Elysium* are not universal, and it
   didn't hurt them. Bland does worse than foreign.
2. **Could collapse into Theme Park reskinned.** The differentiators must be
   committed to, not sprinkled on: family-as-unit, weather-as-antagonist, the week
   rhythm, Redcoats-as-characters, and the decline arc. With all five it's a
   different game. With two of them it's a reskin.
3. **Tone is a knife edge.** This material can be affectionate or sneering, and
   sneering would be both unpleasant and commercially fatal. *Hi-de-Hi!* was
   affectionate about people and only ever mocked the institution. That's the line.
4. **The winter build phase could feel dead** with nobody on site. May need the
   empty off-season camp to have its own atmosphere — and it probably has a
   melancholy charm worth leaning into rather than fixing.

---

## 11. First thing to prototype

One camp, one week, rain on Wednesday.

Can you watch a single family arrive, split up, do things, argue, reconvene, and go
home either happy or not — and can you tell *which*, and *why*, without opening a
single panel? And when the rain comes on Wednesday, is moving the Glamorous
Grandmother final indoors and putting your best Redcoat on it a satisfying save?

If that week is fun, the game is real.
