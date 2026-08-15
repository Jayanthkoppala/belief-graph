# belief-graph

**A supersession layer for HydraDB — a corpus that remembers what it stopped believing.**

Built for [Hack Hydra](https://hackhydra.hydradb.com) (Aug 12–20, 2026), Track 01:
enterprise context and ontology.

## The problem

Ask a question of a company's accumulated Slack, email, tickets and docs and you get an
answer. You do not get to know that the answer was true in March, was contradicted in
June, and that half the company still believes the March version.

Retrieval systems are built to return what is *most similar*, not what is *currently
true*. When a fact is revised, the old statement stays in the index with the same
standing as the new one. The system has no notion of a belief that died.

## What this does

Three things, one mechanism:

1. **Claims, not chunks.** Every assertion in the corpus becomes a typed claim —
   entity, predicate, value, timestamp, source — injected into HydraDB as a
   deterministic graph rather than left to text similarity.
2. **Supersession instead of overwrite.** When a new claim contradicts a stored one
   about the same entity and predicate, the old claim is not replaced. A dated
   supersession edge is written between them, carrying the evidence that caused the
   change.
3. **Abstention.** When no claim supports a question, the answer is a refusal with the
   neighbourhood it searched — not a plausible invention.

Answers therefore come in three parts: what holds now, what was believed before and
when it died, and what the corpus cannot support at all.

## Why HydraDB

The graph is not decoration here; it is the datastructure the product is about.

- `graph_payload` accepts a pre-computed graph, so claims and supersession edges are
  written deterministically instead of being guessed by an extractor.
- Every relation returned carries `confidence`, `timestamp`, `temporalDetails` and the
  verbatim passage that evidences it — the provenance a belief history needs.
- `context.relations()` with the source id omitted returns database-wide triplets with
  cursor pagination, so the belief graph can be materialised locally and walked to any
  depth.
- Hybrid retrieval still finds the relevant region of the corpus; the graph decides what
  in that region is still true.

Without HydraDB this is two systems — a vector index and a separate graph store — kept
in sync by hand.

## Status

Hackathon build, work started 2026-08-15. Design: [`docs/design.md`](docs/design.md).

## Stack

TypeScript / Node, [`@hydradb/sdk`](https://docs.hydradb.com) v2.

## License

MIT
