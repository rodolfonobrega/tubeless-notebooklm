# Conexões independentes e busca sem chave

Objetivo: configurar busca e avaliação com provedores diferentes, testar as chamadas reais no painel e pesquisar vídeos sem servidor nem chave YouTube obrigatória.

- [x] Configuração: URL, chave e modelo independentes; presets OpenAI, Groq, DeepSeek, OpenRouter e TypeSafe; migração das configurações existentes; validação de URLs e permissões por domínio.
- [x] Chamadas: Chat Completions para geração; Decisions, System One ou Chat Completions para avaliação; limites de tempo, erros sem credenciais e teste real por serviço.
- [x] YouTube: busca pública e leitura de detalhes em JavaScript; API oficial opcional; cancelamento, legendas e falhas parciais.
- [x] Interface: cartões separados, restaurar URL OpenAI, resultados do teste usando os valores ainda não salvos, mensagens simples.
- [x] Ordenação: relevância decrescente na pesquisa e na restauração dos resultados; avaliações ausentes no fim.
- [x] Catálogo LiteLLM: modelos por provedor/formato, nome personalizado, cópia local e atualização sem credenciais.
- [x] Seleção: relevantes pré-selecionados, desmarcar tudo, cópia dos links e persistência das desmarcações.
- [x] Continuação: termos novos, exclusão de vídeos já avaliados, mesclagem por relevância e preservação da seleção.
- [x] Importação: nomes sem ícones, espera de validação, Choice dinâmico, cache de controles confirmados, fila pausada em erro de layout e revisão de fontes incertas.
- [x] Verificação: testes dos contratos e da migração, chamadas com o .env fora da extensão e inspeção da interface no navegador.
- [x] Distribuição: ZIP com lista explícita de arquivos; credenciais e perfis temporários excluídos.

Evidências e limites da validação estão em [verification.md](verification.md). A importação na conta Google real depende de uma sessão autenticada disponível.

Decisões: o .env permanece fora dos arquivos distribuídos e não é importado pela extensão. Configurações antigas com chave OpenRouter continuam usando os endpoints anteriores. URLs personalizadas exigem permissão somente para o domínio escolhido. HTTP é permitido apenas em localhost/127.0.0.1. O modelo de avaliação continua independente do gerador e falhas nunca aprovam um vídeo automaticamente.
