# Dashboard — Status de Implantações

Site estático de página única. Sem build, sem dependências, sem backend.

## Estrutura

```
index.html   -> o dashboard inteiro (HTML + CSS + JS num arquivo só)
vercel.json  -> configuração de deploy na Vercel
```

## Rodar localmente

É só abrir o `index.html` com dois cliques. Ou:

```bash
npm run dev
```

Depois acesse `http://localhost:8080`.

## Publicar na Vercel via repositório Git

Repositório: https://github.com/Zanin23/Relat-rio-de-implanta-es

### 1. Importar na Vercel

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
