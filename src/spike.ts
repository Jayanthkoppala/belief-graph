/**
 * Feasibility spike — run once an API key is in .env:
 *   npx tsx src/spike.ts
 *
 * Proves the three primitives packet-graph needs from HydraDB:
 *   1. ingest a candidate's approved context packet (documents + memories)
 *   2. query it with graph context
 *   3. scope retrieval to approved source ids only (the consent boundary)
 *
 * Kill criterion: if any of these three fails or behaves unpredictably,
 * we bail on the hackathon build.
 */
import { HydraDBClient } from "@hydradb/sdk";

const token = process.env.HYDRA_DB_API_KEY;
if (!token) {
  console.error("HYDRA_DB_API_KEY missing — copy .env.example to .env and add your key.");
  process.exit(1);
}

const client = new HydraDBClient({ token });
const DATABASE = "packet-graph-spike";

// A fake candidate's approved context packet. Approved evidence only —
// nothing here is scraped; in the real flow the candidate signs off on
// exactly this bundle before it is ingested.
const samplePacket = `
Candidate: Priya Sharma (fictional, spike data)
Claim: Built a real-time voice screening pipeline.
Evidence (approved): repo readme excerpt — "livekit room dispatch with
prefix-routed agents; STT via streaming websocket; p95 turn latency 800ms".
Coverage: supported.
Claim: Production Kubernetes experience.
Coverage: not assessed — candidate provided no evidence. This is neutral,
not negative.
`;

async function main() {
  console.log("1) ingest…");
  const file = new File([samplePacket], "priya-packet.txt", { type: "text/plain" });
  const ingest = await client.context.ingest({
    database: DATABASE,
    type: "knowledge",
    documents: file,
    documentMetadata: JSON.stringify({ candidate: "priya", packet: "v1", consent: "approved" }),
  });
  console.log(JSON.stringify(ingest, null, 2));

  console.log("2) query with graph context…");
  const answer = await client.query({
    database: DATABASE,
    query: "What evidence supports the candidate's real-time voice work?",
    type: "all",
    graphContext: true,
  });
  console.log(JSON.stringify(answer, null, 2));

  console.log("3) consent boundary: query scoped to a bogus source id (must return nothing)…");
  const scoped = await client.query({
    database: DATABASE,
    query: "What evidence supports the candidate's real-time voice work?",
    ids: ["nonexistent-source-id"],
  });
  console.log(JSON.stringify(scoped, null, 2));
}

main().catch((err) => {
  console.error("SPIKE FAILED:", err);
  process.exit(1);
});
