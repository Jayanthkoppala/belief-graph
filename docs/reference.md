# Reference

Verified facts, mechanisms and short attributed quotes, gathered from primary sources —
papers, source code and vendor docs that were actually fetched and read. This is the
knowledge base to check against while building.

Not included: video transcripts. YouTube blocks automated extraction, and full transcripts
of conference talks are the speakers' copyrighted work. Every video in the guide is listed
there with its own link; the substance below comes from things we could read directly.

---

## 1. How Zep/Graphiti invalidates a fact

Source: [arXiv:2501.13956](https://arxiv.org/abs/2501.13956) (Rasmussen, Paliychuk, Beauvais,
Ryan, Chalef — Zep AI, Jan 2025); [`graphiti_core/prompts/dedupe_edges.py`](https://github.com/getzep/graphiti/blob/main/graphiti_core/prompts/dedupe_edges.py);
[Beyond Static Knowledge Graphs](https://blog.getzep.com/beyond-static-knowledge-graphs/).

**Four timestamps per edge, on two independent timelines.**

| Timeline | Fields | Meaning | Set by |
|---|---|---|---|
| Event (T) | `valid_at`, `invalid_at` | when the fact held true in the world | LLM-extracted from the text |
| Transactional (T′) | `created_at`, `expired_at` | when the fact entered/left the system | the ingestion pipeline |

**The mechanism.** The paper describes using an LLM to compare a new edge against
semantically related existing ones to find contradictions. On a conflict with temporal
overlap, it sets the old edge's `t_invalid` to the `t_valid` of the invalidating edge.

**Two behaviours worth stealing:**

1. **Retired facts are rewritten into past tense.** "Maria works as a junior manager" is
   regenerated as "Maria used to work as a junior manager, until her promotion." The node
   keeps carrying meaning after death instead of becoming a tombstone.
2. **Out-of-order arrival resolves on the event timeline.** In their example, an episode
   mentioning a 2024 divorce arrives *before* one revealing a 2005 marriage. Because
   invalidation keys off extracted `valid_at`, the right edge is still retired.
   **Naive "latest write wins" gets this backwards.**

**Their contradiction judge is one LLM call returning two lists** — `duplicate_facts` and
`contradicted_facts`. Its own worked examples draw the line:

| Existing | New | Verdict |
|---|---|---|
| "Alice joined Acme in 2020" | "Alice joined Acme in 2020" | duplicate, not contradiction |
| "Alice works at Acme as a **software** engineer" | "…as a **senior** engineer" | contradiction, not duplicate |
| "Bob ran 5 miles on Tuesday" | "Bob ran 3 miles on Wednesday" | neither — different events |

That third row is the entire difficulty of contradiction detection in one line.

**Scores:** LongMemEval 71.2% (gpt-4o) vs 60.2% full-context; DMR 94.8%.

**Calibration:** their whole contradiction engine is roughly a 120-line prompt file. Read it
before designing your own.

---

## 2. Contradiction detection is not the opposite of entailment

Source: [de Marneffe, Rafferty & Manning, ACL 2008 — *Finding Contradictions in Text*](https://aclanthology.org/P08-1118/)

Two claims conflict only if they concern the same entity, the same predicate, **and the same
event**. The paper establishes that contradiction needs finer distinctions than entailment,
and that **event coreference must be an explicit component**.

Second trap, which no paper foregrounds: **not every predicate is single-valued.** A person
has many `likes` edges but one `current_employer`. Without per-predicate cardinality, a
supersession system deletes half its knowledge and reports no error.

Related: [Contradiction Detection in RAG Systems](https://arxiv.org/pdf/2504.00180) finds LLMs
struggle as validators, so a single judge call is not a safe foundation.
[TOKI (arXiv:2606.06240)](https://arxiv.org/abs/2606.06240) formalises production resolution
strategies as bitemporal operators and shows an LLM judge in the *write path* introduces
concurrency anomalies.

Practical shape: cheap NLI cross-encoder as a recall pre-filter
([cross-encoder/nli-deberta-v3-base](https://huggingface.co/cross-encoder/nli-deberta-v3-base)),
then an LLM judge for precision, with cardinality as a hard gate.

---

## 3. Bi-temporality

Source: [Martin Fowler, *Bitemporal History*](https://martinfowler.com/articles/bitemporal-history.html);
[Time in XTDB](https://docs.xtdb.com/about/time-in-xtdb.html); Snodgrass,
[*Developing Time-Oriented Database Applications in SQL*](https://www2.cs.arizona.edu/~rts/tdbbook.pdf) (free, author-hosted).

| Axis | Answers | Fowler's term | SQL standard | Rewritable? |
|---|---|---|---|---|
| Valid time | when was this true in the world? | actual time | valid time | yes — corrected retroactively |
| Transaction time | when did we believe it? | record time | transaction time | no — append-only |

XTDB's rule of thumb: any time you hear "as of" or "with effect from", the answer is valid
time.

**The teaching example** (Olympic medal): an athlete wins gold in 2012; in 2016 a retest
strips them and the runner-up is upgraded. *Who is the 2012 champion?* The runner-up. *Who
did we think it was in 2014?* The original winner. Both correct, different questions. The
correction rewrote valid time while transaction time faithfully records that belief changed
only in 2016. **The correction did not delete the error. It dated it.**

---

## 4. Immutability, in three older traditions

**Accounting.** Pat Helland, *Immutability Changes Everything* (CIDR 2015), has a section
titled "Accountants Don't Use Erasers": entries stay in the ledger, and corrections are made
only by adding new entries. The paper's framing of the architecture: the truth is the log,
and the database is a cache of a subset of it.

**Event sourcing.** [Fowler](https://martinfowler.com/eaaDev/EventSourcing.html) — capture all
changes to application state as a sequence of events. On being wrong, see
[Retroactive Event](https://martinfowler.com/eaaDev/RetroactiveEvent.html), which is the
actual bridge for our problem: what to do when a recorded event turns out to be incorrect.
Fowler notes it's rare mostly because people don't know how.

**Data warehousing.** Kimball's Slowly Changing Dimension Type 2 adds a new row rather than
updating, carrying a row effective date, a row expiration date, and a current-row indicator.
A customer's old address isn't deleted when they move; it's closed out and a new row opens.
Shipped in the nineties. belief-graph is SCD Type 2 applied to sentences in Slack messages.

**Caveat:** Greg Young's *Event Sourcing: The Bad Parts* is worth watching before committing
to append-only. Schema evolution over an immutable log is a permanent tax, and it applies to
a claim graph too.

---

## 5. Retraction cascades

Source: [Doyle (1979), *A Truth Maintenance System*](https://scispace.com/pdf/a-truth-maintenance-system-pim519w5js.pdf)
(*AI* 12:231–272); de Kleer's ATMS; AGM belief revision
([SEP](https://plato.stanford.edu/entries/logic-belief-revision/)).

If C was derived from A and B, and A is retracted, C is unsupported — but a plain graph never
recorded that C depended on A. Doyle's answer: record **justifications**, not just beliefs,
so retraction becomes mechanical. AGM supplies the uncomfortable theory: **contraction is
underdetermined.** There is no purely logical answer to which belief to drop; you must encode
a policy (source trust, recency, specificity) and own it.

**Our dodge:** store only claims extracted directly from a source passage, never conclusions
derived from other claims. Retraction can then never orphan a conclusion, because none exist.

---

## 6. HydraDB — the two surfaces

### Managed API (`api.hydradb.com`)

Verified against live calls, not just docs.

- **Auth:** `Authorization: Bearer <key>`, `API-Version: 2`. Every response is enveloped —
  read from `.data`, including from the SDKs.
- **Path:** create database (async, poll `/databases/status`) → `POST /context/ingest`
  (multipart, 202 = queued not indexed) → poll `/context/status` → `POST /query`.
- **Stop polling at `graph_creation`, not `completed`.** Chunks are searchable at
  `graph_creation`; only wait for `completed` if you need full graph context.
- **`document_metadata` must be a JSON array**, one entry per file. Only a fixed key set is
  accepted; custom fields nest inside `additional_metadata`. A fifth key returns 400 naming
  it.
- **`graph_payload`** is a JSON string keyed by source id, each value carrying an `entities`
  map (`name` required) and a `relations` array (`source`, `target`, `predicate`, optional
  `context` ≤2000 chars and `temporal_details`). Limits: ≤5,000 entities, ≤10,000 relations,
  ≤500 relations per entity.
- **It replaces LLM extraction for that source**, it does not augment it. The document is
  still chunked and embedded. Skipping extraction makes ingestion faster.
- **It survives re-ingestion:** re-ingesting without a payload re-applies the stored graph
  rather than falling back to extraction.
- **A linked relation is *sourced*, not *supported*.** Every supplied relation links to its
  best-matching chunk with no reject floor, so a weak match still links. Carry your own
  evidence passage rather than trusting the chunk association for citation.
- **`mode` defaults to `auto`** and silently overrides `graph_context` to match whichever
  pipeline it picks. Set it explicitly. Graph relations need `thinking`.
- **Silent no-ops:** `query_forceful_relations` outside thinking mode; `operator` unless
  `query_by: "text"`; undeclared `metadata_filters` keys at query time.
- **`alpha`** blends hybrid retrieval: 1.0 pure semantic, 0.0 pure BM25, default 0.8. Lower
  it for literal tokens (error codes, service names).
- **`recency_bias` defaults to 0.0** — recency does nothing unless you set it.
- **`max_results`** default 10, hard max 50.
- Response helper is `buildString` (TS) / `build_string` (Python). Two docs pages call it
  `buildContextString`; that name is not the SDK export.
- **Citations:** `chunk_id_to_group_ids[chunk_uuid]` → group ids → filter `chunk_relations`.
  Reading `chunk_relations` without that mapping attaches relations to the wrong chunks.
- A file document's title is always its filename and cannot be set at ingest.

### Open-source engine (`github.com/hydra-db/hydradb`)

Rust, AGPL-3.0. Object-store-native graph database with OpenCypher, Neo4j-compatible Bolt
5.x, and an HTTPS API. Container image published for arm64 — Bolt 7687, HTTP 8443, metrics
9090.

**Their Cypher is a restricted subset, rejected at parse time.** Confirmed from
`cypher-compat.md`:

- **No temporal features at all.** No `as_of`, no point-in-time, no versioning primitives.
- No unbounded variable-length traversal (`*`, `*1..`). Bounded depths only.
- **No `IS NULL`, `IN`, `CONTAINS` or `ENDS WITH` in `WHERE`.** Breaks the obvious
  formulation of "find the entity with no claim of type X".
- Also rejected: `RETURN *`, `min`/`max`, undirected patterns, `DISTINCT` aggregate args,
  multi-statement requests, `WITH` that aliases or filters.
- `EXPLAIN` is available via `explain_opencypher_rows` and rejects the same queries, so
  query shapes can be validated without touching data.

### Their published numbers (company-reported, not independently verified)

LongMemEval-S 90.79% overall with Gemini 3.0 Pro as reader and judge; knowledge update
97.43%; temporal reasoning 90.97%; multi-session 76.69%. BEAM 1M 82%. Zep published a
methodology rebuttal noting the comparison figures used different reader models.

Their benchmarks page describes facts as timestamped edges in an immutable ledger, answering
what was true, when it changed, and why. That behaviour is internal to their memory
ingestion — no API authors it, inspects it, or queries it.

---

## 7. Retrieval baselines worth knowing

- **Emergence reached 82.4% on LongMemEval** — oracle parity — with plain RAG plus two
  changes: match on individual *turns* but retrieve the whole *session* around them, ranked
  by NDCG after cross-encoder reranking; and prompt the reader for a short chain of thought.
  That beat Zep's temporal knowledge graph by 11 points.
  [Source](https://www.emergence.ai/blog/sota-on-longmemeval-with-rag).
- **Structured memory wins on preference, temporal and multi-session questions and *loses*
  on single-session-assistant** (94.6% full-context vs 80.4% Zep), because summarising into a
  graph discards the assistant's verbatim wording. Any aggressive compression shows this
  regression. Worth naming to judges as evidence you understood the trade.
- **Vendor numbers in this space are contested.** Mem0 self-reports 93–94% while an
  independent test put an earlier version at 49%. State your own methodology explicitly:
  reader model, judge model, dataset variant, cleaned or not.

---

## 8. Datasets

**EnterpriseRAG-Bench** (onyx-dot-app) — the Track 1 corpus, ~500K documents ("Redwood
Inference"), 500 gold questions. What the visible field is scoring against. **Our choice**,
because comparable numbers beat convenient ones.

**Salesforce HERB** ([HF](https://huggingface.co/datasets/Salesforce/HERB)) — Slack messages,
meeting transcripts, documents, URLs and pull requests across ~530 employee profiles; multi-hop
questions with ground truth; deliberate realistic noise; **both answerable and unanswerable
questions**, which gives an abstention demo a labelled ground truth. CC-BY-NC-4.0, research
use only, generated with GPT-4o. Kept as the fallback and as a source of labelled
unanswerables.

**LongMemEval** ([paper](https://arxiv.org/abs/2410.10813) ·
[cleaned data](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)) — not our
track, but the benchmark every memory claim in this space is measured against. 500 questions;
`longmemeval_s` is ~115k tokens over 30–40 sessions, 277 MB, MIT. Evidence turns are labelled
`has_answer: true`, so retrieval quality can be measured separately from reader quality.
Question types include `knowledge-update`, `temporal-reasoning`, and abstention variants
suffixed `_abs`.

---

## 9. Video index

Every video referenced anywhere in these docs, in one place. All URLs and durations were
confirmed against YouTube's own metadata. No timestamps: chapter extraction is blocked, so
where a topic needed a reference I picked talks that are wholly about it.

### Crash-course references (one per concept)

| Concept | Video | Length |
|---|---|---|
| Embeddings, and why similar ≠ relevant | [Navigating Neural Search: Avoiding Common Pitfalls](https://www.youtube.com/watch?v=PrBtxqARY9U) · Jo Kristian Bergum | 41:48 |
| Dense vs sparse, hybrid blending | [Learning to hybrid search](https://www.youtube.com/watch?v=TBbw2dob-As) · Roman Grebennikov | 46:17 |
| Rank fusion specifically | [Reciprocal Rank Fusion](https://www.youtube.com/watch?v=px4YBYrz0NU) · Philipp Krenn | 38:49 |
| Chunking | no standalone talk worth recommending; closest framing is the Kiela talk below | — |
| The RAG loop | [RAG Agents in Prod: 10 Lessons](https://www.youtube.com/watch?v=kPL-6-9MVyA) · Douwe Kiela | 16:56 |
| Reranking, and why it exists | [Omar Khattab on Late Interaction](https://www.youtube.com/watch?v=Z2TmdcylyEc) | 32:13 |
| Similar vs relevant vs true | [Stop Using RAG as Memory](https://www.youtube.com/watch?v=T5IMo5ntyhA) · Daniel Chalef | 7:01 |

### The 41-minute path

1. [Stop Using RAG as Memory](https://www.youtube.com/watch?v=T5IMo5ntyhA) · 7:01
2. [Temporal RAG: Graphiti, Neo4j and LangGraph](https://www.youtube.com/watch?v=nIM_NimxxRc) · 10:25
3. [Citation Needed: Provenance for LLM-Built Knowledge Graphs](https://www.youtube.com/watch?v=H7puB0RwJMM) · 20:54
4. [Atlas: HydraDB-Powered Enterprise Context and Ontology](https://www.youtube.com/watch?v=twhWXaFNGKk) · 2:25 — a rival's Track 1 demo

### The three-hour run

Adds, in order: [What is a Knowledge Graph?](https://www.youtube.com/watch?v=y7sXDpffzQQ) (IBM, 5:36) ·
[Slowly Changing Dimensions Explained](https://www.youtube.com/watch?v=sZFCYpojP4I) (10:06) ·
[GraphRAG: The Marriage of Knowledge Graphs and RAG](https://www.youtube.com/watch?v=knDDGYHnnSI) (Emil Eifrem, 19:14) ·
[Zep: A Temporal KG Architecture for Agent Memory](https://www.youtube.com/watch?v=NBZGieN8S6E) (41:39) ·
[The Value of Values](https://www.youtube.com/watch?v=-6BsiVyC1kM) (Rich Hickey, 31:43) ·
[Entity Resolution at Scale](https://www.youtube.com/watch?v=Vyco67swTSk) (Huon Wilson, 23:10).
Optional follow-on: [Build an AI Knowledge Graph with Graphiti + Neo4j](https://www.youtube.com/watch?v=H2Cb5wbcRzo) (24:04), which leaves you with running code.

### Knowledge graphs

- [Graph Databases: When to Use Them (And When to Run Away)](https://www.youtube.com/watch?v=7kXY-2fYdHI) · Hamel Husain · 33:57
- [Knowledge Graph or Vector Database… Which is Better?](https://www.youtube.com/watch?v=6vG_amAshTk) · Adam Lucek · 41:07
- [Extracting Knowledge Graphs From Text With GPT-4o](https://www.youtube.com/watch?v=O-T_6KOXML4) · Thu Vu · 23:40 — the step our pipeline lives or dies on
- [Property Graph vs Triple Store](https://www.youtube.com/watch?v=PEyW-MfxaEA) · 15:17 — matters when deciding where a date hangs on an edge

### GraphRAG, and its critics

- [GraphRAG methods for optimized context windows](https://www.youtube.com/watch?v=c5qJHr3DnT4) · Jonathan Larson, Microsoft · 15:08
- [I Was Wrong About GraphRAG: What Won in 2026](https://www.youtube.com/watch?v=rEITYxTJggU) · 10:47 — the critique to watch
- [Dispelling GraphRAG hype](https://www.youtube.com/watch?v=BEXEw6T4234) · 9:07 — the cost argument

### Agent memory

- [Mem0: Scalable Long-Term Memory](https://www.youtube.com/watch?v=EE4pvOEAjXc) · 13:31 — the counter-design: mutates in place where Zep retires
- [Architecting Agent Memory](https://www.youtube.com/watch?v=W2HVdB4Jbjs) · Richmond Alake, MongoDB · 17:36
- [Approaches for Managing Agent Memory](https://www.youtube.com/watch?v=3aS1A-0775s) · LangChain · 11:34 — inline vs background writes

### Time and immutability

- [The Incredible Power of XTDB and Bitemporal Data](https://www.youtube.com/watch?v=Mr4NQyK5PW4) · 3:00
- [Bitemporal Databases: What They Are and Why They Matter](https://www.youtube.com/watch?v=3sRKQg9-In8) · James Henderson · 56:43 — clearest valid-vs-transaction-time treatment
- [A Decade of DDD, CQRS, Event Sourcing](https://www.youtube.com/watch?v=LDW0QWie21s) · Greg Young · 48:03
- [Event Sourcing: The Bad Parts](https://www.youtube.com/watch?v=K4bj31fJGFk) · Greg Young · ~42 min — watch before committing to append-only
- [Deconstructing the Database](https://www.youtube.com/watch?v=Cym4TZwTCNU) · Rich Hickey · 1:06:23
- [Turning the database inside out](https://www.youtube.com/watch?v=fU9hR3kiOK0) · Martin Kleppmann · 47:42

### Entity resolution

- [Entity Resolution and Deduplication with Neo4j and GenAI](https://www.youtube.com/watch?v=GMTY78xqGXQ) · 50:00 — extraction producing duplicate nodes for one entity, exactly our failure mode
- [Rapid deduplication with Splink](https://www.youtube.com/watch?v=eQtFkI8f02U) · Robin Linacre · 27:24 — blocking rules, Fellegi-Sunter, training without labels

### Hallucination and refusal

- [Why Language Models Hallucinate](https://www.youtube.com/watch?v=0dRouBLcvMs) · Adam Kalai · 1:09:32 — hallucination as a scoring artifact; benchmarks reward guessing and punish "I don't know"
- [RAG Evaluation Is Broken](https://www.youtube.com/watch?v=Ywl4LsvHKzU) · 10:58 — measure groundedness separately from answer quality

### HydraDB itself

No official channel and no product demo exists. The founder interviews are the substance:

- [Why does AI Need Better Context](https://www.youtube.com/watch?v=J3bPJ9n77zo) · Nishkarsh Srivastava · 21:10 · published Aug 14, 2026
- [He Raised $6.5M With Three Words](https://www.youtube.com/watch?v=FEc9GBqHWHw) · Composio · 40:19 — densest on the ontology-vs-flat-vectors thesis
- [Meet My CEO & His Vision](https://www.youtube.com/watch?v=WDPjdIDe4Iw) · 20:16

Around fourteen community hackathon demos exist, 1–3 minutes each; the Atlas one above is
the Track 1 entry to watch.

---

## 10. The competing field (2026-08-16)

| Repo | Project | Approach |
|---|---|---|
| `dukemawex/atlas-hydra` | Atlas | Person/Project/Claim/Decision nodes; `SUPPORTS`/`CONTRADICTS`/`SUPERSEDES`; explicit `NOT_FOUND`. FastAPI UI, demo video shot, OSS engine as submodule. |
| `Shrujal00/glasshouse-hydradb` | Glasshouse | Identity resolution, contradiction arbitration, abstention. Uses both surfaces. Apache-2.0. |
| `PrathamS1/hydra-brain` | Company Brain | 7-stage pipeline; conflict layer with trust/recency; entity resolution via `algo.MSpaths`; EnterpriseRAG-Bench eval harness; Streamlit UI. |
| `gowthamchoudhary/Cortex-hq` | Cortex | Enterprise knowledge graph and temporal ontology layer. |
| `kgarg2468/hydradb-oss-hack` | Hindsight | Track 2A. Bitemporal time-travel, reportedly patched the engine itself. |

The primitives are table stakes. What remains defensible is correctness: stated-time ordering,
per-predicate cardinality, two clocks, and abstention as a coverage test rather than a prompt.
