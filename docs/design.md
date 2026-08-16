# belief-graph — design

Hack Hydra, Track 01 (enterprise context and ontology). Written 2026-08-15.

## The bet

HydraDB's marketing promises temporal versioning, point-in-time recall and entity
resolution. Its API documents none of them: there is no fact invalidation, no `as_of`
parameter, and no deduplication beyond overwrite-by-id. That is precisely the ground
Zep/Graphiti competes on. Track 01's brief — entity resolution, ontology alignment,
deciding which of two contradictory statements to trust, and recognising when the answer
is absent — is a description of that same gap.

So the bet is to build the missing capability *on* HydraDB rather than around it, using
the primitives it does expose.

## Which HydraDB — and why it matters

HydraDB is two products, and the hackathon brief means the second one.

- **The managed API** (`api.hydradb.com`): hybrid retrieval over chunks, an entity graph
  built by LLM extraction, `graph_payload` for supplying your own graph. No query language.
- **The open-source engine** (`github.com/hydra-db/hydradb`, AGPL-3.0, Rust): an
  object-store-native graph database speaking **OpenCypher** over a **Neo4j-compatible Bolt**
  interface, plus an HTTPS query API. Published container image for `linux/arm64`, so it
  runs locally: Bolt on 7687, HTTP on 8443.

The brief says "build with the HydraDB open-source repo," and the visible Track 1 field is
using it — one competitor pins it as a git submodule and describes its answer path as "a
bounded OpenCypher traversal, not a vector lookup."

**Decision (2026-08-16): use both surfaces.** The managed API finds *where* in the corpus to
look; the OSS engine decides *what is still true* there. Each does a job the other cannot,
and the split is what makes the demo legible — a supersession chain walked by a real query
beats a chunk list. Cost is a second integration on a four-day clock; accepted.

### Verified constraints of their Cypher dialect

Checked against `cypher-compat.md` in the engine repo. It is a deliberately restricted
subset, rejected at parse time rather than silently:

- **No temporal features at all** — no `as_of`, no point-in-time, no versioning primitives.
  This is load-bearing for our positioning: the engine executes traversal and has no opinion
  about whether an edge is still live. That layer is ours.
- **No unbounded variable-length traversal** (`*`, `*1..`). Bounded only — fine, supersession
  chains are short, but every traversal needs an explicit depth.
- **No `IS NULL`, `IN`, `CONTAINS` or `ENDS WITH` in `WHERE`.** This is the awkward one: the
  "find the entity with no claim of type X" absence query cannot be written the obvious way.
  Structural absence has to be expressed differently — plan for this before relying on it in
  the demo.
- Also rejected: `RETURN *`, `min`/`max` aggregates, undirected patterns, multi-statement
  requests, `WITH` that aliases or filters.

`EXPLAIN` is available via `explain_opencypher_rows`, and a query the parser rejects fails
there too — so validate query shapes cheaply before pointing them at data.

Licensing: the engine is **AGPL-3.0** and this repo is MIT. Running it and pinning it as a
submodule is fine; copying its source into this tree is not.

## Mechanism

One idea: **a claim is a node, and claims can retire other claims.**

**Ingest.** Documents go in as normal so hybrid retrieval works. Alongside them we send a
`graph_payload` — an author-supplied graph of claims. Each claim node carries its entity,
predicate, value, timestamp and source. This is deterministic: we decide the edges, not an
extractor.

Important correction: `graph_payload` is **replace, not augment**. A source carrying a
payload gets *no* LLM-extracted facts at all — only ours. It is still chunked and
embedded, so it stays fully searchable, and skipping the extraction call makes ingestion
measurably faster. So authored and inferred edges coexist **across** sources, never within
one. Our design accepts that trade deliberately: claim sources are ours and precise;
anything we want inferred edges on, we ingest without a payload.

Two consequences to respect:

- **A linked relation is *sourced*, not *supported*.** HydraDB links every supplied
  relation to its best-matching chunk with no reject floor, so a weak match still links.
  We therefore carry our own evidence passage on the claim rather than trusting the
  chunk association for citation.
