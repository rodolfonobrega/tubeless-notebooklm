# TubeLess para NotebookLM

Extensão Chrome para pesquisar vídeos em vários idiomas, ordenar por relevância e adicionar os selecionados como fontes do NotebookLM. Funciona diretamente no navegador, sem servidor, Python ou build.

O TubeLess faz a descoberta e a seleção de vídeos. O NotebookLM processa as fontes e responde sobre o conteúdo delas.

## Recursos

- Geração de termos variados por idioma, com seleção rápida de idiomas no painel.
- Busca pública no YouTube sem chave obrigatória com retries automáticos; API oficial opcional.
- Geração e avaliação com provedores, modelos e chaves independentes.
- Histórico local de pesquisas com restauração rápida de termos e vídeos selecionados.
- Segurança reforçada: chaves de API sempre protegidas, com conferência apenas por prefixo e sufixo mascarados.
- Até 1.000 avaliações por rodada e de 1 a 32 chamadas simultâneas.
- Vídeos ordenados por relevância, seleção automática dos aprovados e cópia de links.
- Continuação da pesquisa com termos novos e preservação da seleção anterior.
- Importação direta no NotebookLM em lote, confirmação individual e retomada após revisão.
- Identificação dos controles do notebook pelo avaliador quando a localização normal falha.

## Instalar

