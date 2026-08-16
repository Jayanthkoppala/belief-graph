"""Build a scoped corpus subset from EnterpriseRAG-Bench.

The full benchmark is 511,962 documents. We ingest a deliberately scoped subset and say so
plainly, because the dataset's authors have published retrieval curves on the full corpus
and any number reported here is read against them.

The subset is built to keep the task honest rather than easy:

  - every gold document referenced by any of the 500 questions, so a missed answer is a
    real retrieval failure rather than an artefact of a document we never loaded
  - a distractor sample drawn from the same source-type distribution, because the published
    scaling work found that *similar* documents are what destroy recall, not volume

Nothing here is inferred from the questions at query time. The subset is fixed before any
question is asked.
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

DEFAULT_DISTRACTORS = 20_000


def load_questions(path: Path) -> pd.DataFrame:
    return pd.read_parquet(path)


def gold_doc_ids(questions: pd.DataFrame) -> set[str]:
    ids: set[str] = set()
    for row in questions.expected_doc_ids:
        ids.update(row)
    return ids


def build_subset(
    documents_path: Path,
    questions_path: Path,
    out_path: Path,
    n_distractors: int = DEFAULT_DISTRACTORS,
    seed: int = 17,
) -> dict:
    questions = load_questions(questions_path)
    gold = gold_doc_ids(questions)

    parquet = pq.ParquetFile(documents_path)
    rng = random.Random(seed)

    kept: list[dict] = []
    distractor_pool: list[dict] = []
    source_counts: Counter[str] = Counter()
    total_seen = 0

    # One streaming pass. Gold documents are always kept; everything else is reservoir
    # sampled so the distractor set is uniform over the corpus without holding 1.3 GB
    # in memory.
    for batch in parquet.iter_batches(batch_size=20_000):
        for doc in batch.to_pylist():
            total_seen += 1
            source_counts[doc["source_type"]] += 1
            if doc["doc_id"] in gold:
                kept.append(doc)
                continue
            if len(distractor_pool) < n_distractors:
                distractor_pool.append(doc)
            else:
                j = rng.randrange(total_seen)
                if j < n_distractors:
                    distractor_pool[j] = doc

    subset = kept + distractor_pool
    rng.shuffle(subset)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(subset).to_parquet(out_path, index=False)

    missing = sorted(gold - {d["doc_id"] for d in kept})
    manifest = {
        "corpus_documents_total": total_seen,
        "subset_documents": len(subset),
        "gold_documents_referenced": len(gold),
        "gold_documents_found": len(kept),
        "gold_documents_missing": missing,
        "distractors": len(distractor_pool),
        "distractor_seed": seed,
        "subset_source_mix": dict(Counter(d["source_type"] for d in subset).most_common()),
        "corpus_source_mix": dict(source_counts.most_common()),
        "questions": len(questions),
        "question_types": dict(questions.question_type.value_counts().to_dict()),
    }
    (out_path.parent / "subset_manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--documents", type=Path, required=True)
    ap.add_argument("--questions", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("data/subset.parquet"))
    ap.add_argument("--distractors", type=int, default=DEFAULT_DISTRACTORS)
    args = ap.parse_args()

    manifest = build_subset(args.documents, args.questions, args.out, args.distractors)
    print(json.dumps(manifest, indent=2)[:1200])
    if manifest["gold_documents_missing"]:
        print(f"\nWARNING: {len(manifest['gold_documents_missing'])} gold documents not found "
              "in the corpus — retrieval failures on those questions are not our fault.")


if __name__ == "__main__":
    main()
