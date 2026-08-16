# belief-graph — the narrative

The problem, the turn, and the demo. Written to be read aloud.
Companion to [design.md](./design.md). Hack Hydra, Track 01.

---

## 1. The cold open

Three versions. Twenty seconds each. Pick one, shoot it, don't hedge.

### A. 2:14 a.m.

**Visual.** Black. A phone face-up on a nightstand lights the ceiling. Cut to a laptop
opening in the dark, a wiki page, a runbook, a cursor on step four. Then a Slack search
result stamped five months earlier.

**Narration.**

> Two fourteen a.m. Payments is down. You find the runbook. Step four says fail over to
> the Aurora replica. You run it. Nothing happens. Payments moved off Aurora in March.
> Someone announced it, in a channel you were never in. The runbook is still the top
> result, and it has been wrong for five months.

### B. Six weeks

**Visual.** A Jira board dense with done tickets, scrolling. Then a meeting transcript,
one line highlighted. Then back to the board, still scrolling, now uncomfortable.

**Narration.**

> Six weeks ago your team picked Kafka. Four weeks ago, in a meeting you weren't in, that
> got reversed. Nobody updated the design doc. Nobody was hiding anything. The decision
> just never reached the document. So you've been building against something that stopped
> being true a month ago, and the search bar agreed with you every time you checked.

### C. The auditor

**Visual.** A conference room. A laptop turned toward someone in a suit. A search box, a
cursor blinking in it. Then four people at a table with Slack open, scrolling backward.

**Narration.**

> The auditor asks one question. Who owned key rotation in Q2, and when did that change?
> Your wiki knows who owns it today. That is the only thing it knows. It has never been
> able to answer a question with a date in it. So four people spend two days reading Slack
> to reconstruct something the company already wrote down once, and then wrote over.

**Which one.** Shoot **A**. The outage is the only one a stranger feels in their body, and
it sets up the exact demo question later in the video. Keep **C** in your pocket for the
judge who asks what this is worth commercially. Audit and point-in-time recall is where
someone actually pays for it.

---

## 2. The problem, escalating

It starts as an annoyance. You search, you find the doc, the doc is wrong. Everyone who
has worked anywhere has this story. The phenomenon has a name, documentation rot, and the
people with the most engineers have written it down plainly. *Software Engineering at
Google* puts it in one sentence: "Over time, documents become stale, obsolete, or (often)
abandoned." Their own internal wiki died of it: "Because there were no true owners for
documents, many became obsolete." (Tom Manshreck, ch. 10, *Documentation*.)

Then it gets expensive, and the cost is never the time spent searching. The cost is the
confident action taken afterward. A failover against a database nobody has used since
March. Six weeks of engineering against a reversed decision. None of that gets filed as a
knowledge-management failure. It gets filed as an outage and a bad sprint.

Then you notice the shape of it, and the shape is the real problem. Walk the chain looking
for the villain. The person who wrote the doc was right when they wrote it. The engineer
who changed the datastore announced it, in public, in the right channel. The retrieval
system returned a real document, correctly ranked, correctly cited. Every actor behaved
correctly and the system still produced a wrong answer. That is what makes this structural
rather than cultural. You cannot fix it by asking people to be more diligent, because
nobody was undiligent.

Retrieval getting good made it worse rather than better. A retriever ranks by similarity
to the question. Nothing in the index knows that one statement retired another, so the
retired claim and the live one are both excellent matches. They are about the same thing,
in the same words, which is exactly why they conflict. The research literature has a name
for what comes out the other side: *inter-context conflict*, two retrieved passages
disagreeing inside the same prompt (Xu et al., "Knowledge Conflicts for LLMs: A Survey",
2024). Staleness was never solved by retrieval either. FreshLLMs found that "all models
(regardless of model size) struggle on questions that involve fast-changing knowledge and
false premises" (Vu et al., 2023). RAG was supposed to be the fix for stale weights. What
it actually did was move the stale knowledge out of the weights and into the index.

