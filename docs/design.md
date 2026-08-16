# Design

## The idea

Retrieval systems rank by similarity to your question. Nothing in an index records that one
statement retired another, so a March runbook and the June message that invalidated it sit
side by side with equal standing.

belief-graph makes the **claim** the unit. A claim carries what it asserts, when it was
stated, which source it came from, and the sentence that evidences it. Once a claim is a
node rather than prose, claims can act on other claims: a later one writes a dated
`supersedes` edge to the one it retires. Nothing is deleted.

Answers come back in three parts, any of which may be empty:

- **Holds now** — the live claim, with source and date.
- **No longer held** — retired claims, when they died, and what retired them.
- **Unsupported** — the part of the question no claim covers.

## Data model

A claim node records:

| Field | Meaning |
|---|---|
| `entity` | what the claim is about |
| `predicate` | which property |
| `value` | the asserted value |
| `stated_at` | when the claim was made in the world |
| `ingested_at` | when we learned it |
| `source` | the document or message it came from |
| `evidence` | the verbatim passage supporting it |

Edges: `asserts` (claim → value), `about` (claim → entity), and `supersedes`
(claim → retired claim), the last carrying the date and the evidence that caused the change.

## Conflict rules

Two claims conflict when they share an entity and a predicate, assert different values, and
refer to the same event. Four rules govern what happens next; each is a silent bug if
skipped.

1. **Per-predicate cardinality.** Some predicates hold one value at a time (`owner`,
   `current_datastore`); others hold many (`depends_on`, `mentions`). Only single-valued
   predicates can be superseded. Applying supersession to a many-valued predicate deletes
   knowledge without error.
2. **Order by stated time, not arrival time.** A document ingested today can assert a fact
   from two years ago. Resolving conflicts by ingestion order retires the wrong claim.
3. **Two clocks, never collapsed.** Stated time and ingest time are separate fields, and
   "unknown stated time" is representable. Defaulting one to the other asserts that a fact
   became true the moment it was read.
4. **No derived claims.** Only claims extracted directly from a source passage are stored,
   never conclusions inferred from other claims. Retiring a claim therefore cannot orphan a
   conclusion that depended on it.

## Abstention

Retrieval always returns its closest chunks whether or not any of them answer the question.
Abstention is therefore decided against **claim coverage**, not similarity scores: if no live
claim covers the entity and predicate being asked about, the system declines and reports the
neighbourhood it searched.

## Built on HydraDB

Two surfaces, each doing a job the other cannot.

- **The managed API** provides hybrid retrieval (dense + BM25) to find the region of the
  corpus a question is about, and accepts a `graph_payload` so the claim graph is authored
  deterministically rather than inferred by an extractor.
- **The open-source engine** (`hydra-db/hydradb`, OpenCypher over Bolt) stores and traverses
  the claim graph. Supersession chains are walked with real queries.

Retrieval finds where to look. The graph decides what is still true there.

### Notes on the engine's Cypher subset

Recorded here because they shape the implementation. Verified against `cypher-compat.md`
and confirmed in practice:

- No unbounded variable-length traversal (`*`, `*1..`); depths must be bounded.
- No `IS NULL`, `IN`, `CONTAINS` or `ENDS WITH` in `WHERE`, and negated pattern predicates
  (`WHERE NOT (()-[:REL]->(n))`) are unsupported — absence queries move client-side.
- `RETURN n` for a whole node is unsupported; project properties or aggregate.
- `MATCH` followed by `CREATE` is unsupported; use a single `MERGE` clause.
- `MERGE` requires integer ids. Via the JS driver, plain numbers serialize as floats and are
  rejected — wrap with `neo4j.int()`.
- **A multi-hop `MATCH` with an anonymous interior node is lowered into unjoined segments**,
  so the path becomes a cross product (engine issue #95, high severity). Name every interior
  node in a traversal, and do not run `SET`/`DELETE` against such a pattern — the mutation
  can reach vertices the path never visited.
- Path procedures differ in how they take an origin: `SSpaths` wants an integer source,
  `MSpaths` requires the set form. `sourceValues` entries match as **strings**, so a string
  compared against an integer property parses cleanly and silently selects nothing.
- `SSpaths` without an explicit `pathCount` returns only the single shortest path, so a
  neighbour count silently reads as 1. `RETURN count(path)` is rejected.
- `UNWIND` batches cap at 1024 rows.
- Run the container with `CLOUD_PROVIDER=memory` for development. The documented
  `CLOUD_PROVIDER=local` cannot sustain writes (issue #81).

Retrieval tuning: `alpha` blends dense and sparse scoring and defaults to 0.8. An enterprise
corpus is dense with identifiers (service names, error codes, handles, version strings) that
embeddings smear, so identifier-shaped queries are detected and run nearer 0.3–0.5.

## Status

In progress for Hack Hydra 2026. Scope, corpus and evaluation are recorded in the README as
they are settled.
