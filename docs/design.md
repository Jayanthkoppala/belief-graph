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

## Mechanism

One idea: **a claim is a node, and claims can retire other claims.**

**Ingest.** Documents go in as normal so hybrid retrieval works. Alongside them we send a
`graph_payload` — an author-supplied graph of claims. Each claim node carries its entity,
predicate, value, timestamp and source. This is deterministic: we decide the edges, not an
extractor. HydraDB's own LLM extraction still runs on sources we do not supply a payload
for, so inferred edges and authored edges coexist.

**Conflict detection.** Two claims conflict when they share an entity and predicate but
assert different values. The later claim wins by default; an explicit `supersedes` edge is
written from new to old, carrying the evidence passage that caused the change. Nothing is
deleted — the retired claim stays queryable, marked.

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

## Non-goals

Not a chat product. Not a benchmark chase. Not a recruiting tool — HydraDB already ships
an AI recruiter cookbook, and following the tutorial is the opposite of the point.