1. Baixe `TubeLess-1.4.0.zip` na [release v1.4.0](https://github.com/rodolfonobrega/tubeless-notebooklm/releases/tag/v1.4.0) e extraia em uma pasta permanente.
2. Abra `chrome://extensions` no Google Chrome.
3. Ative **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
4. Selecione a pasta extraída que contém `manifest.json`.
5. Fixe o ícone TubeLess. Clique nele para abrir o painel lateral.

Também é possível clonar ou baixar o código deste repositório e carregar a própria pasta raiz como extensão. Não é necessário instalar dependências para usar a extensão.

Requer Chrome 116 ou superior. Para atualizar mantendo as configurações, substitua os arquivos na mesma pasta, recarregue a extensão em `chrome://extensions` e recarregue as abas do NotebookLM abertas.

## Primeira pesquisa

1. Abra as configurações pela engrenagem e preencha as conexões de geração e avaliação.
2. Clique em **Testar conexões** e depois em **Salvar**.
3. Digite um tema, marque os idiomas e clique em **Pesquisar**.
4. Revise os vídeos selecionados, abra um notebook no Chrome e clique em **Adicionar fontes**.

## Configurar

Abra a engrenagem. As conexões são independentes: cada uma tem sua **URL base**, **chave** e **modelo**.

| Conexão | Opções |
| --- | --- |
| Geração de buscas | OpenAI, Groq, DeepSeek, OpenRouter ou outro serviço compatível com Chat Completions |
| Avaliação dos vídeos | OpenRouter Decisions, TypeSafe System One ou Chat Completions |
| YouTube | Busca pública sem chave, ativada por padrão; API oficial opcional |

Os presets preenchem endereço, modelo e formato. Você pode editar esses valores. A geração começa com OpenAI (`gpt-5-mini`); a avaliação começa com OpenRouter (`typesafe/jev-1.13`, formato Decisions). Os nomes de modelo precisam existir e estar acessíveis na sua conta.

A lista de modelos vem do [catálogo LiteLLM](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json). Ela acompanha o provedor e o formato da chamada, remove o prefixo de roteamento do LiteLLM e filtra modelos incompatíveis ou com data de descontinuação vencida. O campo de nome permanece editável: escolha **Nome personalizado** ou digite diretamente. Atualizar a lista nunca substitui o nome digitado.

Uma cópia compacta acompanha a extensão. A lista atualizada fica no armazenamento local por um dia; a extensão tenta atualizá-la automaticamente e há o botão **Atualizar modelos**. Se a rede falhar, a lista anterior continua disponível. Nenhuma chave é enviada ao catálogo. A presença na lista não garante disponibilidade ou acesso na sua conta; confira com **Testar conexões**. A licença do catálogo está em `assets/litellm-LICENSE.txt`.

O botão **Restaurar OpenAI** restaura o endereço e modelo padrão da geração. A avaliação tem seu próprio botão de restauração. Trocar de preset para outro domínio limpa a chave anterior; informe a chave correspondente ao novo provedor. Endereços personalizados aceitam HTTPS e HTTP apenas em `localhost`/`127.0.0.1`. O Chrome solicita acesso ao domínio escolhido ao testar, salvar ou pesquisar.

**Testar conexões** usa os valores nos campos, mesmo antes de salvar. Faz chamadas reais de geração, avaliação e YouTube, incluindo leitura dos detalhes dos vídeos. Cada serviço mostra seu resultado separadamente; o teste pode ser cancelado. As chamadas de modelos podem consumir créditos. Salve depois de conferir os resultados.

Para Jev, selecione **Decisions** no OpenRouter (`https://openrouter.ai/api/alpha`) ou **System One** no TypeSafe (`https://api.typesafe.ai`). Jev usa respostas tipadas de decisão. Use **Chat Completions** ao avaliar com um modelo generativo compatível com OpenAI. Referências: [OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request) e [TypeSafe API](https://docs.typesafe.ai/api).

## Pesquisar e adicionar fontes

1. Marque os **Idiomas da pesquisa** abaixo do tema. A seleção é salva automaticamente e mantém de um a cinco idiomas. Há opções comuns e os códigos personalizados que você salvar em Configurações também aparecem. Quantidade de termos, limite de avaliação e filtro de legendas continuam nas configurações.
2. Digite o tema e clique em **Pesquisar**. A extensão varia os termos por idioma, busca, remove duplicatas e avalia os metadados.
3. Os vídeos aparecem **do maior grau de relevância para o menor**. A ordem também é mantida ao reabrir resultados salvos. Resultados sem avaliação ficam no fim da lista **Todos**.
4. Os relevantes já vêm selecionados. Use **Desmarcar tudo**, marque apenas os desejados ou **Selecionar todos**. **Copiar links selecionados** copia uma URL por linha, em ordem de relevância. Suas desmarcações são preservadas ao reabrir o painel.
5. **Continuar buscando** usa os idiomas marcados naquele momento e gera termos novos para o mesmo tema, evita reavaliar vídeos que já estão nos resultados e adiciona os novos relevantes à seleção. As desmarcações anteriores são mantidas. Cada rodada respeita os limites configurados e pode consumir créditos. Falhas e cancelamento preservam os resultados anteriores.
6. Abra um notebook no Chrome; escolha o destino e clique em **Adicionar fontes**. A página inicial com a lista de notebooks não serve como destino. Se não houver um notebook aberto, a extensão exibe um aviso e não abre uma aba automaticamente. **Abrir notebook** é a ação explícita para abrir o link configurado ou a página inicial.
7. A extensão cola os links selecionados em um único envio e confirma cada fonte pela página. Prefere a opção **Sites/Links** quando há vários vídeos, com links separados por quebra de linha em áreas de texto ou por espaço em campos de uma linha, conforme a [orientação do Google](https://support.google.com/notebooklm/answer/16215270?hl=pt-BR). Fontes já identificadas no notebook não são reenviadas. Erros ficam visíveis. A fila salva permite retomar somente os itens pendentes no mesmo notebook.

Em **Configurações → Alcance da busca**, o **Máximo de vídeos avaliados por rodada** aceita até **250**. O limite anterior salvo é preservado: aumente-o e salve antes de pesquisar novamente. Para encontrar mais candidatos, ajuste também os termos por idioma e os vídeos por termo; o limite de 250 não garante que a busca encontre essa quantidade.

**Avaliações simultâneas** aceita de **1 a 16**, com **8** como padrão. As chamadas são assíncronas e uma nova começa assim que outra termina. O progresso conta avaliações concluídas, os resultados continuam ordenados por relevância e uma falha individual não interrompe os outros vídeos. Cancelar interrompe as chamadas e impede iniciar os vídeos pendentes. Aumentar o paralelismo pode acelerar a rodada, conforme os limites e a velocidade do provedor.

Se algum item do lote ficar sem confirmação, a fila pausa e mostra o título a revisar. Confira a aba antes de usar **Já está no notebook**. Se você conferiu que a fonte não foi adicionada, use **Verifiquei: não entrou** para liberar uma nova tentativa. Revise todos os itens incertos; depois **Retomar** envia os links restantes juntos. A extensão aguarda o notebook terminar o processamento antes de liberar a repetição. A fila é salva como aguardando confirmação antes do envio: fechar o painel ou recarregar o notebook exige revisar os itens sem resposta antes de tentar novamente. Só resultados aprovados pelo avaliador podem ser selecionados.

O notebook de destino precisa continuar aberto para retomar a fila. Uma aba de outro notebook não substitui esse destino, e mudar de notebook durante a preparação bloqueia a inserção. A quantidade aceita pelo NotebookLM depende dos limites da conta; a extensão não marca itens como confirmados apenas por ter clicado em Inserir.

## Localização dos controles do notebook

A extensão identifica nomes acessíveis dos controles, ignorando o texto de ícones, e espera o botão de inserir ficar habilitado após a validação da URL. Isso corrige casos em que o texto visível “Inserir” vinha acompanhado de `add` no DOM ou o botão ainda estava desabilitado.

Se um controle mudar, a extensão tenta identificá-lo pela conexão de avaliação configurada. Jev usa uma pergunta **Choice** com IDs dos candidatos; um avaliador Chat Completions usa resposta estruturada. O modelo recebe somente rótulo, tipo e atributos de identificação dos controles visíveis. Valores dos campos, conteúdo de notas, corpos das fontes e chaves não são enviados. O alvo precisa existir, continuar visível e habilitado e atingir a confiança mínima; o modelo não fornece código nem seletores executáveis.

Após uma fonte ser confirmada na página, os descritores usados são salvos em `notebookLocatorCache`, um registro JSON no armazenamento do perfil Chrome, separado por domínio e idioma. Não é necessário gravar arquivos na pasta da extensão. Cada referência é conferida antes do uso; se não corresponder mais, a localização é refeita. As chaves ficam no worker da extensão. Um erro estrutural pausa a fila na primeira ocorrência, preservando os itens restantes.

Essa identificação pode consumir créditos do avaliador. Referências: [contrato Choice](https://docs.typesafe.ai/api) e [exemplo oficial com elementos e IDs](https://github.com/TypeSafeAI/typesafe-playground/blob/main/lib/callJev.ts).

## O que é verificado

O avaliador recebe título, descrição, canal, data e outros metadados disponíveis. Ele não assiste ao vídeo nem lê sua transcrição. O NotebookLM fica responsável por processar a fonte e responder sobre seu conteúdo. A pontuação representa a triagem do avaliador, não uma garantia da qualidade do vídeo.

A busca sem chave lê as páginas públicas do YouTube, sem executar o HTML recebido ou enviar cookies da conta. Funciona sem backend; consentimento, bloqueio de robôs, limites de acesso ou mudanças no formato da página podem impedir a busca. Esses casos geram erros explícitos. A API oficial é uma alternativa opcional com sua própria chave. A busca considera a primeira página de cada termo, dentro do limite configurado.

O filtro de legendas exige confirmação nos detalhes em ambos os modos. Vídeos indisponíveis ou cujos detalhes não puderam ser verificados são excluídos no modo público. Falhas de avaliação nunca aprovam uma fonte automaticamente.

A importação usa os controles da aba do NotebookLM. Mudanças nessa interface podem exigir atualização de `content/notebook.js`. Também dependemos das regras de aceitação de fontes do Google. Os testes automatizados de importação usam páginas simuladas com o content script real; não garantem compatibilidade com todas as variações da interface Google. Veja os cenários executados e os limites no [registro de verificação](docs/verification.md).

## Chaves e privacidade

As chaves ficam em `chrome.storage.local`, acessível aos contextos confiáveis da extensão. Não são enviadas ao NotebookLM. O armazenamento local do Chrome não é um cofre criptografado.

O provedor de geração recebe o tema, idiomas e consultas anteriores nas rodadas de continuação. O avaliador recebe o tema e metadados dos vídeos, ou os descritores limitados dos controles quando a localização dinâmica é necessária. As consultas vão ao YouTube; somente as URLs selecionadas são inseridas no notebook. O catálogo é baixado do GitHub sem credenciais. A extensão guarda configurações, último resultado, seleção, catálogo, referências de controles e fila de importação no perfil local. Não há telemetria própria. Os limites de busca e avaliação ajudam a controlar consumo.

O `.env` serve apenas aos testes locais em Node; a extensão não o carrega. O pacote usa uma lista explícita de arquivos e exclui `.env`, scripts de teste e perfis temporários.

## Verificação e desenvolvimento

JavaScript sem dependências de execução. Os comandos abaixo se aplicam ao projeto fonte; o ZIP de instalação contém os arquivos necessários à extensão. Para testar e gerar o pacote, use Node.js 22 ou superior:

```sh
npm test
npm run check
npm run package
```

As chamadas reais podem usar um `.env` nesta pasta ou na raiz do projeto:

```sh
npm run test:live -- --provider=openai
npm run test:live -- --provider=groq --pipeline
npm run test:live -- --provider=deepseek --openai-evaluation
npm run test:live -- --provider=openrouter
```

`--openai-evaluation` significa usar Chat Completions com a mesma conexão de geração, inclusive em outros provedores. `--pipeline` executa descoberta e avaliação reais. `--env=caminho` seleciona outro arquivo. Os scripts não imprimem as chaves.

Variáveis aceitas: `OPENAI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`; opcionais `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `OPENAI_BASE_URL`, `DEFAULT_MODEL`, `EVALUATION_API_KEY`, `EVALUATION_BASE_URL`, `EVALUATION_PROTOCOL`, `EVALUATION_MODEL`, `JEV_API_KEY`, `TYPESAFE_API_KEY`, `YOUTUBE_MODE`, `YOUTUBE_API_KEY`. Há um exemplo sem credenciais em `.env.example`.

Sem configuração explícita, a avaliação usa a chave TypeSafe se presente, senão a OpenRouter. Uma chave explícita de avaliação tem prioridade e começa com o formato Decisions; ajuste endereço/formato/modelo para outro serviço. Para Chat Completions com chave explícita, informe também a URL base. URLs não são inferidas pelo conteúdo de tokens.

O teste de navegador requer Playwright e Chrome com suporte ao carregamento de extensões por CDP. Ele abre um perfil temporário isolado, testa a interface e a importação simulada, e remove o perfil ao terminar. Instale Playwright apenas para esses testes:

```powershell
npm install --no-save --package-lock=false playwright
$env:SCOUT_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
# Fixtures: lotes, confirmação, retomada, validação e localização de controles
npm run test:notebook
# Opcional: download real do catálogo no Chrome
npm run test:browser -- --catalog-live
# Opcional: conexões reais no contexto da extensão usando OPENROUTER_API_KEY
npm run test:browser -- --live
```

Se Playwright já estiver instalado em outra pasta, `SCOUT_PLAYWRIGHT_PATH` pode apontar para o módulo. Os testes ao vivo são opcionais e usam as suas chaves, podendo consumir créditos; os testes unitários e os fixtures não precisam dessas chaves.

Arquivos principais: `core/providers.js` integra serviços; `core/youtube-web.js` lê o YouTube público; `core/pipeline.js` orquestra a busca; `core/continuation.js` mescla rodadas e seleção; `core/models.js` trata o catálogo; `settings.js` controla configurações e diagnóstico; `panel.*` implementa o painel; `content/notebook.js` insere as fontes; `core/notebook-worker.js` protege chamadas de localização e cache.
