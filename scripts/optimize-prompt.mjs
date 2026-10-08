import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settingsFromEnv } from './env-settings.mjs';

const localEnv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(localEnv)) loadEnvFile(localEnv);

const settings = settingsFromEnv(process.env, { provider: 'openai' });

const TEST_CASES = [
  {
    topic: 'eu quero aprender a usar o sketchup',
    description: 'Intenção conversacional informal de aprendizado',
    languages: ['pt', 'en']
  },
  {
    topic: 'curso sketchup',
    description: 'Termo curto e direto',
    languages: ['pt', 'en']
  },
  {
    topic: 'LLMs para engenharia reversa de software',
    description: 'Tópico técnico avançado (caso do erro do usuário)',
    languages: ['pt', 'en']
  },
  {
    topic: 'como investir em fundos imobiliários do zero',
    description: 'Finanças/prático em linguagem natural',
    languages: ['pt']
  }
];

// Baseline prompt (atual no código)
function buildBaselinePrompt(topic, languages, termsPerLanguage, continuation = '') {
  return `Tema de pesquisa no YouTube: ${JSON.stringify(topic)}. Gere ${termsPerLanguage} consultas diferentes para cada idioma: ${languages.join(', ')}. Varie sinônimos, ângulos, tradução e termos técnicos sem mudar o tema.${continuation} Responda apenas JSON: um objeto cujas chaves são códigos de idioma e cujos valores são arrays de strings. Não acrescente explicações.`;
}

// Prompt Candidato 1: Otimizado com orientações para YouTube
function buildCandidatePromptV1(topic, languages, termsPerLanguage, continuation = '') {
  return `Você é um especialista em busca e descoberta de vídeos no YouTube.
O usuário quer encontrar os melhores vídeos sobre o tema: ${JSON.stringify(topic)}.

Sua tarefa é gerar ${termsPerLanguage} termos de pesquisa altamente eficazes no YouTube para cada idioma: ${languages.join(', ')}.

Diretrizes essenciais para o YouTube:
1. Como usuários e criadores pensam: No YouTube, buscas eficazes usam palavras-chave diretas e naturais (2 a 6 palavras). Não use frases longas de artigo acadêmico nem títulos de papers.
2. Limpeza de intenção: Remova ruídos conversacionais ("eu quero aprender...", "como faço para...", "me mostre vídeos de..."). Transforme em intenção real de busca (ex: "eu quero aprender sketchup" -> "sketchup tutorial iniciante", "sketchup passo a passo", "sketchup curso basico").
3. Variação inteligente de ângulos: Para cada idioma, gere termos com abordagens complementares úteis (ex: tutorial/iniciante, curso completo/passo a passo, ferramentas práticas/demonstração).
4. Sem pontuação ou operadores desnecessários: NUNCA use dois pontos (:), ponto e vírgula (;), aspas ou travessões.
5. Adaptação idiomática nativa: Gere termos idiomáticos autênticos como criadores e espectadores daquele idioma realmente escrevem no YouTube (ex: em inglês, prefira "beginner tutorial", "crash course", "complete guide", "step by step").${continuation}

Responda APENAS um objeto JSON onde as chaves são os códigos de idioma (${languages.join(', ')}) e os valores são arrays com exatamente ${termsPerLanguage} strings. Não acrescente nenhum texto fora do JSON.`;
}

