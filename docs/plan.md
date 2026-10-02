# Plano de implementação

- [x] Contratos puros: configuração, consultas multilíngues, vídeos deduplicados, URLs seguras e interpretação da resposta Jev; teste primeiro.
- [x] Provedores: Chat Completions configurável, Decisions/System One e YouTube público/API; testes com respostas controladas e erros parciais.
- [x] Orquestrador: limites, progresso, cancelamento, relevância e seleção; testes.
- [x] Integração NotebookLM: detecção da aba, importação em lote por UI, confirmação individual, retomada e mensagens de erro; validada em páginas simuladas, incluindo 250 links e interrupção durante o envio.
- [x] Painel lateral e identidade visual, configurações, resultados e persistência da última pesquisa; inspeção visual em largura de painel.
- [x] README com instalação, chaves, execução, privacidade e limites; `npm test` e `npm run check`.

Atualização em 02/10/2026: conexões reais foram testadas com o .env autorizado. A busca YouTube funciona sem chave. O navegador disponível exige login do Google para conferir a importação em notebook real. Evidências em [verification.md](verification.md); requisitos adicionais concluídos em [connections-plan.md](connections-plan.md).
