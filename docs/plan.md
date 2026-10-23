# Implementation plan

- [x] Pure contracts: configuration, multilingual queries, deduplicated videos, safe URLs, and Jev response parsing; test first.
- [x] Providers: configurable Chat Completions, Decisions/System One, and public/API YouTube; tests with controlled responses and partial errors.
- [x] Orchestrator: limits, progress, cancellation, relevance, and selection; tests.
- [x] NotebookLM integration: tab detection, batch import through the UI, individual confirmation, resuming, and error messages; validated on simulated pages, including 250 links and interruption during the send.
- [x] Side panel and visual identity, settings, results, and last-search persistence; visual inspection at panel width.
- [x] README with installation, keys, running, privacy, and limits; `npm test` and `npm run check`.

Update on 2026-10-02: real connections were tested with the authorized .env. YouTube search works without a key. The available browser requires a Google sign-in to check imports into a real notebook. Evidence is in [verification.md](verification.md); additional requirements are completed in [connections-plan.md](connections-plan.md).
