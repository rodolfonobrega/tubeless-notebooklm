# Independent connections and keyless search

Goal: configure search and evaluation with different providers, test the real calls in the panel, and search for videos without a server or a required YouTube key.

- [x] Configuration: independent URL, key, and model; OpenAI, Groq, DeepSeek, OpenRouter, and TypeSafe presets; migration of existing settings; URL validation and per-domain permissions.
- [x] Calls: Chat Completions for generation; Decisions, System One, or Chat Completions for evaluation; time limits, errors without credentials, and a real test per service.
- [x] YouTube: public search and detail reading in JavaScript; optional official API; cancellation, captions, and partial failures.
- [x] Interface: separate cards, restore the OpenAI URL, test results that use the values not yet saved, and simple messages.
- [x] Ordering: descending relevance in search and when restoring results; missing evaluations at the end.
- [x] LiteLLM catalog: models per provider/format, custom name, local copy, and refresh without credentials.
- [x] Selection: relevant videos pre-selected, clear selection, copying links, and persisted deselections.
- [x] Continuation: new terms, exclusion of already evaluated videos, merging by relevance, and preservation of the selection.
- [x] Import: names without icons, validation wait, dynamic Choice, cache of confirmed controls, queue paused on layout error, and review of uncertain sources.
- [x] Verification: tests of the contracts and migration, calls with the .env outside the extension, and browser inspection of the interface.
- [x] Distribution: ZIP with an explicit list of files; credentials and temporary profiles excluded.

Evidence and validation limits are in [verification.md](verification.md). Importing into a real Google account depends on an available signed-in session.

Decisions: the .env stays out of the distributed files and is not imported by the extension. Old settings with an OpenRouter key keep using the earlier endpoints. Custom URLs require permission only for the chosen domain. HTTP is allowed only on localhost/127.0.0.1. The evaluation model stays independent of the generator, and failures never approve a video automatically.
