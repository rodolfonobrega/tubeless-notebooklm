# Registro de verificação

Data: 02/10/2026. Extensão 1.3.0. Chrome 154.0.8037.93 no Windows. Os registros de chamadas reais abaixo foram executados na versão 1.2.0; as versões seguintes acrescentam os idiomas rápidos, a avaliação de até 250 vídeos com paralelismo ajustável e a importação em lote. A versão atual foi novamente verificada com testes unitários, validação e o fluxo de navegador com respostas controladas.

## Executado

| Verificação | Resultado |
| --- | --- |
| `npm test` | 86 testes aprovados; nenhum ignorado |
| `npm run check` | Sintaxe aprovada e 9 referências do manifest encontradas |
| Painel carregado como extensão real no Chrome | Presets independentes, restauração de URL e limpeza da chave ao trocar domínio aprovados |
| Botão de conexões | Geração, avaliação e YouTube aprovados; valores não salvos não alteram configurações persistidas |
| Cancelamento | Chamadas interrompidas e campos reativados |
| Idiomas rápidos | Seleção no formulário, persistência ao reabrir, sincronização com Configurações, idiomas personalizados e limites de um a cinco aprovados; busca em espanhol e continuação em inglês enviaram os respectivos idiomas ao gerador e ao YouTube |
| Avaliação de 250 vídeos | Pipeline com respostas controladas avaliou 250 de 260 candidatos, preservou erro individual, ordenação e progresso de 0 a 250 |
| Paralelismo ajustável | Testes mediram picos de 1, 8 e 16 avaliações em execução; configuração ausente usa 8; cancelamento interrompeu as oito chamadas ativas sem iniciar os vídeos pendentes |
| Limites no Chrome | Campos aceitam 250 vídeos e 16 chamadas simultâneas, rejeitam valores acima e mantêm os valores salvos ao reabrir |
| Relevância | Ordem 97%, 80%, 20% confirmada na busca; ordem mantida ao restaurar resultados salvos |
| Seleção e cópia | Relevantes pré-selecionados, desmarcar tudo, seleção persistida e texto copiado para a área de transferência confirmados |
| Continuar buscando no Chrome | Novos resultados mesclados, sem duplicatas; desmarcações anteriores mantidas e novo relevante selecionado |
| Catálogo LiteLLM real | Download na extensão e filtros por provedor/formato aprovados; atualização não substitui nome personalizado; cópia local funciona offline |
| Destino obrigatório | Página inicial do NotebookLM não é tratada como notebook; sem notebook aberto, há aviso e erro, sem criar aba ou fila, mesmo com link configurado |
| Importação em lote | Painel e content script reais confirmaram três fontes em um único envio; fixture adicional confirmou 250 links colados uma vez |
| Separadores e escolha de formulário | Área de texto recebe quebras de linha; campo de texto recebe espaços; Sites/Links é preferido quando a opção YouTube também aparece |
| Lote parcial | Um item confirmado foi mantido; dois itens exigiram revisão individual; Retomar enviou apenas os dois restantes e não duplicou a fonte anterior |
| Interrupção e persistência | Recarregar o painel durante o envio preservou três itens uncertain; mesmo após recarregar o notebook, a retomada ficou bloqueada até revisão explícita, sem nova submissão |
| Destino fechado ou trocado | Fila com destino fechado não abriu outra aba nem usou outro notebook disponível; mudança A→B durante a preparação não enviou fontes a B; content script recusou notebookUrl incompatível |
| Confirmação e duplicatas | Fontes com rótulos acessíveis sem href são confirmadas e lembradas na mesma página; títulos equivalentes com entidades HTML não confirmam duas fontes pela aparição de uma só |
| Localização dinâmica integrada | Mensagens conteúdo → worker → provedor Choice simulado → conteúdo confirmaram três fontes em um único lote; houve somente uma chamada ao modelo |
| Jev Choice real | Chamada real com os candidatos Cancelar/Inserir fonte retornou o ID correto |
| Fixtures de Notebook | Quinze cenários passaram, incluindo lote de 250 URLs, entrada parcial, retomada, destino incompatível, separadores, títulos ambíguos e os sete cenários anteriores de localização/privacidade |
| Conexões reais no contexto da extensão | OpenRouter Chat Completions, Jev Decisions e YouTube público aprovados |
| Geração real em Node | OpenAI `gpt-5-mini`, Groq `openai/gpt-oss-120b`, DeepSeek `deepseek-chat` e OpenRouter `google/gemini-2.5-flash` aprovados |
| Fluxo real em Node | Geração multilíngue, busca pública, detalhes e avaliação concluídos com Groq + Jev/OpenRouter e com DeepSeek para ambas as chamadas; continuação real gerou dois novos termos, avaliou dois novos vídeos e terminou com quatro sem duplicatas |
| Correções da revisão | Regressões cobrem chaves pareadas com seu endpoint e filtro de legendas no modo oficial |
| Revisão independente das correções | Achados sobre títulos privados e prazo do worker corrigidos e reconferidos; sem achados pendentes. O worker usa prazo de 25 segundos |
| Revisão independente do lote | Corrida de destino, normalização de títulos e persistência antes do envio corrigidas e reconferidas; sem achados altos ou médios pendentes |
| Layout do painel | Último cartão permanece acessível acima do painel fixo de seleção |

As chaves do .env foram carregadas por código e não impressas. Os testes Chrome usam um perfil temporário isolado e removem suas configurações ao terminar. Capturas locais ficam em `.test-artifacts/`, fora da distribuição.

## Limites concretos

- **Nova importação em lote ainda não validada em conta autenticada:** o usuário confirmou a inserção individual na versão anterior. Nesta sessão, o navegador disponível abriu a tela de login do Google; os novos testes usam páginas simuladas e não comprovam compatibilidade do lote com o DOM atual da conta.
- TypeSafe direto e YouTube Data API oficial foram verificados por contratos e respostas controladas; não havia chaves desses serviços no .env utilizado.
- Outros modelos e endpoints personalizados precisam passar pelo botão **Testar conexões** com sua configuração. A compatibilidade genérica não garante acesso a qualquer modelo.
- A busca pública depende das páginas do YouTube; não elimina bloqueios de robôs ou mudanças de layout. A avaliação considera metadados, não o conteúdo audiovisual.

## Distribuição

`npm run package` gera `dist/TubeLess-1.3.0.zip` com uma lista explícita de arquivos. O pacote contém a extensão, cópia compacta do catálogo, licença e instruções de uso; exclui .env, testes, scripts de desenvolvimento e perfis de navegador. A instalação é por extração e **Carregar sem compactação** em `chrome://extensions`. O ZIP é aberto por leitor independente, seus arquivos comparados com os originais e os valores das quatro chaves verificados como ausentes.
