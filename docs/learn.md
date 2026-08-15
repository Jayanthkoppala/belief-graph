# Understanding belief-graph

Read this before we build. It explains the problem, the concepts underneath it, and what
is actually hard. Curated videos and reading are in the second half.

---

## 1. The problem, in one scene

It's 2am. A service is down. You search the company wiki for the billing runbook and it
says *"failover to the Postgres replica."* You do it. Nothing happens — because billing
migrated to DynamoDB in June, and the person who knew that mentioned it once in a Slack
thread that nobody indexed into the runbook.

The information wasn't missing. It was **outranked**. Both statements exist in the
corpus. The wiki page is longer, better formatted, more "document-like," and it matches
your query better. The Slack message that invalidated it is one line in a channel.

Every retrieval system you've used has this property: it returns what is most **similar**
to your question, not what is most **currently true**. Nothing in the index knows that
one statement killed another.

---

## 2. Why this is hard (and not just "add a timestamp")

The obvious fix — "sort by date, take the newest" — fails immediately:

- **Newest isn't truest.** A stale doc edited last week for a typo is newer than the
  Slack message that actually changed the fact.
- **Most content isn't a claim.** "Anyone around?" has a timestamp too. You need to know
  which statements *assert* something.
- **Two statements about the same thing may not conflict.** "Billing uses DynamoDB" and
  "Billing uses Redis for sessions" are both true. Conflict requires the same subject
  *and* the same property, with different values.
- **Deleting is wrong.** If you overwrite the old fact, you lose the ability to answer
  *"when did this change, and why did half the team not get the memo?"* — which is the
  question people actually have during an incident.
- **Absence is invisible.** If the corpus never says what billing's recovery objective
  is, retrieval still returns the ten most similar chunks, and a language model will
  happily write a confident answer from them.

So the real problem decomposes into four sub-problems:

1. **Extraction** — turn prose into structured claims.
2. **Alignment** — know that two claims are about the same subject and property.
3. **Adjudication** — decide which claim wins, and record that the other one lost.
4. **Abstention** — recognise that no claim covers the question, and refuse.

---

## 3. The key idea: a claim is a thing

Most knowledge graphs model the world:

```
Billing ──uses──► DynamoDB
```

The problem: when the datastore changes, you either overwrite that edge (losing history)
or you have two contradictory edges with equal standing (losing truth).

We model **statements about the world** instead:

```
claim#217 ── asserts ──► (Billing, datastore, DynamoDB)
   ├─ stated: 2026-06-19
   ├─ source: slack://eng-billing/p1750...
   └─ evidence: "Billing migrated off Postgres to DynamoDB last sprint."
```

Now claims can act on other claims:

```
claim#217 ── supersedes ──► claim#84
```

This is the whole trick. Once a claim is a node, "this belief died on this date because
of this message" is just another edge — something a vector index structurally cannot
express, because in an index every chunk is an island.

If you've done event sourcing, you already have the intuition: **never mutate, append a
correction.** The current state is a fold over the history, and the history survives.

---

## 4. Concepts you'll hit (short glossary)

**Triple** — the atom of a graph: `subject → predicate → object`. "Billing uses
DynamoDB." Everything in a knowledge graph is triples.

**Predicate** — the relationship type in a triple (`uses`, `owns`, `supersedes`). In our
build we *author* our predicates so they're stable; HydraDB's automatic extractor invents
its own, which are LLM-normalised and non-deterministic — never hard-code against those.

**Ontology** — the agreed vocabulary: which entity types and predicates exist, and what
they mean. "Ontology alignment" is making two sources that use different words for the
same thing agree.

**Entity resolution** (a.k.a. record linkage) — deciding `Sam`, `@soham` and
`S. Ratnaparkhi` are one person. Classic, unsolved-in-general, and explicitly named in
the track brief.

**Multi-hop** — an answer requiring you to traverse more than one edge: "who owns the
service that depends on the compromised package." Vector search can't chain; graphs can.

**Bi-temporal** — tracking two clocks per fact: *valid time* (when it was true in the
world) and *transaction time* (when the system learned it). A fact can become false in
June but only be discovered in August.

**Abstention** — the system declining to answer. Rare in retrieval products, because the
default behaviour of every stack is to return the top-k and let the model improvise.

