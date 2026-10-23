# TubeLess for NotebookLM

**Turn a single topic into a full research library of YouTube videos, ranked by relevance and added to NotebookLM in one click.**

TubeLess is a Chrome extension that searches YouTube in several languages at once, scores every candidate against your topic, and sends the best ones straight into your NotebookLM notebook as sources. No server, no Python, no build step. It runs entirely in your browser.

NotebookLM is excellent at answering questions about sources. TubeLess finds the sources for you, so you spend your time on the research itself.

---

## Why TubeLess

- **Search in many languages at once.** TubeLess writes search terms in each language you pick (up to 20), so you reach videos a single-language search would miss.
- **Relevance, not guesswork.** Every candidate is scored by an AI evaluator against your topic. The list is sorted from most to least relevant, and the strong matches come pre-selected.
- **One click into NotebookLM.** Pick your videos, click **Add sources**, and TubeLess pastes the links into your notebook and confirms each source on the page.
- **Nothing gets lost.** Searches are saved in your local history. Interrupted imports can be resumed, and nothing is marked as added until NotebookLM confirms it.
- **Keep the models you want.** Use OpenAI, Groq, DeepSeek, OpenRouter, or any compatible service. Generation and evaluation use separate providers and keys.
- **Designed to save you money.** Connection tests skip checks that already passed, and TubeLess sets the right call format for each model automatically.
- **Private by design.** Your keys stay in your Chrome profile. There is no TubeLess server and no telemetry.

---

## What's new in 1.5.0

- **Full English interface.** Every label, message, and prompt is now in English.
- **OpenRouter model lists, built from OpenRouter itself.** Text models for search generation, decision models for video evaluation.
- **Automatic call format.** Pick a model from the list and TubeLess sets the right format (Decisions, System One, or Chat Completions). For a custom model name, **Test connections** finds the format that works.
- **Smarter connection tests.** A check that already passed is not run again unless its settings change, so tests cost nothing extra.
- **New default search model on OpenRouter:** `nvidia/nemotron-3-ultra-550b-a55b:free`.
- Fixed a settings-save error (`refreshNotebookTabs is not defined`).

---

## Install in 60 seconds

