# TubeLess para NotebookLM — desenho atual

Objetivo: encontrar vídeos públicos para um tema com buscas variadas em vários idiomas, avaliar relevância e enviar os escolhidos como fontes a um notebook pessoal do NotebookLM. O RAG fica no produto Google.

## Fluxo

1. O painel lateral recebe tema, idiomas e parâmetros. Geração e avaliação têm URL, chave, protocolo e modelo independentes; YouTube não exige chave por padrão.
2. Um modelo generativo compatível com OpenAI cria consultas por idioma dentro do limite configurado. Erro na expansão usa o tema original com aviso.
3. A extensão lê páginas públicas do YouTube ou consulta a API oficial opcional, deduplica IDs e verifica detalhes e legendas. Nenhum HTML recebido é executado.
4. Jev via Decisions/System One, ou um modelo Chat Completions, recebe tema, título, descrição completa, canal e data. Sua probabilidade de relevância decide o status e ordena os resultados. Falha ou resposta inválida nunca transforma vídeo em aprovado automaticamente.
5. O usuário revisa os resultados e escolhe fontes. A extensão exige uma aba de notebook pessoal já aberta e autenticada, cola os links em lote pela interface, confirma cada fonte e registra os itens pendentes. Retomar envia apenas os links restantes após a revisão das fontes incertas. O destino é validado antes da espera e novamente no content script; não usa endpoints privados do Google.

## Limites

A importação usa a interface da aba autenticada; mudanças no NotebookLM podem exigir atualização do adaptador DOM. O avaliador só recebe texto dos metadados. Vídeos importáveis precisam atender às regras do Google. A busca pública pode ser bloqueada por consentimento, controles de robôs ou mudanças de layout. Chaves ficam no armazenamento local do Chrome, nunca no código ou em logs. O .env é usado somente pelos testes locais e não entra no pacote.

## Verificação

Testes automatizados cobrem expansão, limites, deduplicação, contratos de avaliação, falhas parciais, legendas, ordenação e validação de URL. Chamadas reais e inspeção no Chrome foram executadas com as chaves autorizadas. Veja [verification.md](verification.md) para resultados e limites.
