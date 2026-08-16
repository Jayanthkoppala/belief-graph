# Build plan

Four days. Solo. The goal is a working end-to-end product with one measured result, not a
large system.

## The angle

Every system in this track treats "I don't know" as one outcome. There are two, and they
mean opposite things:

- **Genuine absence** — no claim in the corpus covers this. A fact about the company.
- **Retrieval failure** — the corpus contains it and we did not surface it. A fact about us.

This is not academic. On this corpus, published vector recall@10 falls to 41% at full scale,
so most "not found" answers from a similarity-ranked system are retrieval failures wearing
the language of absence.

belief-graph separates them, and reports **calibrated absence**: when it claims nothing
covers a question, how often is that true? The benchmark makes this measurable — 20 questions
where absence is ground truth, 480 where the answer exists.

## What gets built

```
ingest ──► retrieve ──► extract claims ──► resolve conflicts ──► answer or abstain
```

1. **Ingest** a scoped subset into HydraDB's managed API (hybrid retrieval). Cheap: chunk and
   embed only. No LLM at index time.
2. **Retrieve** with per-query alpha (identifier-shaped queries run nearer 0.3–0.5).
3. **Extract claims** from the retrieved neighbourhood only — entity, predicate, value,
   stated_at, source, evidence sentence.
4. **Resolve conflicts** and write the claim graph to the OSS engine. Only single-valued
   predicates may be superseded. Order by stated time.
5. **Answer** in three parts, or abstain — with the abstention split into *absent* versus
   *low coverage*.

## The measurement

Run the benchmark's 500 questions against our system and against a plain-RAG baseline on the
same scoped corpus, judged the same way. Report per category.

The two categories that matter: **Conflicting Info** (20) and **Info Not Found** (20).
Scoring multiplies correctness by completeness, so guessing on an unanswerable scores zero
and abstaining is free.

Then the number nobody else will have:

```
  absence precision  = (claimed absent AND genuinely absent) / (claimed absent)
  absence recall     = (claimed absent AND genuinely absent) / (genuinely absent)
```

Ground truth for the denominator is the 20 Info Not Found questions.

## Order of work

| Day | Work | Done when |
|---|---|---|
| 1 | Corpus subset chosen and ingested; retrieval returns sane results; baseline runs end to end | baseline produces 500 answers |
| 2 | Claim extraction + conflict detection + graph writes | a supersession chain exists in the engine from real corpus text |
| 3 | Answer path with the three-part output and split abstention; eval harness | our system produces 500 answers and a scored table |
| 4 | README, demo video, submission | links opened and verified by hand |

Cut in this order if time runs short: entity resolution beyond exact match, the visual
interface, corpus size. Do not cut: the split abstention, the baseline comparison, the video.

## Honest scoping

The corpus is a subset. Retrieval curves for the full 510k corpus are published by the
dataset's authors, so any number we report is read against a known baseline. A small honest
measurement beats a large vague one.

## Risks

| Risk | Mitigation |
|---|---|
| Claim extraction quality dominates results | Extract over retrieved neighbourhoods only; evidence sentence is copied, not generated, so errors are visible |
| 500 questions × LLM cost | Scope the corpus; cache aggressively; run the full set once, not repeatedly |
| Engine write throughput unknown | Batch under the 1024-row `UNWIND` cap; measure early |
| Judge disagreement | Use the benchmark's own scoring shape; report method explicitly |