1. Download `TubeLess-1.5.0.zip` from the [latest release](https://github.com/rodolfonobrega/tubeless-notebooklm/releases/latest) and extract it to a permanent folder.
2. Open `chrome://extensions` in Google Chrome.
3. Turn on **Developer mode** and click **Load unpacked**.
4. Select the extracted folder that contains `manifest.json`.
5. Pin TubeLess to your toolbar and click it to open the side panel.

You can also clone this repository and load its root folder as an unpacked extension. No dependencies to install.

**Requires:** Google Chrome 116 or later.

**Updating:** replace the files in the same folder, reload the extension at `chrome://extensions`, and reload any open NotebookLM tabs. Your settings are kept.

---

## Quick start

1. Click the gear icon and fill in the **search generation** and **video evaluation** connections. Pick a provider and paste its key.
2. Click **Test connections**, then **Save**.
3. Type a topic, choose your languages, and click **Search**.
4. Review the ranked videos, open your notebook in Chrome, and click **Add sources**.

That's it. Your first search is ready in about a minute.

---

## Connections

Each connection has its own **base URL**, **key**, and **model**, so you can mix providers freely.

| Connection | Options |
| --- | --- |
| **Search generation** | OpenAI, Groq, DeepSeek, OpenRouter, or any service compatible with Chat Completions |
| **Video evaluation** | OpenRouter Decisions, TypeSafe System One, or Chat Completions |
| **YouTube** | Public search with no key (on by default), or the official YouTube Data API |

**Presets** fill in the address, model, and format for you. Defaults are OpenAI (`gpt-5-mini`) for generation and OpenRouter (`perplexity/pplx-decider-v1.1-27b`, Decisions format) for evaluation. On OpenRouter, the generation default is `nvidia/nemotron-3-ultra-550b-a55b:free`.

**Model lists** are loaded automatically. OpenRouter's list comes from its own models endpoint. Other providers use the LiteLLM catalog. Choosing a model from the list also sets its call format. You can still type any model name yourself.

**Test connections** runs one real call per service, so you know each part works before you search. It uses the values in the fields, even before you save. Any check that already passed and has unchanged settings is skipped, so repeat tests cost nothing. Failed checks are always retried. Model calls may use credits.

For Jev, choose **Decisions** on OpenRouter (`https://openrouter.ai/api/alpha`) or **System One** on TypeSafe (`https://api.typesafe.ai`). For OpenAI-compatible generative models, choose **Chat Completions**.

---

## Searching and adding sources

1. **Pick your languages** under the topic box. Keep between one and five. Custom codes you save in Settings also appear.
2. **Search.** TubeLess varies the terms for each language, searches YouTube, removes duplicates, and evaluates the candidates.
3. **Review.** Results are ranked from most to least relevant. Strong matches are pre-selected.
4. **Refine.** Deselect what you don't want, or use **Select all**. **Copy selected links** copies one URL per line, in relevance order.
5. **Keep going.** **Continue searching** adds new terms and new videos for the same topic. Your earlier choices are kept.
6. **Add to NotebookLM.** Open a notebook in Chrome, choose it as the destination, and click **Add sources**. TubeLess pastes the links in one batch and confirms each source on the page.

**Good to know:**

- NotebookLM's home page is not a valid destination. Open the notebook you want first.
- If a source can't be confirmed, the queue pauses and shows what to review. Check the notebook, then resume. Nothing is added twice.
- Up to **1,000 videos** can be evaluated per round, and **1 to 32** evaluations can run at the same time. Adjust both in Settings.

---

## Privacy and keys

- Keys are stored in `chrome.storage.local` in your Chrome profile. They are never sent to NotebookLM.
- Connection tests store only a SHA-256 hash of your keys to recognize unchanged settings. The keys themselves are not saved in that record.
- Your topic and video metadata go to the search and evaluation services you configured. Only the URLs you select are added to your notebook.
- The model catalog downloads without credentials, and no key is sent to it.
- TubeLess has no servers and no telemetry of its own.

Note that Chrome's local storage is not an encrypted vault.

---

## How it works

**Search.** Public YouTube search runs without an API key. The official YouTube API is available as an option if you prefer it.

**Evaluation.** The evaluator scores each video on its title, description, channel, date, and transcript when available. The score is a fast screening aid, not a guarantee of quality. Failed evaluations never approve a source.

**Adding sources.** TubeLess uses the controls on the NotebookLM page. If NotebookLM changes its layout, the evaluator can help locate the right control. Only the control's label and type are sent for that, never your notebook's content.

**Limits.** Public search depends on YouTube's pages. Bot checks, consent screens, or layout changes can stop a search, and TubeLess reports the reason clearly.

---

## Development and tests

TubeLess is plain JavaScript with no runtime dependencies.

Live tests use a `.env` file in the project folder. The scripts never print your keys. Copy `.env.example` and fill in the values you need.

```sh
npm test
npm run check
npm run package
```

```sh
npm run test:live -- --provider=openai
npm run test:live -- --provider=groq --pipeline
npm run test:live -- --provider=deepseek --openai-evaluation
npm run test:live -- --provider=openrouter
```

`--openai-evaluation` uses Chat Completions for evaluation with the generation connection. `--pipeline` runs real discovery and evaluation. `--env=path` selects another `.env` file.

Browser tests need Playwright and a Chrome that supports loading extensions over CDP:

```powershell
npm install --no-save --package-lock=false playwright
$env:SCOUT_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
npm run test:notebook
```

Set `SCOUT_PLAYWRIGHT_PATH` if Playwright lives in another folder. Live tests use your keys and may use credits. Unit tests and fixtures do not need keys.

**Where things live:** `core/providers.js` connects to the services. `core/youtube-web.js` reads public YouTube. `core/pipeline.js` runs the search. `core/models.js` manages model lists. `core/diagnostics.js` runs connection tests. `settings.js` drives the settings panel. `panel.*` is the side panel. `content/notebook.js` adds sources to NotebookLM. `core/notebook-worker.js` handles control lookups and caching.

The full verification log is in [docs/verification.md](docs/verification.md).