**Hybrid retrieval** — combining dense (embedding similarity) with sparse (BM25 keyword)
scoring. HydraDB's `alpha` controls the blend: 1.0 pure semantic, 0.0 pure keyword.

---

## 5. How HydraDB fits

HydraDB is a hybrid retrieval system with an entity/relation graph attached, in one API.
Two things it gives us matter enormously, and one thing it doesn't have is the reason
this project exists.

**What we use:**

- **Hybrid retrieval** finds the region of the corpus a question is about. This is the
  part we do *not* want to reinvent.
- **`graph_payload`** lets us inject a graph we computed ourselves, instead of relying on
  its LLM extractor. Verified in our spike: our own predicates (`supersedes`,
  `asserts_datastore`) came back byte-identical, with `canonicalPredicate` equal to
  `rawPredicate`, and our custom entity type `claim` survived.
- **Relations carry provenance** — every returned relation has `confidence`, `timestamp`,
  `temporalDetails` and `context` (the verbatim source passage). That's exactly the
  material a belief history needs.
- **`context.relations()` with the id omitted** returns database-wide triplets with
  cursor pagination, so we can materialise the graph locally and walk it to any depth —
  there is no traversal DSL, no hops parameter, so this is *how* multi-hop happens.

**What it doesn't have — and why we're here:**

Their marketing promises Git-style temporal versioning, recall of "what was true at any
point in time," and entity resolution that prevents duplicates. The v2 API documents
none of it: no fact invalidation, no `as_of` parameter, no dedup beyond overwrite-by-id.
Their own agent guide concedes retrieval always returns something and *"a low-relevance
result is still a result."*

That gap is the project.

---

## 6. What we already proved (the spike)

Run `npm run spike` to reproduce. It writes a tiny claim graph and reads it back. Results
from the live API:

- All five authored relations returned intact, including
  `claim:billing-uses-dynamodb --supersedes--> claim:billing-uses-postgres` with
  `temporalDetails: "superseded 2026-06-19"` and the evidence passage attached.
- Ingestion reached `completed` in under a minute — fast enough to iterate many times a
  day.
- At query time HydraDB returned a `combinedContext` that stamps the date onto the
  evidence: *"Billing migrated off Postgres to DynamoDB last sprint. (Date/Time: stated
  2026-06-19)"* — the temporal framing carries into retrieval for free.

Three undocumented things we discovered the hard way, now handled in code: the database
must be created first and provisions asynchronously; `document_metadata` must be a JSON
**array**, one entry per file; and only eight keys are accepted there — custom fields
must nest inside `additional_metadata`.

---

## 7. The four questions to have opinions on before we code

Come back with instincts on these. They're the actual design decisions.

1. **What counts as a claim?** Every assertion in the corpus, or only claims about a
   curated set of properties (service→datastore, service→owner, policy→value)? Narrow is
   faster and demos better; broad is more impressive if it works.
2. **What counts as a conflict?** Same entity + same predicate + different value is the
   simple rule. Does "Billing uses DynamoDB" conflict with "Billing uses Postgres for
   analytics"? How much nuance do we want on day two?
3. **Who wins?** Newest by default — but do we weight source type (a decision doc over a
   passing Slack remark)? Confidence? Do we ever show an *unresolved* conflict rather
   than picking?
4. **When do we refuse?** No claim covering the entity+property is the clean rule. But
   what about partial coverage — we know the datastore, not the recovery objective? Does
   the answer say "here's what I do know" alongside the refusal?

---

## 7b. Crash course: the five things you already know

You know all of these. What's worth ten minutes is the *boundaries between them* — that's
where the confusion lives, and three of these distinctions decide our design.

### Embedding vs. vector search vs. the index

Three different things that get called "embeddings":

- **The embedding** is a function: text in, a fixed-length list of numbers out. The model
  was trained so that texts meaning similar things land near each other.
- **The index** is the datastructure holding millions of those vectors — usually HNSW, a
  navigable graph — so you don't compare against every one.
- **The search** is approximate nearest neighbour: given a query vector, walk the index
  and return the closest k. *Approximate* is the load-bearing word — it trades a little
  recall for a lot of speed.

The practical consequence: your retrieval quality is capped by the embedding model long
before it's capped by the database.

### Dense vs. sparse (and why hybrid exists)

