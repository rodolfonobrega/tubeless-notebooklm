import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsFromEnv } from './env-settings.mjs';
import { testConnections } from '../core/diagnostics.js';
import { runDiscovery } from '../core/pipeline.js';
import { sanitizeError } from '../core/connections.js';

const localEnv = fileURLToPath(new URL('../.env', import.meta.url));
const envPath = process.argv.find(arg => arg.startsWith('--env='))?.slice(6) || (existsSync(localEnv) ? localEnv : fileURLToPath(new URL('../../.env', import.meta.url)));
try { loadEnvFile(envPath); }
catch { console.error('.env file not found. Use --env=path to select another file.'); process.exit(1); }
const env = process.env;
const provider = process.argv.find(arg => arg.startsWith('--provider='))?.slice(11) || 'openai';
const useChat = process.argv.includes('--openai-evaluation');
let settings;
try { settings = settingsFromEnv(env, { provider, chatEvaluation: useChat }); }
catch { console.error('Invalid test configuration. Check the provider and URLs in .env.'); process.exit(1); }
const evaluationKey = settings.evaluationApiKey;
console.log(`Generation: ${new URL(settings.llmBaseUrl).host}, model ${settings.expansionModel}`);
console.log(`Evaluation: ${useChat ? 'Chat Completions (LLM test)' : settings.evaluationProtocol}`);
const secrets = [settings.llmApiKey, settings.evaluationApiKey, settings.youtubeKey];
try {
  const results = await testConnections(settings, { onResult: result => {
    if (result.status === 'testing') return;
    if (result.id === 'evaluation' && !evaluationKey && !useChat) { console.log('Evaluation: NOT TESTED — set EVALUATION_API_KEY in .env.'); return; }
    console.log(`${result.title}: ${result.status.toUpperCase()} — ${result.message} (${result.durationMs} ms)`);
  } });
  if (results.some(result => result.status === 'error' && !(result.id === 'evaluation' && !evaluationKey && !useChat))) process.exitCode = 1;
  if (process.argv.includes('--pipeline') && (evaluationKey || useChat)) {
    const result = await runDiscovery({ topic: 'energia solar residencial', settings: { ...settings, languageList: ['pt', 'en'] } });
    console.log(`Fluxo completo: ${result.terms.length} termos, ${result.discoveredCount} encontrados, ${result.videos.length} avaliados, ${result.videos.filter(video => video.status === 'approved').length} relevantes.`);
    if (result.videos.some(video => video.status === 'error')) process.exitCode = 1;
  }
} catch (error) { console.error(sanitizeError(error.message, secrets)); process.exitCode = 1; }
