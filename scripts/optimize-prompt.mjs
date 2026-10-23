import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsFromEnv } from './env-settings.mjs';

const localEnv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(localEnv)) loadEnvFile(localEnv);

const settings = settingsFromEnv(process.env, { provider: 'openai' });

// The topics stay in Portuguese on purpose: they test conversational and technical input in another language.
const TEST_CASES = [
  {
    topic: 'eu quero aprender a usar o sketchup',
    description: 'Informal conversational learning intent',
    languages: ['pt', 'en']
  },
  {
    topic: 'curso sketchup',
    description: 'Short and direct term',
    languages: ['pt', 'en']
  },
  {
    topic: 'LLMs para engenharia reversa de software',
    description: 'Advanced technical topic (the user-reported failure case)',
    languages: ['pt', 'en']
  },
  {
    topic: 'como investir em fundos imobiliários do zero',
    description: 'Practical finance topic in natural language',
    languages: ['pt']
  }
];

// Baseline prompt (the one used in the code at the time)
function buildBaselinePrompt(topic, languages, termsPerLanguage, continuation = '') {
  return `YouTube search topic: ${JSON.stringify(topic)}. Generate ${termsPerLanguage} different queries for each language: ${languages.join(', ')}. Vary synonyms, angles, translation and technical terms without changing the topic.${continuation} Respond only with JSON: an object whose keys are language codes and whose values are arrays of strings. Do not add explanations.`;
}

// Candidate prompt 1: optimized with YouTube guidance
function buildCandidatePromptV1(topic, languages, termsPerLanguage, continuation = '') {
  return `You are an expert in YouTube video search and discovery.
The user wants to find the best videos about this topic: ${JSON.stringify(topic)}.

Your task is to generate ${termsPerLanguage} highly effective YouTube search terms for each language: ${languages.join(', ')}.

Essential YouTube guidelines:
1. How users and creators think: On YouTube, effective searches use direct, natural keywords (2 to 6 words). Do not use long academic phrases or paper titles.
2. Intent cleanup: Remove conversational noise ("I want to learn...", "how do I...", "show me videos of..."). Turn it into a real search intent (e.g. "I want to learn sketchup" -> "sketchup beginner tutorial", "sketchup step by step", "sketchup basic course").
3. Smart angle variation: For each language, generate terms with useful complementary approaches (e.g. tutorial/beginner, full course/step by step, practical tools/demonstration).
4. No unnecessary punctuation or operators: NEVER use colons (:), semicolons (;), quotation marks or dashes.
5. Native idiomatic adaptation: Generate authentic terms the way creators and viewers of that language really write on YouTube (e.g. in English, prefer "beginner tutorial", "crash course", "complete guide", "step by step").${continuation}

Respond ONLY with a JSON object where the keys are the language codes (${languages.join(', ')}) and the values are arrays with exactly ${termsPerLanguage} strings. Do not add any text outside the JSON.`;
}

// Candidate prompt V3: refined with guidance on search keywords, niches and no punctuation
function buildCandidatePromptV3(topic, languages, termsPerLanguage, continuation = '') {
  return `You are an expert in SEO and YouTube video search.
Convert the following research topic into highly optimized YouTube search terms.

Given topic: ${JSON.stringify(topic)}
Required languages: ${languages.join(', ')}
Terms per language: ${termsPerLanguage}

YOUTUBE OPTIMIZATION GUIDELINES:
1. KEYWORD FOCUS: On YouTube, users search with direct terms (3 to 6 words) that combine the core subject with high-value modifiers (e.g. "tutorial", "full course", "step by step", "from scratch", "practical guide", niche tools).
2. REMOVE CONVERSATIONAL NOISE: Remove first-person phrases or conversational questions ("I want to learn how to...", "how do I...", "I'd like to see videos of..."). Extract the subject and the technical intent.
3. NO ARTICLE OR PAPER FORMAT: Never use long academic phrases or scientific paper titles (e.g. avoid "LLM-powered software reverse engineering: tools, libraries, and models").
4. ZERO PUNCTUATION: Do not use colons (:), dashes (- or —), quotation marks, periods or semicolons. Only words separated by spaces.
5. COMPLEMENTARY ANGLES: Generate varied terms across:
   - Angle 1: Introduction / full course / beginner tutorial from scratch
   - Angle 2: Practical application / step by step / real examples
   - Angle 3: Niche tools / intermediate or advanced techniques
6. IDIOMATIC NATURALNESS: Use terms the way native speakers of each language search on YouTube (e.g. in English: "beginner tutorial", "full course", "hands on guide", "step by step"; in Portuguese: "curso completo", "tutorial iniciante", "passo a passo").${continuation}

Return EXCLUSIVELY a valid JSON object in this format:
{
  ${languages.map(l => `"${l}": ["term 1", "term 2"]`).join(',\n  ')}
}
No markdown blocks, no explanations.`;
}