- **The payload survives re-ingestion.** Re-ingesting a source without a payload re-applies
  the stored graph rather than falling back to extraction, so iterating on document text
  doesn't silently destroy our claims.

**Conflict detection.** Two claims conflict when they share an entity and predicate but
assert different values. The later claim wins by default; an explicit `supersedes` edge is
written from new to old, carrying the evidence passage that caused the change. Nothing is
deleted — the retired claim stays queryable, marked.

Four rules learned from prior art, each of which is a bug if skipped:

1. **Per-predicate cardinality is mandatory.** Some predicates hold one value at a time
   (`current_datastore`, `owner`), others hold many (`depends_on`, `mentions`). Applying
   supersession to a many-valued predicate deletes knowledge. Every predicate in our
   vocabulary declares its cardinality; only single-valued ones can be superseded.
2. **Order by stated time, never by arrival time.** A document ingested today can assert a
   fact from 2024. Keying supersession off ingestion order retires the wrong claim — the
   most common way an implementation is quietly wrong. Each claim carries the time it was
   *stated*, extracted relative to its source's own timestamp, and conflicts resolve on
   that axis.
3. **Two clocks, kept separate.** *Stated time* (when the claim was made in the world) and
   *ingest time* (when we learned it) are different fields and never collapsed. "Unknown
   stated time" is representable — defaulting it to ingest time silently asserts the fact
   became true the moment we read it.
4. **No derived claims.** We store only claims extracted directly from a source passage,
   never conclusions inferred from other claims. This sidesteps retraction cascades
   entirely: retiring a claim can never orphan a conclusion that depended on it, because
   no such conclusions exist. If we ever add derived claims, they are marked derived,
   record their inputs, and are treated as an invalidatable cache rather than a belief.

Conflict is also *not* simply the opposite of agreement. Two claims conflict only if they
concern the same entity, the same predicate, **and the same event** — "ran 5 miles Tuesday"
and "ran 3 miles Wednesday" contradict nothing. Our v1 rule is deliberately crude and
explicit rather than an LLM judge deciding freely; that keeps failures legible in a demo.

**Retrieval tuning — per-query alpha (decided 2026-08-16).** HydraDB's `alpha` blends dense
and sparse retrieval (1.0 pure semantic, 0.0 pure BM25) and defaults to **0.8**, which is
tuned for prose. Our corpus is full of literal tokens that dense embeddings smear: service
names, error codes, handles, version strings. So retrieval detects **identifier-shaped
queries** — digits, underscores, `@`, all-caps tokens, version-like dots, known entity names
— and drops `alpha` to roughly 0.3–0.5 for those, leaving conceptual questions
semantic-leaning. About half an hour of work.

Tune it against the gold questions, not by eye. Without labelled judgements, adjusting
`alpha` measures confirmation bias rather than retrieval quality — and being able to show
that measurement is itself worth points where rivals show screenshots.

**Retrieval.** A question runs against HydraDB in thinking mode with graph context on. The
returned chunks locate the relevant region; the claim graph decides which assertions in
that region are still live. Multi-hop is computed locally: `context.relations()` with the
source id omitted returns database-wide triplets with cursor pagination, so the graph is
materialised in memory and walked to any depth.

**Abstention.** If no live claim supports the question, the system refuses and reports the
neighbourhood it searched. HydraDB always returns ranked chunks — its own agent guide
notes "a low-relevance result is still a result" — so abstention has to be our decision,
made against claim coverage rather than chunk scores.

## Answer shape

Every answer has three parts, and any of them may be empty:

- **Holds now** — the live claim, with its source and date.
- **No longer held** — retired claims, when they died, and what retired them.
- **Unsupported** — the part of the question no claim covers.

## Demo (3 minutes)

1. A lookup that works, with citation.
2. A question whose answer changed: the version chain renders — old belief, new belief,
   the message that flipped it, the date.
3. A question the corpus cannot answer: refusal with the searched neighbourhood, next to
   a baseline that confidently invents an answer from the same corpus.

## Corpus

**Decision (2026-08-16): EnterpriseRAG-Bench** (onyx-dot-app), the ~500K-document
"Redwood Inference" corpus with 500 gold questions. It is the dataset named in the Track 1
brief and the one the visible field is scoring against, so our numbers are directly
comparable — "we got X on the same 500 questions" lands with a judge in a way that a good
score on a dataset nobody else ran does not.

