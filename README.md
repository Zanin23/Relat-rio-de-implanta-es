# Relatório de Implantações

Dashboard de página única para acompanhar o status das implantações: o que já
foi feito, o que ainda falta e qual a situação de cada empresa. Dá para
**cadastrar novas empresas** e **dar continuidade** nas que já estão no
relatório, atualizando status, progresso e listas a qualquer momento.

Sem build, sem dependências, sem backend — abre com dois cliques.

## Estrutura

```
index.html   -> o dashboard inteiro (HTML + CSS)
dados.js     -> os dados do relatório (o "baseline" que volta no botão Restaurar)
app.js       -> toda a lógica: filtros, editor, salvamento, export/import
vercel.json  -> configuração de deploy na Vercel
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

### Onde os dados ficam salvos
As alterações são salvas automaticamente **no navegador** (localStorage), então
continuam lá da próxima vez que você abrir o relatório na mesma máquina. O
rodapé avisa quando existem alterações locais.

Para que a alteração valha **para todos** (e sobreviva a outro navegador):

1. Menu **Dados ▾ → Baixar dados.js**
2. Substitua o arquivo `dados.js` do repositório pelo baixado
3. `git commit` + `git push` — a Vercel publica sozinha

O menu **Dados ▾** também tem:

- **Exportar JSON** — backup completo (serve para levar o relatório para outra
  máquina ou guardar versão)
- **Importar JSON** — substitui o relatório atual pelo de um arquivo
- **Restaurar relatório original** — descarta as alterações locais e volta aos
  dados de `dados.js`

### Data do relatório
A data do levantamento fica no topo e é editável (clique nela).

## Formato dos dados

Cada empresa em `dados.js`:

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
  atualizado: "2026-10-08"
}
```

O arquivo também aceita o formato antigo (`name`, `type`, `done`, `pending`,
`subs`, `phases`) na importação.

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

```bash
git add .
git commit -m "Atualização do levantamento"
git push
```

A Vercel detecta o push e publica automaticamente. Sem build, sem cache para
invalidar — a mudança aparece na hora.
