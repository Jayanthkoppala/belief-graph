# Design

## The problem

Retrieval ranks by similarity to your question. Nothing in an index records that one
statement retired another, or that the corpus contains no answer at all — so a stale
document and the message that invalidated it sit side by side with equal standing, and a
question nobody wrote the answer to still returns ten confident chunks.

## What this builds

Three capabilities, each aimed at something no shipped system does well.

**Conflict as an output, not a silent resolution.** When two claims disagree, both survive.
The answer names which one is current, when the other was retired, and what retired it.
Production systems resolve conflicts upstream or rank by recency; the disagreement never
reaches the user.

**Abstention as a coverage test.** If no claim covers the entity and property being asked
about, the system declines and shows the neighbourhood it searched. This is decided against
claim coverage, not similarity scores — retrieval always returns its closest chunks whether
or not any of them answer the question.

**Entity resolution beyond string matching.** Embedding-based candidate generation with
confidence scores, rather than exact or fuzzy string comparison, on a corpus deliberately
seeded with codenames and near-duplicates.

## Corpus

**EnterpriseRAG-Bench** (`onyx-dot-app`), the Redwood Inference corpus named in the Track 01
brief. 500k+ documents across nine sources, dominated by Slack (~286k) and Gmail (~121k).
Documents carry only an id, source type, title and content — no structured metadata, so any
structure has to be induced from the text.

Its 500 questions span ten categories. Two are ours by construction: **Conflicting Info**
and **Info Not Found**, 20 questions each.

Scoring is the *product* of correctness and completeness. A wrong answer scores zero however
complete it is, which means abstaining on an unanswerable question is free and guessing is
pure loss.

We ingest a deliberately scoped subset and say so plainly. Onyx has published retrieval
curves on this exact corpus, so any number we report will be read against a known baseline —
an argument for a small honest measurement over a large vague one.

### What the published curves tell us

Onyx measured recall on this corpus as it scales: vector recall@10 falls from 81% at 5k
documents to 41% at 510k, while BM25 degrades more gracefully, 85% to 56%. Their finding is
that recall tracks the ratio of `k` to corpus size rather than corpus size itself, and that
semantically *similar* documents are what destroy recall — adding 100k dissimilar documents
cost about 1%.

Two consequences for the build: naive top-10 vector retrieval is a documented loser here, and
`k` must scale with the subset we ingest.

## Data model

A claim node records:

| Field | Meaning |
|---|---|
| `entity` | what the claim is about |
| `predicate` | which property |
| `value` | the asserted value |
| `stated_at` | when the claim was made in the world |
| `ingested_at` | when we learned it |
| `source` | the document it came from |
| `evidence` | the verbatim passage supporting it |

Edges: `asserts`, `about`, and `supersedes` — the last carrying the date and the evidence
that caused the change.

## Conflict rules

Two claims conflict when they share an entity and a predicate, assert different values, and
refer to the same event. Four rules govern what follows; each is a silent bug if skipped.

1. **Per-predicate cardinality.** Some predicates hold one value at a time (`owner`,
   `current_datastore`); others hold many (`depends_on`, `mentions`). Only single-valued
   predicates can be superseded. Applying supersession to a many-valued predicate deletes
   knowledge without raising an error.
2. **Order by stated time, not arrival time.** A document ingested today can assert a fact
   from two years ago. Resolving by ingestion order retires the wrong claim.
3. **Two clocks, never collapsed.** Stated time and ingest time are separate fields, and
   "unknown stated time" is representable. Defaulting one to the other asserts a fact became
   true the moment it was read.
4. **No derived claims.** Only claims extracted directly from a source passage are stored,
   never conclusions inferred from other claims — so retiring a claim cannot orphan a
   conclusion that depended on it.

## Indexing strategy

LLM spend is deferred to query time. Index-time work is cheap and deterministic: chunking,
embedding, candidate entity extraction. Claim extraction and conflict adjudication run over
the retrieved neighbourhood, not the whole corpus.

The reason is arithmetic. Full graph construction over a large corpus costs hours of frontier
model time and does not extrapolate to half a million documents on a four-day clock.

## Built on HydraDB

Two surfaces, each doing a job the other cannot.

- **The managed API** provides hybrid retrieval (dense + BM25) to locate the region of the
  corpus a question is about, and accepts a `graph_payload` so the claim graph is authored
  deterministically rather than inferred.
- **The open-source engine** (`hydra-db/hydradb`, OpenCypher over Bolt) stores and traverses
  the claim graph.

Retrieval finds where to look. The graph decides what is still true there.

Retrieval tuning: `alpha` blends dense and sparse scoring and defaults to 0.8. This corpus is
dense with identifiers — service names, error codes, handles, version strings — that
embeddings smear, and BM25 degrades more gracefully at scale here. Identifier-shaped queries
are detected and run nearer 0.3–0.5.

### Engine constraints

Verified against `cypher-compat.md` and confirmed in practice:

- No unbounded variable-length traversal (`*`, `*1..`); depths must be bounded.
- No `IS NULL`, `IN`, `CONTAINS` or `ENDS WITH` in `WHERE`, and negated pattern predicates
  (`WHERE NOT (()-[:REL]->(n))`) are unsupported — absence queries move client-side.
- `RETURN n` for a whole node is unsupported; project properties or aggregate.
- `MATCH` followed by `CREATE` is unsupported; use a single `MERGE` clause.
- `MERGE` requires integer ids. Via the JS driver, plain numbers serialize as floats and are
  rejected — wrap with `neo4j.int()`.
- A multi-hop `MATCH` with an anonymous interior node is lowered into unjoined segments, so
  the path becomes a cross product (engine issue #95). Name every interior node, and do not
  run `SET`/`DELETE` against such a pattern.
- Run with `CLOUD_PROVIDER=memory` in development; the documented `local` provider cannot
  sustain writes (issue #81).

### Path procedures

The restriction on variable-length traversal does not make transitive queries impossible.
The engine exposes three native path procedures, absent from the published documentation and
read from the engine source:

| Procedure | Origin |
|---|---|
| `algo.SPpaths` | single pair; requires `sourceNode` and `targetNode` |
| `algo.SSpaths` | single source; takes `sourceNode`, rejects `targetNode` |
| `algo.MSpaths` | multi source; requires a `source` selector set |

They share `relTypes`, `maxLen`, `relDirection` and `pathCount`, and yield `path`,
`pathWeight` and `pathCost`.

Supersession chains are walked with `algo.SSpaths` filtered to `relTypes: ['SUPERSEDES']`
and a bounded `maxLen`, server-side. `pathWeight` and `pathCost` allow chains to be ranked
rather than merely enumerated.

Note the origin forms differ: `SSpaths` wants an integer source while `MSpaths` requires the
set form, `sourceValues` entries match as strings (a string compared against an integer
property parses cleanly and silently selects nothing), value lists must be inlined rather
than parameterised, `SSpaths` without an explicit `pathCount` returns only the shortest path,
and `UNWIND` batches cap at 1024 rows.

## What this does not claim

**Not ontology alignment.** That term means matching independently-authored ontologies to
each other, and it is a research pursuit — no production system ships it. What happens here
is per-source extraction onto a canonical model we author, which is data integration with
adapters, and is described as such.

**Not scale.** The corpus is scoped, and retrieval curves for the full corpus are already
published by others.

**Not permissions.** Well understood elsewhere, and absent from this benchmark.

## Status

In progress for Hack Hydra 2026.
