/**
 * Hour-one feasibility spike. Run once HYDRA_DB_API_KEY is in .env:
 *   npm run spike
 *
 * This decides whether belief-graph is buildable. It tests the four assumptions the
 * whole design rests on, in order. Any failure is a design problem, not a bug.
 *
 *   1. graph_payload accepts a deterministic graph we author ourselves.
 *   2. Those injected relations come back through context.relations().
 *   3. Relations carry the provenance a belief history needs — timestamp,
 *      temporalDetails, confidence, and the verbatim evidence passage.
 *   4. Omitting the source id returns database-wide triplets with a cursor, so the
 *      graph can be materialised locally and walked multi-hop.
 *
 * Kill criterion: if (1) or (2) fails, the deterministic-graph approach is dead and the
 * build has to fall back to reading HydraDB's own extracted graph.
 */
import { HydraDBClient } from "@hydradb/sdk";

const token = process.env.HYDRA_DB_API_KEY;
if (!token) {
  console.error("HYDRA_DB_API_KEY missing — copy .env.example to .env and add your key.");
  process.exit(1);
}

const client = new HydraDBClient({ token });
const DATABASE = "belief-graph-spike";

// Two claims that contradict each other, plus the supersession edge between them.
// This is the shape the real pipeline will emit, in miniature.
const SOURCE_ID = "spike-doc-1";
const graphPayload = {
  [SOURCE_ID]: {
    entities: {
      acme_billing: { name: "Acme Billing Service", type: "service" },
      postgres: { name: "PostgreSQL", type: "technology" },
      dynamodb: { name: "DynamoDB", type: "technology" },
      claim_march: { name: "claim:billing-uses-postgres", type: "claim" },
      claim_june: { name: "claim:billing-uses-dynamodb", type: "claim" },
    },
    relations: [
      {
        source: "claim_march", target: "postgres", predicate: "asserts_datastore",
        context: "Billing runs on Postgres for now.", temporal_details: "stated 2026-03-04",
      },
      {
        source: "claim_june", target: "dynamodb", predicate: "asserts_datastore",
        context: "Billing migrated off Postgres to DynamoDB last sprint.",
        temporal_details: "stated 2026-06-19",
      },
      // The edge the whole product is about: the June claim retires the March one.
      {
        source: "claim_june", target: "claim_march", predicate: "supersedes",
        context: "Migration completed; the earlier datastore claim no longer holds.",
        temporal_details: "superseded 2026-06-19",
      },
      { source: "claim_march", target: "acme_billing", predicate: "about_entity" },
      { source: "claim_june", target: "acme_billing", predicate: "about_entity" },
    ],
  },
};

const text = `Acme Billing Service datastore history.
2026-03-04: Billing runs on Postgres for now.
2026-06-19: Billing migrated off Postgres to DynamoDB last sprint.`;

async function main() {
  console.log("1) ingest with an author-supplied graph_payload…");
  const file = new File([text], "billing-history.txt", { type: "text/plain" });
  const ingest = await client.context.ingest({
    database: DATABASE,
    type: "knowledge",
    documents: file,
    graphPayload: JSON.stringify(graphPayload),
    documentMetadata: JSON.stringify({ id: SOURCE_ID, spike: true }),
  });
  console.log(JSON.stringify(ingest, null, 2));

  // Graph building is a stage AFTER content becomes searchable — poll for it.
  console.log("2) poll status until graph_creation or completed…");
  for (let i = 0; i < 30; i++) {
    const status = await client.context.status({ database: DATABASE, id: SOURCE_ID });
    const s = JSON.stringify(status);
    console.log(`   ${i}: ${s.slice(0, 200)}`);
    if (/graph_creation|completed|errored/.test(s)) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }

  console.log("3) read relations back for this source…");
  const scoped = await client.context.relations({ database: DATABASE, id: SOURCE_ID });
  console.log(JSON.stringify(scoped, null, 2));

  console.log("4) read DATABASE-WIDE relations (id omitted) — multi-hop depends on this…");
  const all = await client.context.relations({ database: DATABASE, limit: 100 });
  console.log(JSON.stringify(all, null, 2));

  console.log("5) query, and check whether graph context comes back in thinking mode…");
  const answer = await client.query({
    database: DATABASE,
    query: "What datastore does the billing service use?",
    type: "knowledge",
    mode: "thinking",
    graphContext: true,
  });
  console.log(JSON.stringify(answer, null, 2));

  console.log(`
CHECKLIST — answer these from the output above:
  [ ] Did our 'supersedes' relation survive ingestion, with origin byog?
  [ ] Do returned relations carry temporalDetails, timestamp, confidence, context?
  [ ] Did the database-wide call return triplets plus a nextCursor?
  [ ] Did the query response include graph_context with query_paths?
If the first two are no, the deterministic-graph design is dead — reconsider before building.`);
}

main().catch((err) => {
  console.error("SPIKE FAILED:", err);
  process.exit(1);
});
