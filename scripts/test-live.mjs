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
catch { console.error('Arquivo .env não encontrado. Use --env=caminho para selecionar outro arquivo.'); process.exit(1); }
const env = process.env;
const provider = process.argv.find(arg => arg.startsWith('--provider='))?.slice(11) || 'openai';
const useChat = process.argv.includes('--openai-evaluation');
let settings;
try { settings = settingsFromEnv(env, { provider, chatEvaluation: useChat }); }
catch { console.error('Configuração de teste inválida. Confira o provedor e as URLs no .env.'); process.exit(1); }
const evaluationKey = settings.evaluationApiKey;
console.log(`Geração: ${new URL(settings.llmBaseUrl).host}, modelo ${settings.expansionModel}`);
console.log(`Avaliação: ${useChat ? 'Chat Completions (teste com LLM)' : settings.evaluationProtocol}`);
const secrets = [settings.llmApiKey, settings.evaluationApiKey, settings.youtubeKey];
try {
  const results = await testConnections(settings, { onResult: result => {
    if (result.status === 'testing') return;
    if (result.id === 'evaluation' && !evaluationKey && !useChat) { console.log('Avaliação: NÃO TESTADA — configure EVALUATION_API_KEY no .env.'); return; }
    console.log(`${result.title}: ${result.status.toUpperCase()} — ${result.message} (${result.durationMs} ms)`);
  } });
  if (results.some(result => result.status === 'error' && !(result.id === 'evaluation' && !evaluationKey && !useChat))) process.exitCode = 1;
  if (process.argv.includes('--pipeline') && (evaluationKey || useChat)) {
    const result = await runDiscovery({ topic: 'energia solar residencial', settings: { ...settings, languageList: ['pt', 'en'] } });
    console.log(`Fluxo completo: ${result.terms.length} termos, ${result.discoveredCount} encontrados, ${result.videos.length} avaliados, ${result.videos.filter(video => video.status === 'approved').length} relevantes.`);
    if (result.videos.some(video => video.status === 'error')) process.exitCode = 1;
  }
} catch (error) { console.error(sanitizeError(error.message, secrets)); process.exitCode = 1; }