async function callLlm(prompt) {
  const url = `${settings.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.llmApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.expansionModel,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 4096
    })
  });
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean);
}

// LLM judge that scores the quality of the terms for YouTube
async function judgeTerms(topic, baselineTerms, candidateTerms) {
  const prompt = `You are a senior critical evaluator specialized in SEO and YouTube search algorithms.

Original topic provided by the user: "${topic}"

Set A (current baseline):
${JSON.stringify(baselineTerms, null, 2)}

Set B (optimized candidate V3):
${JSON.stringify(candidateTerms, null, 2)}

Judging criteria (0 to 10 for each set):
1. YouTube effectiveness: Do the terms match real search terms that viewers use and that return the best videos (rather than long academic phrases with ":" or paper titles)?
2. Intent handling: Did it convert conversational expressions ("I want to learn how to...") into effective keywords?
3. Angle variety: Do the terms cover complementary angles (beginner, course, tools, practical) without redundancy?
4. Language and conciseness: Concise terms (3-6 words), no bad punctuation (: ; " etc.) and idiomatic for each language.

Respond in JSON format:
{
  "scoreA": <number 0 to 10>,
  "scoreB": <number 0 to 10>,
  "critiqueA": "<brief analysis of set A>",
  "critiqueB": "<brief analysis of set B>",
  "winner": "A" or "B",
  "reason": "<why the winner is better for YouTube>"
}`;

  const url = `${settings.llmBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.llmApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.expansionModel,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 4096
    })
  });
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean);
}

async function runOptimization() {
  console.log('=== STARTING YOUTUBE PROMPT OPTIMIZATION ===\n');
  console.log(`Model: ${settings.expansionModel} (${settings.llmBaseUrl})\n`);

  for (const testCase of TEST_CASES) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`TEST: "${testCase.topic}" (${testCase.description})`);
    console.log(`Languages: ${testCase.languages.join(', ')}`);
    console.log(`------------------------------------------------------------`);

    const promptBase = buildBaselinePrompt(testCase.topic, testCase.languages, 3);
    const promptCand = buildCandidatePromptV3(testCase.topic, testCase.languages, 3);

    console.log('Calling the LLM with the baseline prompt...');
    const resultBase = await callLlm(promptBase);
    console.log('Baseline generated:', JSON.stringify(resultBase, null, 2));

    console.log('\nCalling the LLM with the V3 candidate prompt...');
    const resultCand = await callLlm(promptCand);
    console.log('V3 candidate generated:', JSON.stringify(resultCand, null, 2));

    console.log('\nLLM judge evaluating both results...');
    const evaluation = await judgeTerms(testCase.topic, resultBase, resultCand);
    console.log(`Winner: Set ${evaluation.winner}`);
    console.log(`Baseline score: ${evaluation.scoreA}/10 | Candidate V3 score: ${evaluation.scoreB}/10`);
    console.log(`Analysis: ${evaluation.reason}`);
    console.log(`Baseline critique: ${evaluation.critiqueA}`);
    console.log(`Candidate critique: ${evaluation.critiqueB}`);
  }

  console.log('\n=== PROMPT OPTIMIZATION COMPLETE ===\n');
}

runOptimization().catch(console.error);