The usual answer to all of this is a single source of truth. It fails for a precise
reason. You can declare a document authoritative, but you cannot declare it current.
Authority gets assigned once. Currency decays every day. What really holds the system
together is tribal knowledge: somebody in the building knows the runbook is wrong. That
knowledge lives in a person, not in the corpus. When they leave, all you have is a corpus
that cannot tell you which of its own sentences it stopped believing.

---

## 3. Why every obvious fix fails

**"Just search better."** Better retrieval finds the passage most similar to your question.
The stale claim and the current claim are near-identical text about the same entity, so
both land near the top, and a stronger embedding model pulls them closer together rather
than further apart. Similarity has no opinion about time. *Failure mode: the better your
search gets, the more reliably it hands you both answers and no way to choose.*

**"Just add timestamps and sort by newest."** This conflates two different clocks: when a
document was written, and when the fact became true. A postmortem written today describes
last year. A doc touched for a typo jumps to the top of the sort. Most documents mostly
restate facts established somewhere else, earlier, so document-level recency ranks
restatements above originals and originals above corrections, more or less at random.
*Failure mode: you sort by the wrong clock and get a confidently ordered list that isn't
in the order you needed.*

**"Just delete the old doc."** Deletion requires somebody to notice, and the noticing is
the entire hard part. If you already knew the doc was stale, you already had your answer.
Deletion also destroys the two things you need most later: what you used to believe, and
why it changed. And it doesn't work anyway, because the wrong version isn't only in the
doc. It's in a thread, a ticket comment, a forwarded email, a meeting transcript, and you
are not deleting those. *Failure mode: you can only delete what you have already detected,
and the copies you can't delete keep answering.*

**"Just ask the LLM to figure it out."** The model only sees what retrieval put in front of
it. It has no independent knowledge of which passage came first or which one is still
operative. Handed two contradictory passages, it does not abstain. It picks, usually by
fluency or position, and it writes the answer with the same confidence either way. It will
even cite correctly, because the retired document is a real document that really does say
that. *Failure mode: a confident wrong answer wearing a genuine citation, which is strictly
worse than no answer, because the citation is the thing that makes someone act on it.*

**"Just use a knowledge graph."** A knowledge graph stores the current state of the world
as edges. When the world changes you update the edge. `(billing, datastore, Aurora)`
becomes `(billing, datastore, Postgres)` and the first edge is gone, along with when it
was true, who said so, and what replaced it. The graph is now perfectly correct and
completely amnesiac. Bi-temporal graphs exist and are better, but the primitive is still
an edge asserting a fact about the world, and an edge has nowhere to record the sentence
that killed it. *Failure mode: right about today, silent about yesterday, unable to explain
the difference.*

---

## 4. The turn

**You already run this system. You ran it this morning.**

When you change a line of code, git does not overwrite the old line and forget it. It
writes a commit. The old line stays reachable forever. And when you hit a line you don't
understand, you don't search the repo for something that looks similar. You run
`git blame`, and it tells you who wrote it, when, and what it replaced.

That is a `supersedes` edge. You have one on every line of code you own. You have zero on
every fact your company knows.

So why doesn't the wiki have it? Because a wiki stores documents, and a document is the
wrong unit. A doc is never wholly wrong. Three paragraphs are fine and the fourth one is a
lie. You cannot supersede a document. Supersession needs a unit small enough to be wrong
on its own.

That unit is a **claim**. One entity, one property, one value, the time it was *stated*,
the source it came from, and the sentence that proves it. Small enough to be individually
wrong. And once a claim is a node instead of a sentence buried in prose, it becomes a
thing that can be acted upon: pointed at, dated, retired by another claim. A later claim
doesn't edit the earlier one. It writes an edge that says *I retired that, on this date,
and here is the message that did it.*

**Three fields already settled this argument, and all three chose append.**

