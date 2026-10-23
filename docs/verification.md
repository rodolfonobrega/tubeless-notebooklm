# Verification log

Date: 2026-10-02. Extension 1.3.0. Chrome 154.0.8037.93 on Windows. The live call logs below were run on version 1.2.0; the later versions add quick languages, evaluation of up to 250 videos with adjustable parallelism, and batch import. The current version was verified again with unit tests, validation, and the browser flow with controlled responses.

## Executed

| Check | Result |
| --- | --- |
| `npm test` | 86 tests passed; none skipped |
| `npm run check` | Syntax passed and 9 manifest references found |
| Panel loaded as a real extension in Chrome | Independent presets, URL restoration, and key clearing when switching domains approved |
| Connections button | Generation, evaluation, and YouTube approved; unsaved values do not change persisted settings |
| Cancellation | Interrupted calls and re-enabled fields |
| Quick languages | Selection in the form, persistence when reopened, sync with Settings, custom languages, and one-to-five limits approved; Spanish search and English continuation sent the respective languages to the generator and to YouTube |
| 250-video evaluation | Pipeline with controlled responses evaluated 250 of 260 candidates, kept individual errors, ordering, and progress from 0 to 250 |
| Adjustable parallelism | Tests measured peaks of 1, 8, and 16 evaluations running at once; a missing setting uses 8; cancellation stopped the eight active calls without starting pending videos |
| Limits in Chrome | Fields accept 250 videos and 16 simultaneous calls, reject higher values, and keep saved values when reopened |
| Relevance | Order 97%, 80%, 20% confirmed in the search; order kept when restoring saved results |
| Selection and copy | Relevant ones pre-selected, clear selection, persisted selection, and copied text to the clipboard confirmed |
| Continue searching in Chrome | New results merged without duplicates; earlier deselections kept and the new relevant one selected |
| Real LiteLLM catalog | Download in the extension and filters by provider/format approved; refresh does not replace a custom name; local copy works offline |
| Required destination | NotebookLM home page is not treated as a notebook; with no notebook open, there is a warning and an error, without creating a tab or queue, even with a configured link |
| Batch import | Real panel and content script confirmed three sources in a single send; an additional fixture confirmed 250 links pasted once |
| Separators and form choice | Text area receives line breaks; single-line field receives spaces; Websites/Links is preferred when the YouTube option also appears |
| Partial batch | One confirmed item was kept; two items required individual review; Resume sent only the two remaining and did not duplicate the earlier source |
| Interruption and persistence | Reloading the panel during the send preserved three uncertain items; even after reloading the notebook, resuming stayed blocked until explicit review, with no new submission |
| Closed or changed destination | A queue with a closed destination did not open another tab or use another available notebook; an A→B change during preparation did not send sources to B; the content script rejected an incompatible notebookUrl |
| Confirmation and duplicates | Sources with accessible labels and no href are confirmed and remembered on the same page; equivalent titles with HTML entities do not confirm two sources from the appearance of only one |
| Integrated dynamic location | Messages content → worker → simulated Choice provider → content confirmed three sources in a single batch; there was only one model call |
| Real Jev Choice | Real call with the Cancel/Insert source candidates returned the correct ID |
| Notebook fixtures | Fifteen scenarios passed, including a batch of 250 URLs, partial input, resuming, incompatible destination, separators, ambiguous titles, and the seven earlier location/privacy scenarios |
| Real connections in the extension context | OpenRouter Chat Completions, Jev Decisions, and public YouTube approved |
| Real generation in Node | OpenAI `gpt-5-mini`, Groq `openai/gpt-oss-120b`, DeepSeek `deepseek-chat`, and OpenRouter `google/gemini-2.5-flash` approved |
| Real flow in Node | Multilingual generation, public search, details, and evaluation completed with Groq + Jev/OpenRouter and with DeepSeek for both calls; a real continuation generated two new terms, evaluated two new videos, and ended with four without duplicates |
| Review fixes | Regressions cover keys paired with their endpoint and the caption filter in official mode |
| Independent review of the fixes | Findings about private titles and the worker deadline fixed and rechecked; no pending findings. The worker uses a 25-second deadline |
| Independent review of the batch | Target race, title normalization, and persistence before sending fixed and rechecked; no pending high or medium findings |
| Panel layout | The last card stays accessible above the fixed selection panel |

The .env keys were loaded by code and not printed. The Chrome tests use an isolated temporary profile and remove their settings when finished. Local captures are kept in `.test-artifacts/`, outside the distribution.

## Concrete limits

- **New batch import not yet validated on an authenticated account:** the user confirmed individual insertion in the previous version. In this session, the available browser opened the Google sign-in screen; the new tests use simulated pages and do not prove the batch is compatible with the current account DOM.
- TypeSafe direct and the official YouTube Data API were verified through contracts and controlled responses; there were no keys for these services in the .env used.
- Other models and custom endpoints must go through the **Test connections** button with your configuration. Generic compatibility does not guarantee access to any model.
- Public search depends on YouTube's pages; it does not eliminate bot blocks or layout changes. Evaluation considers metadata, not the audiovisual content.

## Distribution

`npm run package` generates `dist/TubeLess-1.3.0.zip` with an explicit list of files. The package contains the extension, the compact copy of the catalog, the license, and usage instructions; it excludes .env, tests, development scripts, and browser profiles. Installation is by extraction and **Load unpacked** in `chrome://extensions`. The ZIP was opened by an independent reader, its files compared with the originals, and the values of the four keys verified as absent.