**Dense** = the embedding vectors above. Strong at paraphrase — "how do I reset my
password" finds "credential recovery steps." Weak at exact rare tokens: error codes,
version numbers, surnames, `ERR_CONN_4021`. Those get smeared into the semantic soup.

**Sparse** = BM25, essentially TF-IDF grown up. A vector as wide as your vocabulary,
almost all zeros. Strong at exact terms, useless at paraphrase.

They fail in opposite directions, so you run both and blend the scores. In HydraDB
that's the `alpha` knob: **1.0 is pure semantic, 0.0 is pure keyword**, default 0.8.
Anything with identifiers in it — service names, package names, ticket IDs — usually
wants more sparse than the default.

### Chunking: the two-sided trade you can't win

Chunks exist for two reasons: context windows are finite, and a whole document embeds to
a mush that's near nothing in particular.

- **Chunks too big** → the vector averages several topics, so it's mildly close to
  everything and strongly close to nothing.
- **Chunks too small** → you match the sentence but lose what it referred to. "It was
  migrated last sprint" is useless without knowing what *it* is.

Overlap patches the seams a little. The real fix is remembering that **the unit you
search over doesn't have to be the unit you return.** Match on a precise sentence, then
hand the model the whole section around it. That single trick is most of how Emergence
hit oracle-level accuracy on LongMemEval with otherwise plain RAG.

For us this matters because a claim usually lives in one sentence, but the *evidence* a
human needs to judge it lives in the paragraph.

### Retrieval vs. reranking

Two models, two jobs, wildly different costs:

- **Retrieval** uses a *bi-encoder*: query and document are embedded **separately**, so
  every document vector is precomputed once and search is a nearest-neighbour lookup.
  Fast, scales to millions, and slightly dumb — it never sees the query and the document
  together.
- **Reranking** uses a *cross-encoder*: query and document go through the model **jointly**
  and it outputs one relevance score. Far more accurate, and far too slow to run over a
  corpus — so you run it over the ~50 candidates retrieval returned.

The mental model: **retrieval buys recall, reranking buys precision.** If the right
document isn't in the first 50, no reranker can save you.

### The RAG loop, stated honestly

Retrieve a few chunks, paste them into the prompt, ask the model to answer from them.
That's it. The two properties that follow are the ones people forget:

1. **The model only knows what you handed it.** Answer quality is retrieval quality
   wearing a nice voice.
2. **It will answer anyway.** Hand it ten irrelevant chunks and you get a confident
   paragraph, because nothing in the pipeline is allowed to say "no."

### The three words people use interchangeably — and shouldn't

This is the whole reason our project exists:

| | means | decided by |
|---|---|---|
| **Similar** | close in embedding space | the embedding model |
| **Relevant** | actually about what you asked | the reranker, if you have one |
| **True** | still correct today | **nothing in the stack** |

Every component above optimises for the first two. Not one of them has an opinion about
the third. A March runbook and the June Slack message that invalidated it are equally
similar, equally relevant, and only one is true — and the pipeline cannot tell.

That gap is what a claim graph fills.

---

## 8. The order to learn this in

Assumes you already know embeddings, vector search, RAG, chunking, and reranking. This
starts one level above that. Each step exists to answer one question; if you can already
answer it, skip the step.

### Step 1 — Why similarity is the wrong ranking function (~20 min)

*Question: I already do RAG. What exactly breaks?*

Not "vector search is bad" — it's that relevance and truth are different axes, and no
index has a notion of a fact being retired. Read HydraDB's own argument for this (it's
the clearest short statement of the thesis you'll build against), then their benchmarks
page for how they frame the "State Confusion Problem".

- hydradb.com/blog/agent-memory-layer-vs-vector-db
- benchmarks.hydradb.com/hydradb

### Step 2 — Graphs, pitched at someone who knows vectors (~30 min)

*Question: what does a graph give me that a filtered vector index doesn't?*

Three ideas only: triples, predicates, and multi-hop traversal. You do not need RDF,
SPARQL, or ontology theory. The single test to keep in mind: **can this query be
expressed as "find the node with no edge of type X"?** If yes, a vector store cannot do
it at all.

### Step 3 — GraphRAG, and its critics (~40 min)

*Question: has the graph-plus-RAG marriage already been solved?*