*Accounting decided the principle.* Pat Helland titled a section of "Immutability Changes
Everything" (CIDR 2015) simply **"Accountants Don't Use Erasers."** The text under it:
"Accountants don't use erasers or they go to jail. All entries in a ledger remain in the
ledger. Corrections can be made but only by making new entries in the ledger." Same paper,
the line that describes this architecture exactly: "The truth is the log. The database is a
cache of a subset of the log." The claim graph is the ledger. *What holds now* is the
cache.

*Event sourcing made it a pattern.* Martin Fowler: "Capture all changes to an application
state as a sequence of events." And on being wrong: "If we find a past event was incorrect,
we can compute the consequences by reversing it and later events and then replaying the
new event and later events." You never edit the past. You append the correction.

*Data warehousing shipped it in the nineties.* Kimball's Slowly Changing Dimension Type 2:
"Slowly changing dimension type 2 changes add a new row in the dimension with the updated
attribute values," carrying a "row effective date," a "row expiration date," and a "current
row indicator." Your customer's old address is not deleted when they move. It gets closed
out, and a new row opens.

**The line to land it:** every system in your company that touches money already refuses to
overwrite. The knowledge base is the last one still using an eraser.

belief-graph is SCD Type 2 for the sentence in the Slack message, applied to the
unstructured half of the company, which is where all the actual decisions live.

---

## 5. The demo script — 3:00

Runs on HydraDB, Track 01. Corpus is a scoped subset of Salesforce HERB (Slack, meeting
transcripts, documents, PRs across fictional companies), attributed and not redistributed.
Narration paced at roughly 2.5 words per second.

---

### 0:00 – 0:18 — Cold open

**On screen.** Black. Phone lights the ceiling. Laptop opens in the dark. A wiki runbook,
cursor resting on step four. Cut to a Slack result stamped five months earlier.

**Narration.**
> Two fourteen a.m. Payments is down. You find the runbook. Step four says fail over to
> the Aurora replica. You run it. Nothing happens. Payments moved off Aurora in March.
> Someone announced it, in a channel you were never in.

---

### 0:18 – 0:30 — The thesis

**On screen.** Title card: **belief-graph**, and under it one line: *a corpus that
remembers what it stopped believing.*

**Narration.**
> Nothing in that search index knew one message had retired the other. It never does.
> Retrieval finds what's similar to your question. It has no idea what's still true.

---

### 0:30 – 0:52 — The mechanism

**On screen.** A document slides in. Three claim nodes lift out of it, each showing entity,
property, value, date, source. A second document arrives. One new claim appears and draws
a dated arrow back to an older one, labelled `supersedes`. The old node dims but stays on
screen. Nothing is removed. Keep this animation honest, because it is the whole product.

**Narration.**
> So we stopped storing documents that happen to contain facts. Every claim becomes a
> node: what it asserts, when it was said, who said it, and the exact sentence that proves
> it. When a later claim contradicts an earlier one about the same thing, it doesn't
> overwrite it. It writes a dated supersedes edge. The old belief stays, marked and
> queryable. Like a commit. Like a ledger entry.

---

### 0:52 – 1:15 — Question one: the one that works

**On screen.** Query box. Typed: *Who owns the billing pipeline?* The answer renders under
a heading that reads **HOLDS NOW**: one claim, the owner's name, a date, a source, and the
verbatim evidence sentence underneath it. The other two headings on the panel, **NO LONGER
HELD** and **UNSUPPORTED**, render empty and greyed out. Show them empty. It teaches the
layout before you need it.

**Narration.**
> Start with an easy one. Who owns the billing pipeline. One live claim, with the date it
> was stated, the source, and the sentence it came from. Watch the shape of this answer.
> Three sections. Right now two of them are empty.

---

### 1:15 – 2:00 — Question two: the answer that changed

**On screen.** Typed: *What datastore does the billing pipeline use?* The panel fills:

