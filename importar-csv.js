/* =====================================================================
   Leitura local de planilhas CSV — cronograma/agenda ou carteira de
   empresas. Como no PDF, nada sai do navegador: delimitador, codificação,
   cabeçalho e colunas são reconhecidos aqui e a importação sempre passa
   por uma prévia editável antes de alterar o relatório.
   ===================================================================== */
(function (root) {
  "use strict";

  var MAX_BYTES = 8 * 1024 * 1024;          // 8 MB de planilha
  var MAX_LINHAS = 400;                     // linhas levadas para a prévia
  var DELIMITADORES = [";", ",", "\t", "|"];

  /* ================= texto ================= */
  function semAcento(valor) {
    var texto = String(valor == null ? "" : valor);
    try { texto = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return texto;
  }
  function chave(valor) {
    return semAcento(valor).toLowerCase().replace(/[^a-z0-9%]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function limpar(valor) {
    // o export do relatório prefixa ' em células que começam com = + - @ (anti-fórmula)
    return String(valor == null ? "" : valor).replace(/^\s+|\s+$/g, "").replace(/^'(?=[=+\-@])/, "");
  }

  /* ================= parser CSV (RFC 4180 tolerante) ================= */
  function parseCsv(texto, delimitador) {
    var tabela = [], linha = [], campo = "", aspas = false, c, prox;
    for (var i = 0; i < texto.length; i++) {
      c = texto.charAt(i);
      if (aspas) {
        if (c === '"') {
          prox = texto.charAt(i + 1);
          if (prox === '"') { campo += '"'; i++; }
          else aspas = false;
        } else campo += c;
        continue;
      }
      if (c === '"') { aspas = true; continue; }
      if (c === delimitador) { linha.push(campo); campo = ""; continue; }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && texto.charAt(i + 1) === "\n") i++;
        linha.push(campo); campo = "";
        tabela.push(linha); linha = [];
        continue;
      }
      campo += c;
    }
    linha.push(campo);
    tabela.push(linha);
    return tabela.map(function (l) { return l.map(limpar); })
      .filter(function (l) { return l.some(function (v) { return v !== ""; }); });
  }

  function amostra(texto, maxLinhas) {
    var corte = 0, quebras = 0;
    for (var i = 0; i < texto.length; i++) {
      if (texto.charAt(i) === "\n") { quebras++; if (quebras >= maxLinhas) { corte = i; break; } }
    }
    var trecho = corte ? texto.slice(0, corte) : texto;
    var totalAspas = (trecho.match(/"/g) || []).length;
    if (totalAspas % 2) trecho = trecho.slice(0, trecho.lastIndexOf('"'));
    return trecho;
  }

  function moda(numeros) {
    var contagem = {}, melhor = 0, melhorN = 0;
    numeros.forEach(function (n) {
      contagem[n] = (contagem[n] || 0) + 1;
      if (contagem[n] > melhorN || (contagem[n] === melhorN && n > melhor)) { melhor = n; melhorN = contagem[n]; }
    });
    return melhor;
  }

  function detectarDelimitador(texto) {
    var trecho = amostra(texto, 40), escolhido = ";", nota = -1;
    DELIMITADORES.forEach(function (d) {
      var tabela = parseCsv(trecho, d);
      if (!tabela.length) return;
      var contagens = tabela.map(function (l) { return l.length; });
      var colunas = moda(contagens);
      if (colunas <= 1) return;
      var consistentes = contagens.filter(function (n) { return n === colunas; }).length / contagens.length;
      var atual = colunas * 2 + consistentes * 10;
      if (atual > nota) { nota = atual; escolhido = d; }
    });
    return escolhido;
  }

  /* ================= valores ================= */
  function dataValidada(ano, mes, dia) {
    var d = new Date(Date.UTC(ano, mes - 1, dia));
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return "";
    return String(ano).padStart(4, "0") + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
  }

  var MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

  function dataIso(valor) {
    var s = String(valor == null ? "" : valor).trim();
    if (!s || /^[-–—]+$/.test(s)) return "";
    var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return dataValidada(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
    if (m) {
      var ano = +m[3];
      if (ano < 100) ano += ano >= 70 ? 1900 : 2000;
      return dataValidada(ano, +m[2], +m[1]);
    }
    m = chave(s).match(/(\d{1,2}) (?:de )?([a-z]{3,}) (?:de )?(\d{2,4})/);
    if (m && MESES[m[2].slice(0, 3)]) {
      var a = +m[3];
      if (a < 100) a += a >= 70 ? 1900 : 2000;
      return dataValidada(a, MESES[m[2].slice(0, 3)], +m[1]);
    }
    return "";
  }

  function horaDe(valor) {
    var m = String(valor == null ? "" : valor).match(/\b([01]?\d|2[0-3])\s*[:h]\s*([0-5]\d)\b/);
    return m ? String(m[1]).padStart(2, "0") + ":" + m[2] : "";
  }

  function progressoDe(valor) {
    var s = String(valor == null ? "" : valor).trim();
    if (!s) return null;
    var temPercento = s.indexOf("%") >= 0;
    var m = s.replace(/%/g, " ").match(/-?\d+(?:[.,]\d+)?/);
    if (!m) return null;
    var n = parseFloat(m[0].replace(",", "."));
    if (isNaN(n)) return null;
    if (!temPercento && n > 0 && n <= 1 && /[.,]/.test(m[0])) n = n * 100;   // 0,5 vindo do Excel
    n = Math.round(n);
    return n >= 0 && n <= 100 ? n : null;
  }

  var STATUS_CELULA = [
    { re: /(atencao|risco|atrasad|atraso|critic|bloquead|impedid|cancelad|parad)/, k: "risco" },
    { re: /(aguardando|retorno|validacao|dependencia|espera|pendencia).*(cliente)|^cliente$/, k: "cliente" },
    { re: /(aguardando|retorno|dependencia|espera|pendencia).*(desenvolvimento|dev|programacao|fabrica|suporte tecnico)|^(desenvolvimento|dev)$/, k: "desenvolvimento" },
    { re: /(conclu|finaliz|realizad|executad|entregue|encerrad|implantad)|^(ok|done|sim|100 ?%?)$/, k: "concluido" },
    { re: /(em andamento|andamento|em execucao|execucao|em curso|iniciad|em implantacao|em implementacao|rodando|ativo)/, k: "andamento" },
    { re: /(pendente|a fazer|nao iniciad|em aberto|aberto|previsto|planejado|agendad|aguardando|nao)/, k: "pendente" }
  ];

  function statusDe(valor) {
    var s = chave(valor);
    if (!s || s === "-") return "";
    for (var i = 0; i < STATUS_CELULA.length; i++) if (STATUS_CELULA[i].re.test(s)) return STATUS_CELULA[i].k;
    var pdf = root.CRONOGRAMA_PDF;
    return pdf && pdf.statusDaLinha ? pdf.statusDaLinha(valor) : "";
  }

  function categoriaDe(valor) {
    return /\b(visita|reuniao|atendimento|presencial|on site|onsite|viagem)\b/.test(chave(valor)) ? "visita" : "etapa";
  }

  // "a; b; c", "a | b", quebras de linha e marcadores viram lista de itens.
  // Células que só têm um número (contagens do CSV exportado) não viram lista.
  function listaDe(valor) {
    var s = String(valor == null ? "" : valor).trim();
    if (!s || /^\d+$/.test(s) || /^[-–—]+$/.test(s)) return [];
    return s.split(/\s*(?:[\r\n;|•·]|\s\u2014\s|\s--\s)+\s*/)
      .map(function (item) { return item.replace(/^\s*[-–—*>]+\s*/, "").trim(); })
      .filter(Boolean)
      .slice(0, 60);
  }

  /* ================= colunas ================= */
  // cada campo tem sinônimos já normalizados (minúsculo, sem acento)
  var COLUNAS = [
    { campo: "empresa",      exatos: ["empresa", "cliente", "nome", "nome da empresa", "nome do cliente", "razao social", "carteira", "conta"], contem: ["empresa", "cliente"] },
    { campo: "atividade",    exatos: ["atividade", "item", "tarefa", "descricao", "acao", "atividade item", "item do cronograma", "evento", "assunto", "servico", "descricao da atividade"], contem: ["atividade", "tarefa", "item"] },
    { campo: "fase",         exatos: ["fase", "modulo", "bloco", "etapa do projeto", "fase etapa", "grupo de atividades"], contem: ["fase", "modulo"] },
    { campo: "data",         exatos: ["previsto", "previsao", "data", "data prevista", "prazo", "data prevista de conclusao", "vencimento", "inicio", "data de inicio"], contem: ["previst", "prazo", "data prevista"] },
    { campo: "visitaData",   exatos: ["visita", "visita agendada", "data da visita", "data visita", "agendamento"], contem: ["visita"] },
    { campo: "concluidoEm",  exatos: ["concluido em", "data de conclusao", "conclusao", "concluido", "finalizado em", "termino", "data de termino", "fim", "data fim"], contem: ["conclusao", "concluido em", "termino"] },
    { campo: "hora",         exatos: ["hora", "horario", "hora prevista", "hora da visita"], contem: ["horario", "hora"] },
    { campo: "responsavel",  exatos: ["responsavel", "resp", "consultor", "analista", "responsavel tecnico", "equipe", "owner"], contem: ["responsavel", "consultor"] },
    { campo: "categoria",    exatos: ["tipo", "categoria", "tipo de item", "natureza", "tipo de atividade"], contem: ["categoria"] },
    { campo: "statusEmpresa",exatos: ["status da empresa", "situacao da empresa", "status do cliente"], contem: [] },
    { campo: "status",       exatos: ["status", "situacao", "status do item", "estado", "status da atividade", "andamento"], contem: ["status", "situacao"] },
    { campo: "progresso",    exatos: ["progresso", "%", "percentual", "pct", "avanco", "conclusao %", "percentual de conclusao", "progresso %"], contem: ["progresso", "percentual", "avanco"] },
    { campo: "origem",       exatos: ["origem", "fonte", "arquivo"], contem: [] },
    { campo: "tipo",         exatos: ["tipo de trabalho", "tipo de servico", "modalidade", "tipo de implantacao"], contem: ["tipo de trabalho", "modalidade"] },
    { campo: "statusText",   exatos: ["status atual", "situacao atual", "resumo", "resumo do status", "andamento atual", "descricao do status", "comentario"], contem: ["status atual", "situacao atual"] },
    { campo: "feito",        exatos: ["feito", "o que ja foi feito", "concluidos", "itens concluidos", "realizado", "entregues", "ja feito", "entregas"], contem: ["ja foi feito", "itens concluidos", "realizado"] },
    { campo: "falta",        exatos: ["falta", "o que ainda falta fazer", "pendencias", "itens pendentes", "a fazer", "em aberto", "pendentes", "o que falta"], contem: ["falta", "pendencia"] },
    { campo: "grupo",        exatos: ["grupo", "outras empresas do grupo", "filiais", "empresas do grupo", "cnpjs"], contem: ["grupo", "filia"] },
    { campo: "observacao",   exatos: ["observacao", "obs", "nota", "nota interna", "observacao interna", "comentario interno", "detalhe"], contem: ["observacao", "nota interna"] },
    { campo: "atualizado",   exatos: ["atualizado em", "atualizado", "ultima atualizacao", "data da atualizacao", "atualizacao"], contem: ["atualizado"] }
  ];

  function mapearColunas(cabecalho) {
    var mapa = {}, reconhecidas = 0, rotulos = {};
    (cabecalho || []).forEach(function (celula, indice) {
      var k = chave(celula);
      if (!k) return;
      var achou = null;
      for (var i = 0; i < COLUNAS.length && !achou; i++) {
        if (COLUNAS[i].exatos.indexOf(k) >= 0) achou = COLUNAS[i].campo;
      }
      for (var j = 0; j < COLUNAS.length && !achou; j++) {
        for (var c = 0; c < COLUNAS[j].contem.length && !achou; c++) {
          if (k.indexOf(COLUNAS[j].contem[c]) >= 0) achou = COLUNAS[j].campo;
        }
      }
      if (!achou || mapa[achou] != null) return;
      mapa[achou] = indice;
      rotulos[achou] = String(celula).trim();
      reconhecidas++;
    });
    return { mapa: mapa, rotulos: rotulos, reconhecidas: reconhecidas };
  }

  function temCabecalho(info, primeiraLinha) {
    if (info.reconhecidas >= 2) return true;
    if (!info.reconhecidas) return false;
    // uma coluna só: aceita se a linha não parecer dado (datas, números soltos)
    return !(primeiraLinha || []).some(function (celula) { return dataIso(celula) || /^\d+%?$/.test(String(celula).trim()); });
  }

  // planilha sem cabeçalho: 1ª coluna é a empresa e as demais são deduzidas
  // pelo conteúdo (data, percentual, status e, por fim, o texto principal)
  function inferirColunas(tabela, modo) {
    var mapa = {}, colunas = 0, amostras = (tabela || []).slice(0, 30);
    amostras.forEach(function (linha) { colunas = Math.max(colunas, linha.length); });
    if (!colunas) return mapa;
    function proporcao(indice, teste) {
      var valores = amostras.map(function (l) { return String(l[indice] == null ? "" : l[indice]).trim(); }).filter(Boolean);
      if (!valores.length) return 0;
      return valores.filter(teste).length / valores.length;
    }
    mapa.empresa = 0;
    var campoData = modo === "empresas" ? "atualizado" : "data";
    var campoTexto = modo === "empresas" ? "statusText" : "atividade";
    for (var i = 1; i < colunas; i++) {
      if (mapa[campoData] == null && proporcao(i, function (v) { return !!dataIso(v); }) >= 0.6) { mapa[campoData] = i; continue; }
      if (mapa.progresso == null && proporcao(i, function (v) { return /%/.test(v) || /^\d{1,3}$/.test(v); }) >= 0.6) { mapa.progresso = i; continue; }
      if (mapa.status == null && proporcao(i, function (v) { return !!statusDe(v); }) >= 0.6) { mapa.status = i; continue; }
      if (mapa[campoTexto] == null) { mapa[campoTexto] = i; continue; }
      if (modo === "empresas" && mapa.observacao == null) mapa.observacao = i;
      else if (modo !== "empresas" && mapa.responsavel == null) mapa.responsavel = i;
    }
    return mapa;
  }

  function detectarModo(mapa) {
    if (mapa.atividade != null) return "cronograma";
    var sinaisEmpresa = ["tipo", "statusText", "feito", "falta", "grupo", "observacao", "progresso", "status", "statusEmpresa", "atualizado"];
    var pontos = sinaisEmpresa.filter(function (campo) { return mapa[campo] != null; }).length;
    if (mapa.empresa != null && pontos) return "empresas";
    if (mapa.empresa != null && Object.keys(mapa).length === 1) return "empresas";
    return "";
  }

  /* ================= empresas conhecidas ================= */
  function acharEmpresa(nome, empresas) {
    var alvo = chave(nome);
    if (!alvo) return null;
    var lista = empresas || [], i;
    for (i = 0; i < lista.length; i++) if (chave(lista[i].nome) === alvo) return lista[i];
    var curto = alvo.replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(ltda|me|epp|eireli|sa|s a|comercio|industria)\b/g, " ").replace(/\s+/g, " ").trim();
    for (i = 0; i < lista.length; i++) {
      var outro = chave(lista[i].nome).replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(ltda|me|epp|eireli|sa|s a|comercio|industria)\b/g, " ").replace(/\s+/g, " ").trim();
      if (curto && outro && curto === outro) return lista[i];
    }
    for (i = 0; i < lista.length; i++) {
      var nomeBase = chave(lista[i].nome);
      if (nomeBase.length >= 4 && (alvo.indexOf(nomeBase) >= 0 || nomeBase.indexOf(alvo) >= 0)) return lista[i];
    }
    var pdf = root.CRONOGRAMA_PDF;
    return pdf && pdf.localizarEmpresa ? pdf.localizarEmpresa(nome, lista) : null;
  }

  /* ================= interpretação ================= */
  function celula(linha, mapa, campo) {
    var i = mapa[campo];
    return i == null ? "" : String(linha[i] == null ? "" : linha[i]).trim();
  }

  function interpretarCronograma(tabela, mapa, empresas) {
    var resultado = [], faseAtual = "";
    (tabela || []).slice(0, MAX_LINHAS).forEach(function (linha, indice) {
      var nomeCsv = celula(linha, mapa, "empresa");
      var atividade = celula(linha, mapa, "atividade").slice(0, 240);
      var fase = celula(linha, mapa, "fase").slice(0, 120);
      if (fase) faseAtual = fase; else fase = faseAtual;         // planilhas repetem a fase só na 1ª linha
      if (!atividade) atividade = celula(linha, mapa, "observacao").slice(0, 240);
      if (!atividade && !nomeCsv) return;

      var empresa = nomeCsv ? acharEmpresa(nomeCsv, empresas) : null;
      var textoLinha = linha.join(" · ");
      var statusCelula = celula(linha, mapa, "status");
      var progressoCelula = celula(linha, mapa, "progresso");
      var concluidoEm = dataIso(celula(linha, mapa, "concluidoEm"));
      var status = statusCelula ? statusDe(statusCelula) : "";
      if (!status && concluidoEm) status = "concluido";
      var categoriaCelula = celula(linha, mapa, "categoria");

      resultado.push({
        id: "csv-row-" + (indice + 1),
        empresaId: empresa ? empresa.id : (nomeCsv ? "__nova__" : ""),
        empresaNome: empresa ? empresa.nome : nomeCsv,
        empresaCsv: nomeCsv,
        atividade: atividade || nomeCsv,
        fase: fase,
        data: dataIso(celula(linha, mapa, "data")),
        visitaData: dataIso(celula(linha, mapa, "visitaData")),
        concluidoEm: concluidoEm,
        responsavel: celula(linha, mapa, "responsavel").slice(0, 120),
        hora: horaDe(celula(linha, mapa, "hora")) || horaDe(celula(linha, mapa, "visitaData")) || horaDe(celula(linha, mapa, "data")),
        categoria: categoriaCelula ? categoriaDe(categoriaCelula) : categoriaDe(atividade),
        status: status,
        progresso: progressoDe(progressoCelula),
        usar: !!((empresa || nomeCsv) && (atividade || nomeCsv)),
        pagina: 0,
        trecho: textoLinha.slice(0, 260)
      });
    });
    return resultado;
  }

  function interpretarEmpresas(tabela, mapa, empresas) {
    var resultado = [];
    (tabela || []).slice(0, MAX_LINHAS).forEach(function (linha, indice) {
      var nome = celula(linha, mapa, "empresa").slice(0, 120);
      if (!nome) return;
      var empresa = acharEmpresa(nome, empresas);
      var status = statusDe(celula(linha, mapa, "status") || celula(linha, mapa, "statusEmpresa"));
      if (status === "pendente") status = "andamento";            // igual ao PDF: PENDENTE vira Em andamento
      // numa planilha de carteira, a coluna "Tipo" é o tipo de trabalho
      // (no cronograma a mesma palavra significa etapa/visita)
      var tipo = celula(linha, mapa, "tipo") || celula(linha, mapa, "categoria");
      resultado.push({
        id: "csv-emp-" + (indice + 1),
        empresaId: empresa ? empresa.id : "",
        empresaCsv: nome,
        nome: empresa ? empresa.nome : nome,
        tipo: tipo.slice(0, 80),
        status: status,
        progresso: progressoDe(celula(linha, mapa, "progresso")),
        statusText: celula(linha, mapa, "statusText").slice(0, 400),
        feito: listaDe(celula(linha, mapa, "feito")),
        falta: listaDe(celula(linha, mapa, "falta")),
        grupo: listaDe(celula(linha, mapa, "grupo")),
        observacao: celula(linha, mapa, "observacao").slice(0, 400),
        atualizado: dataIso(celula(linha, mapa, "atualizado")),
        usar: true,
        trecho: linha.join(" · ").slice(0, 260)
      });
    });
    return resultado;
  }

  /* ================= leitura do arquivo ================= */
  function pareceCsv(arquivo) {
    var nome = String(arquivo && arquivo.name || "").toLowerCase();
    var tipo = String(arquivo && arquivo.type || "").toLowerCase();
    return /\.(csv|tsv|txt)$/.test(nome) || tipo === "text/csv" || tipo === "text/tab-separated-values" ||
      tipo === "application/csv" || (tipo === "text/plain" && !/\.pdf$/.test(nome));
  }

  function decodificar(bytes) {
    var dados = new Uint8Array(bytes);
    if (dados.length >= 3 && dados[0] === 0xEF && dados[1] === 0xBB && dados[2] === 0xBF) dados = dados.subarray(3);
    if (typeof root.TextDecoder === "function") {
      try {
        return new root.TextDecoder("utf-8", { fatal: true }).decode(dados);
      } catch (e) {
        try { return new root.TextDecoder("windows-1252").decode(dados); } catch (e2) {}
      }
    }
    var texto = "";
    for (var i = 0; i < dados.length; i++) texto += String.fromCharCode(dados[i]);
    try { return decodeURIComponent(escape(texto)); } catch (e3) { return texto; }
  }

  function analisarTexto(texto, empresas) {
    var limpo = String(texto || "").replace(/^\uFEFF/, "");
    if (!limpo.trim()) throw new Error("O arquivo CSV está vazio.");
    var delimitador = detectarDelimitador(limpo);
    var tabela = parseCsv(limpo, delimitador);
    if (!tabela.length) throw new Error("Não encontrei nenhuma linha preenchida no CSV.");

    var info = mapearColunas(tabela[0]);
    var comCabecalho = temCabecalho(info, tabela[1]);
    var corpo = comCabecalho ? tabela.slice(1) : tabela;
    var mapa = comCabecalho ? info.mapa : {};
    var modo = comCabecalho ? detectarModo(mapa) : "";

    var resultado = {
      delimitador: delimitador,
      totalLinhas: corpo.length,
      cabecalho: comCabecalho ? tabela[0] : [],
      colunas: info.rotulos,
      mapa: mapa,
      comCabecalho: comCabecalho,
      modo: modo || "texto",
      tabela: corpo,
      linhasTexto: corpo.map(function (linha, i) { return { pagina: 1, y: -i, texto: linha.join(" · ") }; })
    };

    if (resultado.modo === "cronograma") resultado.linhas = interpretarCronograma(corpo, mapa, empresas);
    else if (resultado.modo === "empresas") resultado.empresas = interpretarEmpresas(corpo, mapa, empresas);
    return resultado;
  }

  function lerCsv(arquivo) {
    return new Promise(function (resolve, reject) {
      if (!arquivo || !arquivo.size) { reject(new Error("Escolha um arquivo CSV.")); return; }
      if (arquivo.size > MAX_BYTES) { reject(new Error("O CSV excede " + Math.round(MAX_BYTES / 1024 / 1024) + " MB. Divida a planilha em partes menores.")); return; }
      var leitor = new FileReader();
      leitor.onerror = function () { reject(new Error("Não foi possível ler o arquivo selecionado.")); };
      leitor.onload = function () {
        try { resolve(decodificar(leitor.result)); }
        catch (erro) { reject(new Error("Não consegui interpretar o conteúdo do arquivo. Salve-o novamente como CSV UTF-8.")); }
      };
      leitor.readAsArrayBuffer(arquivo);
    });
  }

  /* ================= modelos para download ================= */
  var MODELO_CRONOGRAMA = [
    "Empresa;Fase;Atividade;Tipo;Previsto;Visita agendada;Concluído em;Hora;Responsável;Status;Progresso",
    "Raguso;Cadastros básicos;Cadastro de usuários;Etapa;05/10/2026;;05/10/2026;;Matheus Zanin;Concluído;100%",
    "Raguso;Produtos & Estoque;Inventário inicial;Visita;12/10/2026;13/10/2026;;14:00;Matheus Zanin;Pendente;",
    "Empresa Nova;Fiscal / Cloud;Parametrização fiscal;Etapa;20/10/2026;;;;Equipe Use;Em andamento;40%"
  ].join("\r\n") + "\r\n";

  var MODELO_EMPRESAS = [
    "Empresa;Tipo;Status;Progresso;Status atual;O que já foi feito;O que ainda falta fazer;Outras empresas do grupo;Observação;Atualizado em",
    "Raguso;Nova implantação;Aguardando cliente;50%;Aguardando retorno sobre matéria-prima;Cadastro de usuários | Treinamento inicial;Validação do cadastro de matéria-prima;Filial Sul — pendente Cloud;Contato pelo WhatsApp;09/10/2026",
    "Empresa Nova;Migração Cloud;Em andamento;20%;Servidor provisionado, migrando bases;Levantamento concluído;Migração das bases | Treinamento;;;09/10/2026"
  ].join("\r\n") + "\r\n";

  root.IMPORTAR_CSV = {
    pareceCsv: pareceCsv,
    lerCsv: lerCsv,
    analisarTexto: analisarTexto,
    interpretarCronograma: interpretarCronograma,
    interpretarEmpresas: interpretarEmpresas,
    inferirColunas: inferirColunas,
    acharEmpresa: acharEmpresa,
    dataIso: dataIso,
    horaDe: horaDe,
    statusDe: statusDe,
    progressoDe: progressoDe,
    listaDe: listaDe,
    parseCsv: parseCsv,
    detectarDelimitador: detectarDelimitador,
    maxLinhas: MAX_LINHAS,
    modeloCronograma: MODELO_CRONOGRAMA,
    modeloEmpresas: MODELO_EMPRESAS
  };
})(typeof window !== "undefined" ? window : this);
