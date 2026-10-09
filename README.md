# Relatório de Implantações

Dashboard de página única para acompanhar o status das implantações: o que já
foi feito, o que ainda falta e qual a situação de cada empresa. Dá para
**cadastrar novas empresas** e **dar continuidade** nas que já estão no
relatório, atualizando status, progresso e listas a qualquer momento.

**Com o servidor compartilhado ligado, o que qualquer pessoa altera vale para
todo mundo na hora** (tempo real via Supabase). Sem ele, o app continua
funcionando sozinho, salvo no navegador — sem build, sem dependências, abre com
dois cliques.

## Estrutura

```
index.html          -> o dashboard inteiro (HTML + CSS)
dados.js            -> os dados do relatório (o baseline que volta no "Restaurar")
app.js              -> toda a lógica: filtros, editor, salvamento, export/import e relatórios
cronograma-pdf.js   -> leitura local do PDF e interpretação das linhas do cronograma
sync.js             -> sincronização compartilhada (merge, diff, tempo real)
sync-config.js      -> URL + anon key do Supabase  (é isto que vale para todos)
supabase.sql        -> roda uma vez no SQL Editor do Supabase
mock-supabase.js    -> simula o servidor no navegador para testar (?mock=1)
vendor/             -> Supabase JS e PDF.js (bundles prontos, sem build)
vercel.json         -> configuração de deploy na Vercel
```

## Rodar localmente

```bash
npm run dev
```

Depois acesse `http://localhost:8080`.

## Como usar no dia a dia

### Cadastrar uma nova empresa
Botão **+ Nova empresa** (canto superior direito). Preencha:

- **Empresa** e **tipo de trabalho** (Nova implantação, Reimplantação,
  Migração Cloud, Treinamento… — o tipo é livre, com sugestões)
- **Status**: Aguardando cliente · Aguardando desenvolvimento · Em andamento ·
  Atenção / risco · Concluído
- **Progresso** (0 a 100%)
- **Status atual**: a frase do que está acontecendo agora
- **O que já foi feito** e **O que ainda falta fazer**: listas com botão
  `+ adicionar item` e `×` para remover
- **Outras empresas do grupo** (opcional): filiais/CNPJs da mesma carteira
- **Fases da implantação** (opcional): marca cada etapa como concluída,
  em andamento, pendente ou não prevista — alimenta a matriz
- **Observação interna** e **data da atualização**

### Dar continuidade em uma implantação já cadastrada
Passe o mouse no card da empresa e clique no **lápis** (ou abra o detalhe e
clique em **Editar**). Atualize o que mudou: status, progresso, itens
concluídos, novas pendências. Cada salvamento registra uma entrada no
**histórico** da empresa, que aparece no detalhe ("Últimas atualizações") —
assim dá para ver a evolução da carteira.

> Atalhos: clique no card abre o detalhe · `Enter` abre · `E` edita ·
> `/` foca a busca · `Esc` fecha · `← →` navegam entre empresas.

### Importar cronograma PDF

Use **Importar cronograma** no topo (ou **Dados ▾ → Importar cronograma PDF**):

1. Selecione/arraste o PDF. A leitura é feita **localmente no navegador**; o
   arquivo não é enviado ao Supabase nem a outro servidor.
2. Confira e edite a prévia: empresa, fase, atividade, datas prevista/visita/
   conclusão, hora, responsável, tipo, status e progresso. As linhas não
   reconhecidas podem ser ajustadas, associadas manualmente a uma empresa,
   desmarcadas ou adicionadas manualmente.
3. Clique **Aplicar atualizações**. Para cada empresa selecionada, os itens do
   cronograma importado substituem o cronograma anterior daquela empresa. O
   status `PENDENTE` é tratado como **Em andamento**; todas as etapas concluídas
   marcam a empresa como **Concluído**. O progresso só muda quando o PDF contém
   percentuais. As mudanças entram no histórico e, se a empresa estiver
   sincronizada, são enviadas à equipe.