Microsoft's GraphRAG is the canonical version. Watch one explainer, then deliberately
read one critique — the "GraphRAG is overhyped" case is worth knowing, because judges
will have heard it, and our answer is that we use the graph for *adjudication*, not
retrieval.

### Step 4 — Time: the actual core of this project (~60 min) ★

*Question: how do serious systems represent a fact that changed?*

This is the step that matters most. Two sub-ideas:

**Bi-temporal modelling** — every fact has two clocks: when it was true in the world
(valid time) and when the system learned it (transaction time). A fact can stop being
true in June and only be discovered in August. Most systems collapse these into one and
then can't answer either question properly.

**Immutability / event sourcing** — never mutate, append a correction; current state is a
fold over history. If you know this from software architecture, you already have the
intuition for our entire design — we're applying it to knowledge instead of to
application state. Rich Hickey's Datomic talks and Greg Young's event sourcing talks are
the best possible on-ramp precisely *because* they're not about AI.

### Step 5 — Zep / Graphiti: the closest working system (~40 min)

*Question: someone built this already — what exactly did they build, and where does it
stop?*

Read the Graphiti paper (arXiv 2501.13956) for the mechanism, not the scores. Focus on
one thing: **how they decide an edge is invalid, and what they write when it happens.**
That's the design decision we're making differently — they infer invalidation, we author
it and show our work.

### Step 6 — The three sub-problems (~45 min)

*Question: what will actually be hard on Tuesday?*

- **Entity resolution** — deciding `Sam`, `@soham`, `S. Ratnaparkhi` are one person.
  Named in the track brief. Classic and unsolved in general.
- **Contradiction detection** — how systems decide two statements conflict (NLI /
  entailment). Our v1 rule is deliberately cruder: same entity + same predicate,
  different value.
- **Abstention** — why models invent answers instead of declining, and what it takes to
  make refusal a first-class outcome. HydraDB evaluates this in their "safety set", so
  it's a criterion they already care about.

### Step 7 — HydraDB, hands-on (~45 min)

*Question: what do I actually call tomorrow?*

Read in this order — the conceptual page first, then the two that matter for us:

1. docs.hydradb.com/get-started/v2/core-concepts — databases vs collections, knowledge vs
   memory
2. docs.hydradb.com/essentials/v2/context-graphs — how their graph is built
3. docs.hydradb.com/essentials/v2/bring-your-own-graph — **`graph_payload`, the feature
   our whole build rests on**
4. docs.hydradb.com/essentials/v2/api-results — how to read chunks, `query_paths`,
   `chunk_relations`
5. Then read our own `src/spike.ts` — it's a working example of all of the above, with
   the three undocumented gotchas already handled.

### Step 8 — The corpus (~20 min)

*Question: what data am I actually reasoning over?*

Enterprise RAG Bench and Salesforce HERB, the two datasets named in the track brief.
Skim structure and question types; we only need a scoped subset.

### Step 9 — Positioning (~15 min, optional but useful)

*Question: how do I pitch this in a 3-minute video?*

Zep's "HydraDB alternative" page and their critique of competitor benchmarking. Reading a
rival's attack on your sponsor is the fastest way to learn which claims are contested —
and therefore which ones our demo should prove rather than assert.

---

**If you only have 90 minutes:** Step 1 (20) → Step 4 (60) → the `graph_payload` page in
Step 7 (10). Time is the concept; everything else is context.

---

## 9. Videos

Every URL below was confirmed against YouTube's own metadata — titles, channels and
durations came back from YouTube directly, not from memory.

### If you only have 45 minutes

