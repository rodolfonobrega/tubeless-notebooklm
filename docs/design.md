# TubeLess for NotebookLM — current design

Goal: find public videos for a topic using varied searches in several languages, score their relevance, and send the chosen ones as sources to a personal NotebookLM notebook. RAG stays in the Google product.

## Flow

1. The side panel receives the topic, languages, and parameters. Generation and evaluation each have their own URL, key, protocol, and model; YouTube needs no key by default.
2. A generative model compatible with OpenAI creates queries per language within the configured limit. A failure in expansion falls back to the original topic with a warning.
3. The extension reads public YouTube pages or calls the optional official API, deduplicates IDs, and checks details and captions. No received HTML is executed.
4. Jev through Decisions/System One, or a Chat Completions model, receives the topic, title, full description, channel, and date. Its relevance probability sets the status and sorts the results. A failure or invalid response never automatically turns a video into an approved one.
5. The user reviews the results and picks sources. The extension requires a personal, signed-in notebook tab to be open, pastes the links in a batch through the interface, confirms each source, and records pending items. Resuming sends only the remaining links after the uncertain sources are reviewed. The destination is validated before waiting and again in the content script; no private Google endpoints are used.

## Limits

Import uses the interface of the signed-in tab; changes in NotebookLM may require updating the DOM adapter. The evaluator only receives metadata text. Videos that can be imported must meet Google's rules. Public search can be blocked by consent pages, bot checks, or layout changes. Keys stay in Chrome's local storage, never in code or logs. The .env file is used only by local tests and is not part of the package.

## Verification

Automated tests cover query expansion, limits, deduplication, evaluation contracts, partial failures, captions, ordering, and URL validation. Real calls and Chrome inspection were run with the authorized keys. See [verification.md](verification.md) for results and limits.