A leitura reconhece PDFs que contêm texto pesquisável. O modelo analisado
organiza as etapas em fases numeradas e mostra `CONCLUÍDO`/`PENDENTE`, além de
`Previsto`, `Visita agendada`, `Concluído` e `Resp.`. Esses campos são associados
à atividade logo acima; visitas e datas de conclusão também aparecem nos
relatórios. Se o arquivo for uma imagem digitalizada, aplique OCR antes de
importá-lo. Outros formatos podem exigir ajustes; revise sempre a prévia antes
de confirmar.

### Relatórios complementares

A seção **Relatórios complementares** apresenta a distribuição da carteira por
faixa de progresso, as empresas com mais pendências e os próximos itens/prazos
(avisando quando estiverem vencidos). Ela também oferece exportação CSV da
carteira, das pendências e da agenda/visitas para abrir no Excel ou similar.

## Onde os dados ficam salvos

Clique na pílula do topo (☁) ou use o menu **Dados ▾ → Servidor compartilhado**
para ver o estado. Três situações:

| Pílula | O que significa |
| --- | --- |
| `☁ ao vivo com a equipe` | ligado: salvou, foi para o servidor e apareceu para todo mundo |
| `enviando para a equipe…` / `sem conexão com o servidor` | sem internet ou o Supabase fora: a mudança ficou guardada no navegador e sobe sozinha quando voltar |
| `salvo só neste navegador` | sem servidor configurado: vale só para esta máquina (comportamento antigo) |

O `localStorage` nunca deixa de ser usado — ele é a cache que faz o site abrir
instantâneo e continuar funcionando offline.

### Ligar o compartilhamento (faz uma vez, ~5 minutos)