If it turns out to lack labelled *unanswerable* questions, we borrow that slice from HERB
for the abstention evaluation and say so plainly rather than quietly mixing corpora.

### Fallback: Salesforce HERB

(huggingface.co/datasets/Salesforce/HERB) — kept as the alternative because it fits the
build unusually well:

- Real enterprise shapes — Slack messages, meeting transcripts, documents, URLs, pull
  requests — across ~530 employee profiles and multiple fictional companies.
- Multi-hop questions with guaranteed ground truth.
- **Both answerable and unanswerable questions.** The unanswerable set is our abstention
  demo with a ground-truth label attached, which is far stronger than us asserting a
  question is unanswerable.
- Deliberate "realistic noise" baked in.

Licensing: **CC-BY-NC-4.0, research use only, generated with GPT-4o.** That is fine for a
hackathon submission but must be attributed in the README, and we do not redistribute the
data in the repo — only loading code.

Not yet verified: whether HERB contains *explicitly contradictory* statements or only
noise. If it doesn't, we introduce a small number of dated revisions ourselves and label
them clearly as an authored overlay rather than pretending they came from the corpus.

## Scope discipline

- The corpus is a deliberately chosen subset, not all ~500k documents. The free storage
  tier will not hold the full set, and the README says so plainly rather than implying
  full coverage.
- Ingestion happens first, before application code. Graph construction is a stage that
  runs *after* content becomes searchable; a late bulk ingest yields a thin graph with no
  error to explain it.
- No hard-coding against predicate strings from HydraDB's own extractor — they are
  LLM-normalised and non-deterministic. Authored predicates are ours and stable; extracted
  ones are read, never assumed.

## Risks

| Risk | Handling |
|---|---|
| `graph_payload` does not behave as documented | Hour-one spike; fall back to reading HydraDB's extracted graph and writing supersession as metadata |
| Graph creation too slow for iteration | Ingest a small corpus first, expand only once the pipeline is proven |
| Conflict detection produces false contradictions | Require same entity *and* predicate, different value; show confidence and let the demo include a near-miss |
| Free tier storage limits | Scope the corpus; state the subset explicitly |

## The field (as of 2026-08-16)

Roughly 19 public repos exist for this hackathon. At least four Track 1 entries are building
the same primitives we are — claims as nodes, `SUPERSEDES` edges, explicit abstention:

| Repo | Project | Signal |
|---|---|---|
| `dukemawex/atlas-hydra` | Atlas | Person/Project/Claim/Decision nodes, `SUPPORTS`/`CONTRADICTS`/`SUPERSEDES`, explicit `NOT_FOUND`. FastAPI UI, demo video shot, OSS engine as submodule. 11 commits. |
| `Shrujal00/glasshouse-hydradb` | Glasshouse | "Disagreements are kept, not hidden"; "knowing when to shut up". Uses both the managed API and the OSS engine. Best-presented. 23 commits. |
| `PrathamS1/hydra-brain` | Company Brain | 7-stage pipeline; conflict layer with trust/recency; entity resolution via `algo.MSpaths`; scored on EnterpriseRAG-Bench's 500 gold questions. 2 commits. |
| `gowthamchoudhary/Cortex-hq` | Cortex | "enterprise knowledge graph & temporal ontology layer". 37 commits, 16MB. |

**So the idea is table stakes; execution and correctness are the whole game.** The defensible
ground is the set of things most implementations of this get wrong — ordering by arrival time
instead of stated time, no per-predicate cardinality, one clock instead of two — plus evidence
that our abstention is a coverage test rather than a prompt. Being demonstrably correct where
others are plausibly wrong is a better three-minute video than another conflict demo.

Note the corpus the field is using is **EnterpriseRAG-Bench** (onyx-dot-app, ~500K docs,
500 gold questions), not HERB. Comparable numbers may matter more than a nicer dataset.

## Non-goals

Not a chat product. Not a benchmark chase. Not a recruiting tool — HydraDB already ships
an AI recruiter cookbook, and following the tutorial is the opposite of the point.
