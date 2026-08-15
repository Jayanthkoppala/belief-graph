# packet-graph

**Consent-scoped context packets for hiring agents, stored and retrieved as a graph.**

Built for [Hack Hydra](https://hackhydra.hydradb.com) (Aug 12–20, 2026) — tracks:
enterprise context & ontology building, memory & context retrieval for AI agents.

## The idea

Hiring agents answer questions about candidates today by scraping whatever they can
find. `packet-graph` flips the control: a candidate approves an explicit **context
packet** — a typed bundle of evidence about their skills and work — and that packet is
the *only* thing an agent may retrieve from. Powered by [HydraDB](https://hydradb.com)
as the context graph and retrieval layer.

Core rules the demo enforces:

- Evidence the candidate didn't approve does not exist to the agent.
- A missing claim is **not assessed** — never a negative signal.
- No overall score, ranking, or advance/reject recommendation. The agent retrieves
  and cites evidence; humans decide.

## Status

Hackathon scaffold — work started 2026-08-15. See commits for history.

## Stack

- TypeScript / Node
- [`@hydradb/sdk`](https://docs.hydradb.com) — context graph, memory/knowledge retrieval

## License

MIT