1. **Criar o projeto** — em [supabase.com](https://supabase.com): *New project*,
   região **South America (São Paulo)**, senha do banco em local seguro. O plano
   gratuito sobra para um relatório deste tamanho.
2. **Rodar o SQL** — *SQL Editor → New query*, cole o conteúdo inteiro de
   [`supabase.sql`](supabase.sql) e clique **Run**. Isso cria a tabela
   `documentos`, libera leitura/escrita para quem tem o link e liga o tempo real.
3. **Copiar as chaves** — *Project Settings → API*: `Project URL` e
   `anon public key`. Cole nos dois campos do painel ☁ no site e clique
   **Testar e conectar neste navegador** — já dá para ver funcionando (e abrir
   duas abas para ver uma mudar a outra).
4. **Valer para a equipe toda** — clique **Baixar sync-config.js pronto**,
   substitua o arquivo no repositório, faça commit. A Vercel publica e o mesmo
   link passa a ser o relatório compartilhado.

No primeiro acesso com o servidor vazio, o site **publica sozinho** o relatório
que estava no navegador (`dados.js` + alterações pendentes). Quem tinha
alterações locais presas não perde nada: na primeira conexão elas sobem para a
equipe, e duplicatas da mesma empresa são juntadas.

### Como os dados são guardados no Supabase

Uma tabela só, `documentos`, com **uma linha por empresa** — é isso que permite
duas pessoas editarem empresas diferentes ao mesmo tempo sem uma pisar na
outra:

| coluna | uso |
| --- | --- |
| `id` | id da empresa (linha `__meta__` guarda a data do levantamento) |
| `dados` | `jsonb` com o objeto da empresa, igual ao `dados.js` |
| `ordem` | posição no relatório |
| `atualizado_em` | carimbado pelo banco (trigger) |

Regras do merge (em `sync.js`), feitas sobre `local × servidor × última
sincronização`:

- só existe no navegador → cadastral nova: **publica**
- o servidor não mudou desde a última sincronização → **a sua alteração sobe**
- os dois mudaram a mesma empresa → vence quem salvou por último nesta sessão;
  sem isso, o `atualizado` mais recente; em último empate, o servidor
- você apagou → **apaga para todos**
- mesmo nome com ids diferentes (resquício do modelo antigo) → **junta** e
  remove a duplicata do banco

Cada aba aberta recebe os eventos por WebSocket (`postgres_changes`) e, por
cautela, refaz a leitura a cada 30 s enquanto a aba estiver visível.

### Testar sem criar conta nenhuma

```
http://localhost:8080/?mock=1
```

`mock-supabase.js` simula o servidor dentro do navegador (o "banco" vira uma
chave do localStorage e o tempo real vira um `BroadcastChannel` entre abas).
Abra duas janelas lado a lado: o que salvar em uma muda a outra sozinha. Serve
para conhecer o comportamento antes de ligar o Supabase de verdade — e só age com
`?mock=1` no endereço.

## Menu **Dados ▾**

- **Exportar JSON** — backup completo (para levar o relatório para outra máquina)
- **Importar JSON** — substitui o relatório atual pelo de um arquivo
  (com o servidor ligado, isso publica para a equipe; confirme antes)
- **Baixar dados.js** — alternativa manual ao servidor: gera o arquivo para
  commitar no repositório. Útil se você preferir continuar no fluxo antigo
- **Servidor compartilhado** — estado, chaves, "buscar agora", "publicar este
  navegador inteiro", "zerar o banco e recriar do zero"
- **Buscar alterações da equipe** — força a leitura do servidor agora
- **Restaurar relatório original** — volta aos dados de `dados.js`. **Com o
  servidor ligado isso vale para toda a equipe**, e o aviso diz isso na tela

### Data do relatório
A data do levantamento fica no topo e é editável (clique nela). Com o servidor
ligado ela também é compartilhada (linha `__meta__`).

## Formato dos dados

Cada empresa em `dados.js` (e cada linha `dados` do banco):

```js
{
  nome: "Raguso",
  tipo: "Nova implantação",
  status: "cliente",            // cliente | desenvolvimento | andamento | risco | concluido
  progresso: 50,                // 0 a 100
  statusText: "Aguardando retorno sobre matéria-prima…",
  feito: ["Cadastro de usuários", "…"],
  falta: ["Validação do cadastro de matéria-prima"],
  grupo: ["Filial X — pendente Cloud"],   // opcional
  fases: [["done",""],["done",""],["pend",""],["now",""],["na",""]],
  observacao: "Nota interna",   // opcional
  atualizado: "2026-10-08",
  cronograma: [{               // opcional: preenchido pela importação de PDF
    fase: "Estoque", atividade: "Inventário",
    data: "2026-10-12", visitaData: "2026-10-13", concluidoEm: "",
    responsavel: "Matheus Zanin", hora: "14:00",
    categoria: "etapa", status: "pendente", progresso: null, origem: "cronograma.pdf"
  }]
}
```

O arquivo também aceita o formato antigo (`name`, `type`, `done`, `pending`,
`subs`, `phases`) na importação.

## Segurança / privacidade

- A `anon key` é pública por design: ela é enviada no HTML e visível no
  navegador de qualquer um. A proteção vem das **políticas de RLS** de
  `supabase.sql`, que hoje deixam qualquer pessoa com o link ler e escrever
  (foi a opção escolhida: simplicidade para a equipe interna).
- Links da Vercel não são adivinháveis, mas **não há senha**: quem tiver o URL
  pode editar o relatório. Se isso incomodar, as saídas são:
  1. proteção de link na Vercel (*Settings → Deployment Protection /
     Password Protection*);
  2. apertar as políticas de RLS no `supabase.sql` (exigir JWT, ou senha via
     Edge Function) e trocar o "qualquer um edita" por "só quem entra".
- Nada de sensível é enviado para fora: só os campos deste relatório vão para o
  seu próprio projeto Supabase.

## Publicar na Vercel via repositório Git

Repositório: https://github.com/Zanin23/Relat-rio-de-implanta-es

1. Acesse https://vercel.com/new
2. Autorize o acesso ao GitHub e selecione `Relat-rio-de-implanta-es`
3. Configure:
   - **Framework Preset:** Other
   - **Build Command:** vazio
   - **Output Directory:** vazio
4. Clique em **Deploy**

Em ~10 segundos o site fica em `https://relat-rio-de-implanta-es.vercel.app`
(o nome do domínio pode ser alterado depois em Settings -> Domains).

## Atualizar depois de publicado

Com o **servidor ligado**: só editar o site. Não precisa de commit nem de novo
deploy — o deploy só volta a ser necessário quando você mexer em código ou no
`dados.js`.

Sem servidor (fluxo manual antigo):

```bash
git add .
git commit -m "Atualização do levantamento"
git push
```

A Vercel detecta o push e publica automaticamente. Sem build, sem cache para
invalidar — a mudança aparece na hora.