// Prompt Candidato V3: Refinado com orientação para keywords de busca, nichos e sem pontuação
function buildCandidatePromptV3(topic, languages, termsPerLanguage, continuation = '') {
  return `Você é um especialista em SEO e busca de vídeos no YouTube.
Converta o seguinte tema de pesquisa em termos de busca altamente otimizados para o YouTube.

Tema informado: ${JSON.stringify(topic)}
Idiomas requeridos: ${languages.join(', ')}
Termos por idioma: ${termsPerLanguage}

DIRETRIZES DE OTIMIZAÇÃO PARA O YOUTUBE:
1. FOCO EM PALAVRAS-CHAVE: No YouTube, usuários pesquisam usando termos diretos (3 a 6 palavras) que combinam o assunto central com modificadores de alto valor (ex.: "tutorial", "curso completo", "passo a passo", "do zero", "guia pratico", ferramentas do nicho).
2. REMOVA RUÍDO CONVERSACIONAL: Elimine frases em primeira pessoa ou perguntas conversacionais ("eu quero aprender a...", "como faço para...", "queria ver vídeos de..."). Extraia o assunto e a intenção técnica.
3. PROIBIDO FORMATO DE ARTIGO/PAPER: Nunca use frases longas acadêmicas nem títulos de papers científicos (ex.: evite "LLM-powered software reverse engineering: tools, libraries, and models").
4. ZERO PONTUAÇÃO: Não use dois pontos (:), travessão (- ou —), aspas, ponto final ou ponto e vírgula. Apenas palavras separadas por espaço.
5. ÂNGULOS COMPLEMENTARES: Gere termos variados entre:
   - Ângulo 1: Introdução / curso completo / tutorial iniciante do zero
   - Ângulo 2: Aplicação prática / passo a passo / exemplos reais
   - Ângulo 3: Ferramentas do nicho / técnicas intermediárias ou avançadas
6. NATURALIDADE IDIOMÁTICA: Use termos como nativos daquele idioma pesquisam no YouTube (ex.: em inglês: "beginner tutorial", "full course", "hands on guide", "step by step"; em português: "curso completo", "tutorial iniciante", "passo a passo").${continuation}

Retorne EXCLUSIVAMENTE um objeto JSON válido no formato:
{
  ${languages.map(l => `"${l}": ["termo 1", "termo 2"]`).join(',\n  ')}
}
Sem blocos de markdown, sem explicações.`;
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

// Juiz LLM para avaliar a qualidade dos termos para o YouTube
async function judgeTerms(topic, baselineTerms, candidateTerms) {
  const prompt = `Você é um avaliador crítico sênior especializado em SEO e algoritmos de busca do YouTube.

Tema original fornecido pelo usuário: "${topic}"

Conjunto A (Baseline atual):
${JSON.stringify(baselineTerms, null, 2)}

Conjunto B (Candidato Otimizado V3):
${JSON.stringify(candidateTerms, null, 2)}

Critérios de julgamento (0 a 10 para cada conjunto):
1. Eficácia no YouTube: Os termos correspondem a termos de busca reais que espectadores usam e que retornam os melhores vídeos (em vez de frases acadêmicas longas com ":" ou papers)?
2. Tratamento da intenção: Converteu expressões conversacionais ("eu quero aprender a...") em palavras-chave eficazes?
3. Variabilidade de ângulos: Os termos cobrem ângulos complementares (iniciante, curso, ferramentas, prático) sem redundância?
4. Linguagem e concisão: Termos concisos (3-6 palavras), sem pontuações ruins (: ; " etc.) e idiomáticos para cada idioma.

Responda em formato JSON:
{
  "scoreA": <número 0 a 10>,
  "scoreB": <número 0 a 10>,
  "critiqueA": "<breve análise do conjunto A>",
  "critiqueB": "<breve análise do conjunto B>",
  "winner": "A" ou "B",
  "reason": "<por que o vencedor é melhor para o YouTube>"
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
  console.log('=== INICIANDO TRABALHO DE PROMPT OPTIMIZATION PARA O YOUTUBE ===\n');
  console.log(`Modelo: ${settings.expansionModel} (${settings.llmBaseUrl})\n`);

  for (const testCase of TEST_CASES) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`TESTE: "${testCase.topic}" (${testCase.description})`);
    console.log(`Idiomas: ${testCase.languages.join(', ')}`);
    console.log(`------------------------------------------------------------`);

    const promptBase = buildBaselinePrompt(testCase.topic, testCase.languages, 3);
    const promptCand = buildCandidatePromptV3(testCase.topic, testCase.languages, 3);

    console.log('Chamando LLM com prompt Baseline...');
    const resultBase = await callLlm(promptBase);
    console.log('Baseline gerou:', JSON.stringify(resultBase, null, 2));

    console.log('\nChamando LLM com prompt Candidato V3...');
    const resultCand = await callLlm(promptCand);
    console.log('Candidato V3 gerou:', JSON.stringify(resultCand, null, 2));

    console.log('\nJuiz LLM avaliando os dois resultados...');
    const evaluation = await judgeTerms(testCase.topic, resultBase, resultCand);
    console.log(`Vencedor: Conjunto ${evaluation.winner}`);
    console.log(`Nota Baseline: ${evaluation.scoreA}/10 | Nota Candidato V2: ${evaluation.scoreB}/10`);
    console.log(`Análise: ${evaluation.reason}`);
    console.log(`Crítica Baseline: ${evaluation.critiqueA}`);
    console.log(`Crítica Candidato: ${evaluation.critiqueB}`);
  }

  console.log('\n=== PROMPT OPTIMIZATION CONCLUÍDO ===\n');
}

runOptimization().catch(console.error);