- **HOLDS NOW** — `billing_pipeline · datastore · Postgres`, stated 2026‑03‑11, source
  Slack `#eng-platform`. Evidence: *"cutover finished last night, billing is fully on
  Postgres, Aurora cluster is scheduled for deletion Friday."*
- **NO LONGER HELD** — `billing_pipeline · datastore · Aurora`, stated 2025‑09‑02, source
  `billing-architecture.md`. **Retired 2026‑03‑11 by the message above.**

Then the version chain draws itself between the two: old claim, arrow, new claim, date on
the arrow. Hold on it. This is the strongest shot in the video, so give it four full
seconds of silence before the next line.

**Narration.**
> Now the one from the cold open. This answer changed, so we get both. What holds now.
> Postgres, since March eleventh. And what we used to believe. Aurora, from the
> architecture doc, with the exact message that killed it and the day it died.
>
> *(beat)*
>
> Search would have handed you both documents and let you pick. This tells you which one
> the company stopped believing, and why.

---

### 2:00 – 2:40 — Question three: the one it can't answer

**On screen.** Split screen, same corpus, same question on both sides. Typed: *What is the
billing API's SLA in the EU region?*

- **Left, baseline RAG.** Answers immediately: *"The billing API maintains a 99.9% uptime
  SLA for EU customers."* With a citation. Click the citation. Open the cited document.
  Highlight it. It says nothing about an SLA. Let that sit for a second.
- **Right, belief-graph.** **UNSUPPORTED.** *No live claim covers this.* Below it: the
  entities searched, the number of claims held on `billing_api`, and the properties those
  claims actually cover (owner, datastore, error budget, on-call rotation). No SLA claim,
  and no claim scoped to a region.

**Narration.**
> Last one. Something the corpus does not contain. The baseline answers instantly, with a
> citation. Open the citation. The document says nothing about an SLA. It invented a
> number and attached a real source to it.
>
> Ours refuses, and it shows its work. Here's what we searched. Here's every claim we hold
> about this service, and not one of them is an SLA. "I don't know" is a real answer. It
> beats a confident wrong one.

---

### 2:40 – 3:00 — Close

**On screen.** Back to the three-part answer panel from question two, full frame. Then the
supersedes edge alone on black.

**Narration.**
> Claims that can retire each other. A dated reason attached to every change. And a system
> that's allowed to say it doesn't know.
>
> Every retrieval system can tell you what it found. This one can tell you what it stopped
> believing.

---

**Build notes for the demo UI.** Four things have to be true or the video doesn't work.

1. The three-section answer panel renders sections visibly empty when they're empty.
2. The version chain is an actual drawn edge with a date on it, not a bulleted list.
3. The baseline runs live and side by side, from the same corpus. If it's a screenshot, a
   judge will assume you tuned it.
4. Every number spoken in the narration is read off the running system. The claim count in
   question three is whatever the system actually holds. Don't script a number and hope it
   matches.

---

## 6. The pitch

**One sentence.**

> belief-graph turns a document corpus into claims that can retire each other, so every
> answer comes back in three parts: what holds now, what we used to believe and what
> killed it, and an explicit refusal when nothing in the corpus supports the question.

**Thirty seconds.**

> Enterprise knowledge contradicts itself. A doc says one thing, a Slack message from eight
> months later says another, and retrieval hands you both because both are similar to your
> question. Nothing in the index knows one retired the other. So we made claims
> first-class nodes. Each one carries what it asserts, when it was stated, its source, and
> the sentence that proves it. When a later claim contradicts an earlier one about the same
> entity and property, we write a dated `supersedes` edge instead of overwriting. It's the
> git commit model applied to facts instead of code. You get what's true now, the version
> history behind it, and a system that will tell you when it doesn't know. All on top of
> HydraDB, using the graph primitives it actually exposes.

**"Isn't this just a knowledge graph?"**