| # | Video | Length |
|---|---|---|
| 1 | [Stop Using RAG as Memory — Daniel Chalef, Zep](https://www.youtube.com/watch?v=T5IMo5ntyhA) · AI Engineer | 7:01 |
| 2 | [Temporal RAG: Graphiti, Neo4j and LangGraph](https://www.youtube.com/watch?v=nIM_NimxxRc) · Tech with Homayoun | 10:25 |
| 3 | [Citation Needed: Provenance for LLM-Built Knowledge Graphs](https://www.youtube.com/watch?v=H7puB0RwJMM) · AI Engineer | 20:54 |
| 4 | [Atlas: HydraDB-Powered Enterprise Context and Ontology](https://www.youtube.com/watch?v=twhWXaFNGKk) — **a rival's Track 1 demo** | 2:25 |

Total ~41 minutes, and it covers the entire problem statement.

### The 3-hour run

Problem → already-solved → the temporal model → the discipline behind it → the messy part.

| # | Video | Length | Running |
|---|---|---|---|
| 1 | [Stop Using RAG as Memory](https://www.youtube.com/watch?v=T5IMo5ntyhA) | 7:01 | 0:07 |
| 2 | [Atlas: HydraDB Enterprise Context and Ontology](https://www.youtube.com/watch?v=twhWXaFNGKk) | 2:25 | 0:09 |
| 3 | [What is a Knowledge Graph?](https://www.youtube.com/watch?v=y7sXDpffzQQ) · IBM | 5:36 | 0:15 |
| 4 | [Slowly Changing Dimensions Explained](https://www.youtube.com/watch?v=sZFCYpojP4I) | 10:06 | 0:25 |
| 5 | [GraphRAG: Marriage of Knowledge Graphs and RAG — Emil Eifrem](https://www.youtube.com/watch?v=knDDGYHnnSI) | 19:14 | 0:44 |
| 6 | [Temporal RAG: Graphiti, Neo4j, LangGraph](https://www.youtube.com/watch?v=nIM_NimxxRc) | 10:25 | 0:55 |
| 7 | [Zep: A Temporal KG Architecture for Agent Memory](https://www.youtube.com/watch?v=NBZGieN8S6E) | 41:39 | 1:36 |
| 8 | [Citation Needed: Provenance for LLM-Built KGs](https://www.youtube.com/watch?v=H7puB0RwJMM) | 20:54 | 1:57 |
| 9 | [The Value of Values — Rich Hickey](https://www.youtube.com/watch?v=-6BsiVyC1kM) | 31:43 | 2:29 |
| 10 | [Entity Resolution at Scale — Huon Wilson](https://www.youtube.com/watch?v=Vyco67swTSk) | 23:10 | 2:52 |

Still going? [Build an AI Knowledge Graph with Graphiti + Neo4j](https://www.youtube.com/watch?v=H2Cb5wbcRzo)
(24:04) leaves you with running code.

### Knowledge graphs

- [What is a Knowledge Graph?](https://www.youtube.com/watch?v=y7sXDpffzQQ) · IBM · 5:36 — cheapest orientation
- [Graph Databases: When to Use Them (And When to Run Away)](https://www.youtube.com/watch?v=7kXY-2fYdHI) · Hamel Husain · 33:57 — honest counterweight
- [Knowledge Graph or Vector Database… Which is Better?](https://www.youtube.com/watch?v=6vG_amAshTk) · Adam Lucek · 41:07 — head-to-head with code
- [Extracting Knowledge Graphs From Text With GPT-4o](https://www.youtube.com/watch?v=O-T_6KOXML4) · Thu Vu · 23:40 — **the step our pipeline lives or dies on**
- [Property Graph vs Triple Store](https://www.youtube.com/watch?v=PEyW-MfxaEA) · 15:17 — matters when choosing where to hang a date on an edge

### GraphRAG — and its critics

- [GraphRAG: The Marriage of Knowledge Graphs and RAG](https://www.youtube.com/watch?v=knDDGYHnnSI) · Emil Eifrem · 19:14
- [GraphRAG methods for optimized context windows](https://www.youtube.com/watch?v=c5qJHr3DnT4) · Microsoft's Jonathan Larson · 15:08
- [I Was Wrong About GraphRAG: What Won in 2026](https://www.youtube.com/watch?v=rEITYxTJggU) · 10:47 — **watch one critique; this is the most current**
- [Dispelling GraphRAG hype](https://www.youtube.com/watch?v=BEXEw6T4234) · 9:07 — the cost argument

### Agent memory

- [Stop Using RAG as Memory](https://www.youtube.com/watch?v=T5IMo5ntyhA) · 7:01 — names our exact failure mode
- [Zep: Temporal KG Architecture for Agent Memory](https://www.youtube.com/watch?v=NBZGieN8S6E) · 41:39 — **closest thing to a spec for our build**
- [Temporal RAG with Graphiti](https://www.youtube.com/watch?v=nIM_NimxxRc) · 10:25 — concept to code fastest
- [Citation Needed: Provenance](https://www.youtube.com/watch?v=H7puB0RwJMM) · 20:54 — the "or refuse" half
- [Mem0: Scalable Long-Term Memory](https://www.youtube.com/watch?v=EE4pvOEAjXc) · 13:31 — **the counter-design**: mutates in place where Zep retires
- [Architecting Agent Memory](https://www.youtube.com/watch?v=W2HVdB4Jbjs) · MongoDB · 17:36 — episodic/semantic/procedural taxonomy
- [Approaches for Managing Agent Memory](https://www.youtube.com/watch?v=3aS1A-0775s) · LangChain · 11:34 — inline vs background writes

### Time, immutability, event sourcing

- [The Incredible Power of XTDB and Bitemporal Data](https://www.youtube.com/watch?v=Mr4NQyK5PW4) · 3:00 — the two axes in three minutes
- [The Value of Values — Rich Hickey](https://www.youtube.com/watch?v=-6BsiVyC1kM) · 31:43 — **why you never delete**, the thesis our supersedes edge implements
- [Slowly Changing Dimensions (Type 1/2/3)](https://www.youtube.com/watch?v=sZFCYpojP4I) · 10:06 — the warehouse world's name for our design
- [Bitemporal Databases: What They Are and Why They Matter](https://www.youtube.com/watch?v=3sRKQg9-In8) · 56:43 — clearest valid-vs-transaction-time treatment on YouTube
- [A Decade of DDD, CQRS, Event Sourcing — Greg Young](https://www.youtube.com/watch?v=LDW0QWie21s) · 48:03 — what event sourcing is *not* for
- [Rich Hickey: Deconstructing the Database](https://www.youtube.com/watch?v=Cym4TZwTCNU) · 1:06:23 — retraction as an assertion *about* a fact, not a delete

> **Caveat worth carrying:** Hickey covers transaction time and as-of queries brilliantly
> but only partly addresses *valid time* — "this was true from March even though we
> learned it in June." That half comes from the bitemporal talks. We need both axes.

### Entity resolution

- [Entity Resolution and Deduplication with Neo4j and GenAI](https://www.youtube.com/watch?v=GMTY78xqGXQ) · 50:00 — exactly our failure mode: extraction makes duplicate nodes for one entity
- [Entity Resolution at Scale — Huon Wilson](https://www.youtube.com/watch?v=Vyco67swTSk) · 23:10 — best 23 minutes for architecture intuition
- [Rapid deduplication with Splink](https://www.youtube.com/watch?v=eQtFkI8f02U) · 27:24 — blocking rules, Fellegi-Sunter, EM training without labels

### Retrieval quality and refusal

- [Navigating Neural Search: Avoiding Common Pitfalls](https://www.youtube.com/watch?v=PrBtxqARY9U) · 41:48 — **why your embeddings will betray you**
- [Why Language Models Hallucinate — Adam Kalai](https://www.youtube.com/watch?v=0dRouBLcvMs) · 1:09:32 — hallucination as a *scoring artifact*: benchmarks reward guessing and punish "I don't know". Directly underwrites our refuse path
- [Learning to hybrid search](https://www.youtube.com/watch?v=TBbw2dob-As) · 46:17 — RRF vs score normalisation, measured
- [RAG Evaluation Is Broken](https://www.youtube.com/watch?v=Ywl4LsvHKzU) · 10:58 — measure groundedness separately from answer quality
- [RAG Agents in Prod: 10 Lessons — Douwe Kiela](https://www.youtube.com/watch?v=kPL-6-9MVyA) · 16:56 — from the person who named RAG

### HydraDB itself

No official channel and no product demo exists. The founder interviews are the substance:

- [Why does AI Need Better Context — Nishkarsh Srivastava](https://www.youtube.com/watch?v=J3bPJ9n77zo) · 21:10 · **published Aug 14, 2026**
- [He Raised $6.5M With Three Words](https://www.youtube.com/watch?v=FEc9GBqHWHw) · Composio · 40:19 — densest on the actual thesis
- [Meet My CEO & His Vision](https://www.youtube.com/watch?v=WDPjdIDe4Iw) · 20:16

Community hackathon demos are the only place the API is driven in anger — roughly
fourteen exist, including the Atlas Track 1 demo linked above.
