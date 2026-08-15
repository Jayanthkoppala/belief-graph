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

**Salesforce HERB** (huggingface.co/datasets/Salesforce/HERB) is the working choice.
It fits the build unusually well:

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

## Non-goals

Not a chat product. Not a benchmark chase. Not a recruiting tool — HydraDB already ships
an AI recruiter cookbook, and following the tutorial is the opposite of the point.