> A knowledge graph stores assertions about the world. We store *claims*, which are
> assertions about who said what, and when. That one shift changes three things a
> knowledge graph can't do structurally.
>
> First, in a knowledge graph, updating a fact is a write that destroys evidence. The old
> edge is gone. Here a change is a write that *adds* evidence. The old claim survives,
> marked and queryable.
>
> Second, a knowledge graph edge has nowhere to put the reason. Ours does, because the
> thing doing the retiring is itself a claim with a source and a sentence attached. You get
> `git blame` for a fact, not just its current value.
>
> Third, a knowledge graph will always return you the nearest edge. Because we track claim
> coverage rather than similarity scores, we can tell the difference between "the answer is
> X" and "nothing here asserts anything about that," and say the second one out loud.
>
> Bi-temporal graphs get partway to the first point. Neither of the other two falls out of
> a graph. They fall out of making the claim the node.

---

## 7. Objections, and honest answers

**1. "HydraDB already advertises temporal versioning and entity resolution. What did you
actually add?"**

The marketing says that. The v2 API doesn't expose it. There is no fact invalidation, no
`as_of` or point-in-time parameter, and no deduplication beyond overwrite-by-id. I checked
before building, and that gap is the build. Concretely: HydraDB stores the graph and the
evidence. We supply the claim vocabulary through `graph_payload`, run conflict detection
over stated time, write the `supersedes` edges, and materialise the graph locally through
`context.relations()` in order to walk it, because there is no traversal DSL and multi-hop
has to be ours. The platform gives us storage and retrieval. Supersession, cardinality
rules, and abstention are the layer that doesn't exist yet.

**2. "How do you know two claims actually conflict?"**

The rule is deliberately crude, and I'd rather defend crude than defend a judge model. Two
claims conflict only when they share an entity, share a property, assert different values,
and refer to the same event. "Ran five miles Tuesday" and "ran three miles Wednesday"
contradict nothing, and a naive value-difference check would call that a conflict.

Two rules stop the common bugs. Every property in the vocabulary declares its
**cardinality**. `owner` and `current_datastore` hold one value at a time; `depends_on` and
`mentions` hold many. Only single-valued properties can supersede, because applying it to a
many-valued one deletes real knowledge. And conflicts resolve on **stated time, never
arrival time**. A document ingested today can assert a fact from 2024, and keying off
ingestion order retires the wrong claim. That's the most common way an implementation like
this ends up quietly wrong, and it's completely silent when it happens.

Where it's weak: paraphrase and unit mismatch. Two claims saying the same thing in
different words read as a conflict. The demo includes a near-miss on purpose so you can see
exactly where the edge is.

**3. "What if the newer claim is wrong?"**

Then the answer on screen is wrong. This is the part of the design I'm most comfortable
with, because nothing got destroyed. The superseded claim is still a node, still queryable,
still carrying its source and its evidence. Flipping the edge is one write, not a
re-ingestion.

Compare that to the alternative. When a wiki page is edited with wrong information, the
right answer is gone. When a knowledge graph edge is updated with a wrong value, the old
edge is gone. Being wrong is recoverable here specifically because we never use the eraser.
Recency as a default is a heuristic and I'm not claiming it's true. I'm claiming it's the
right default *when the loser is preserved and the reason is visible.*

**4. "Doesn't this just move the hallucination into your extractor?"**

Partly yes, and that's the real trade. Three things bound it.

The target is smaller. The extractor emits one entity, one property, one value, and a
verbatim span from the source. That's a much narrower failure surface than free-form
generation, and it's checkable, because the evidence sentence is copied rather than
written. If the claim isn't in the sentence, you can see it immediately.

It's also inspectable instead of buried. A hallucination inside a paragraph of generated
prose is invisible. A wrong claim is a node with a source, a date and a quote sitting next
to it in the UI. The demo shows the evidence sentence under every claim for exactly this
reason. You're meant to be able to catch me.

And the mechanism doesn't depend on it. Supersession, cardinality and abstention are
deterministic. They are correct or incorrect independently of extraction quality. A better
extractor makes the same system more accurate. It doesn't change what the system is.

One caveat worth stating out loud: HydraDB links every supplied relation to its
best-matching chunk with no reject floor, so a weak match still links. I don't trust that
association for citation. The evidence sentence is carried on the claim itself.

**5. "'Later wins' is just recency. That's the heuristic you spent a slide dismissing."**

Fair, and the distinction is the whole design. What I dismissed was sorting *documents* by
*ingestion* date, which is global, untyped and lossy. This is local, typed and reversible.

Local, because it only ever compares two claims about the same entity and property, never
a ranked list. Typed, because it only fires on properties declared single-valued. Correctly
clocked, because it orders by when the claim was *stated in the world*, not when we learned
it, and those are two separate fields that never get collapsed. "Unknown stated time" is
representable rather than silently defaulting to ingest time. And reversible, because
document sorting throws the loser away and we keep it and show it. Recency deciding which
of two answers to *display*, with the other one still on screen, is a different thing from
recency deciding which one to *keep*.

**6. "Scale. The graph caps at 5,000 entities and 10,000 relations, and HERB is much
larger. You demoed a subset."**

Yes, and it's stated in the README rather than implied away. The corpus is a scoped subset
chosen to exercise contradiction and abstention. It isn't a full ingest, and the free tier
wouldn't hold the full set regardless.

What the caps do and don't constrain: they're per-source `graph_payload` limits rather than
a global ceiling on claims, and claims are sparse relative to documents, because most
sentences assert nothing. The part that genuinely doesn't scale as written is materialising
the whole graph in memory to walk it, and that's a consequence of there being no traversal
DSL, not of the design. Cursor pagination on `context.relations()` means it can be walked
incrementally instead. I didn't build that, because it isn't the thing being demonstrated,
and I'd rather tell you it's missing than pretend the subset was a choice about elegance.

---

### Also likely, briefly

- **"Zep/Graphiti already does bi-temporal invalidation."** True, on their own stack, and
  they publish a HydraDB comparison. I read it. Two differences: invalidating an edge marks
  it dead but doesn't hand you the sentence that killed it, and it has no abstention story.
  This is built where the capability doesn't exist yet.
- **"Isn't abstention just a confidence threshold?"** No. It's a coverage test, not a score
  cutoff. HydraDB always returns ranked chunks, and its own agent guide notes that a
  low-relevance result is still a result. We refuse when no live claim covers the property
  being asked about, which is a structural fact about the graph rather than a number I
  picked.

---

## Sources

- Pat Helland, "Immutability Changes Everything," CIDR 2015 (7th Biennial Conference on
  Innovative Data Systems Research, Asilomar, January 4–7 2015). §2 "Accountants Don't Use
  Erasers"; §2.2 "Accounting: Observed & Derived Facts".
- Martin Fowler, "Event Sourcing," martinfowler.com/eaaDev/EventSourcing.html.
- Kimball Group, "Type 2 Slowly Changing Dimension," Dimensional Modeling Techniques.
- Tom Manshreck, *Software Engineering at Google*, ch. 10 "Documentation" (free online
  edition, abseil.io).
- Rongwu Xu, Zehan Qi, Zhijiang Guo, Cunxiang Wang, Hongru Wang, Yue Zhang, Wei Xu,
  "Knowledge Conflicts for LLMs: A Survey," arXiv:2403.08319, 2024.
- Tu Vu et al., "FreshLLMs: Refreshing Large Language Models with Search Engine
  Augmentation," arXiv:2310.03214, 2023.
- Salesforce HERB dataset, CC-BY-NC-4.0, research use only. Attributed, not redistributed.

Every quotation above was pulled from the source text, not from memory. The McKinsey-style
"knowledge workers spend N hours a day searching" statistic that usually appears in decks
like this is deliberately absent, because I couldn't retrieve the primary source.
