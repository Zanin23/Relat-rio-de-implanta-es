/* =====================================================================
   RELATÓRIO DE IMPLANTAÇÕES — aplicação
   ---------------------------------------------------------------------
   · Lê o baseline de dados.js (window.DADOS_INICIAIS)
   · Guarda as alterações no navegador (localStorage) -> cache, abre na hora
   · Sincroniza com o Supabase via sync.js -> o que um altera vale para todos
   · Permite cadastrar novas empresas e atualizar as existentes
   · Exporta/importa JSON (backup) e gera o dados.js para commitar no Git
   · Importa cronograma em PDF e planilhas CSV (agenda ou carteira de empresas)
   · Painel de relatórios em abas: filtros, ordenação, CSV, copiar e imprimir
   ===================================================================== */
(function () {
  "use strict";

  /* ================= CONSTANTES ================= */
  var LS_KEY = "relatorio-implantacoes.v1";
  var LS_TEMA = "relatorio-implantacoes.tema";

  // se o sync.js não estiver carregado (site antigo, cache), o app segue local
  var sync = window.SYNC || {
    iniciar: function () { return Promise.resolve(false); },
    ativo: function () { return false; },
    aoVivo: function () { return false; },
    alterou: function () {},
    estado: function () {
      return { modo: "off", msg: "sync.js não carregou", pendente: false, ultimaSync: 0, linhas: 0, config: { url: "", anonKey: "", table: "documentos" } };
    },
    config: function () { return { url: "", anonKey: "", table: "documentos", completo: false }; },
    sincronizarAgora: function () { return Promise.resolve(false); },
    reconectar: function () { return Promise.resolve(false); },
    forcarPublicacao: function () { return Promise.resolve(false); },
    esquecerConfig: function () { return {}; },
    textoDoArquivoConfig: function () { return ""; },
    substituirTudo: function () { return Promise.resolve(false); }
  };

  var STATUS = {
    cliente:        { label: "Aguardando cliente",        color: "var(--wait)" },
    desenvolvimento:{ label: "Aguardando desenvolvimento",color: "var(--dev)"  },
    andamento:      { label: "Em andamento",              color: "var(--run)"  },
    risco:          { label: "Atenção / risco",           color: "var(--risk)" },
    concluido:      { label: "Concluído",                 color: "var(--ok)"   }
  };
  var STATUS_ORDEM = ["risco", "cliente", "desenvolvimento", "andamento", "concluido"];
  function rotuloStatusCronograma(status) {
    return status === "pendente" ? "Pendente" : (STATUS[status] ? STATUS[status].label : "Status não identificado");
  }

  var TIPOS = ["Nova implantação", "Reimplantação", "Migração Cloud", "Treinamento", "Suporte / ajustes", "Outro"];

  var FASES = ["Cadastros básicos", "Produtos & Estoque", "Comercial / Vendas", "Financeiro & PCP", "Fiscal / Cloud"];
  var FASE_ESTADO = { done: "Concluído", now: "Em andamento", pend: "Pendente", na: "Não previsto" };

  /* ================= ESTADO ================= */
  var db = { data: "", empresas: [] };          // dados ativos
  var tocados = {};                             // ids editados NESTA sessão (desempate de conflito)
  var editando = null;                          // id da empresa em edição
  var pdfImport = { arquivo: "", linhas: [], texto: "", paginas: 0, carregando: false, fonte: "PDF" };
  var csvImport = { arquivo: "", analise: null, linhas: [], modo: "" };   // prévia da carteira vinda de CSV
  var ui = { status: "all", type: "all", q: "", sort: "origem", aberto: null, present: 0 };

  /* ================= HELPERS ================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function hoje() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function br(iso) {
    if (!iso) return "—";
    var p = String(iso).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : String(iso);
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function num(v, padrao) { var n = parseInt(v, 10); return isNaN(n) ? (padrao || 0) : n; }
  function id() { return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // id estável a partir do nome: sem ele, dois navegadores que partiram do
  // mesmo dados.js criariam ids diferentes para a mesma empresa na hora de
  // publicar no servidor (e a empresa apareceria duplicada)
  function chaveNome(v) {
    var s = String(v == null ? "" : v).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s.slice(0, 28);
  }
  function idDeNome(nome) {
    var k = chaveNome(nome) || "empresa";
    var cruza = String(nome || "").trim().toLowerCase();
    var hsh = 5381;
    for (var i = 0; i < cruza.length; i++) hsh = ((hsh << 5) + hsh + cruza.charCodeAt(i)) >>> 0;
    return "n" + k + "-" + hsh.toString(36);
  }

  // normalização usada para não duplicar itens de lista vindos de planilha
  function chaveTexto(v) {
    var s = String(v == null ? "" : v).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s.replace(/[^a-z0-9]+/g, " ").trim();
  }

  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  /* ================= PERSISTÊNCIA ================= */
  function limparEstadoAntes(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    var crono = limparCronograma(v.cronograma);
    var st = STATUS[v.status] ? v.status : (v.status === "pendente" ? "pendente" : "");
    if (!st && crono.length === 0 && !v.statusText && v.progresso == null) return null;
    return {
      status: st,
      progresso: v.progresso == null || v.progresso === "" ? null : clamp(num(v.progresso, 0), 0, 100),
      statusText: String(v.statusText || "").trim().slice(0, 400),
      cronograma: crono,
      atualizado: String(v.atualizado || "").slice(0, 10),
      origem: String(v.origem || "").slice(0, 120)
    };
  }
  function normalizar(e) {
    return {
      id: e.id || (e.nome ? idDeNome(e.nome) : id()),
      nome: String(e.nome || e.name || "Sem nome").trim(),
      tipo: String(e.tipo || e.type || "Outro").trim(),
      status: STATUS[e.status] ? e.status : "andamento",
      progresso: clamp(num(e.progresso != null ? e.progresso : e.progress, 0), 0, 100),
      statusText: String(e.statusText || "").trim(),
      feito: arr(e.feito || e.done),
      falta: arr(e.falta || e.pending),
      grupo: arr(e.grupo || e.subs),
      fases: fases(e.fases || e.phases),
      observacao: String(e.observacao || e.note || "").trim(),
      atualizado: e.atualizado || hoje(),
      historico: hist(e.historico),
      cronograma: limparCronograma(e.cronograma),
      estadoAntesCronograma: limparEstadoAntes(e.estadoAntesCronograma || e.estadoAntesDoCronograma || e.backupPreCronograma || e.cronogramaBackup)
    };
  }
  function limparCronograma(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (item) { return item && typeof item === "object"; }).map(function (item, i) {
      var progresso = item.progresso == null || item.progresso === "" ? null : clamp(num(item.progresso, 0), 0, 100);
      return {
        id: String(item.id || ("crono-" + i + "-" + chaveNome((item.atividade || item.tarefa || item.nome || "item") + "-" + (item.data || item.prazo || "")).slice(0, 20))),
        atividade: String(item.atividade || item.tarefa || item.nome || "Item do cronograma").trim().slice(0, 240),
        fase: String(item.fase || "").trim().slice(0, 120),
        data: String(item.data || item.prazo || "").slice(0, 10),
        visitaData: String(item.visitaData || "").slice(0, 10),
        concluidoEm: String(item.concluidoEm || "").slice(0, 10),
        responsavel: String(item.responsavel || "").trim().slice(0, 120),
        hora: String(item.hora || "").slice(0, 5),
        categoria: item.categoria === "visita" ? "visita" : "etapa",
        status: STATUS[item.status] ? item.status : item.status === "pendente" ? "pendente" : "",
        progresso: progresso,
        origem: String(item.origem || "PDF").slice(0, 120),
        atualizado: String(item.atualizado || hoje()).slice(0, 10)
      };
    }).filter(function (item) { return item.atividade; }).slice(-300);
  }
  function arr(v) {
    if (!v || !Array.isArray(v)) return [];
    return v.map(function (x) {
      return typeof x === "string" ? x.trim()
        : Array.isArray(x) ? (x[0] + (x[1] ? " — " + x[1] : "")).trim()
        : String(x).trim();
    }).filter(Boolean);
  }
  function hist(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (h) { return h && typeof h === "object"; }).map(function (h) {
      return { data: h.data || "", progresso: clamp(num(h.progresso, 0), 0, 100), status: STATUS[h.status] ? h.status : "andamento", texto: String(h.texto || "").slice(0, 90) };
    }).slice(0, 30);
  }
  function fases(v) {
    var out = [];
    for (var i = 0; i < 5; i++) {
      var f = Array.isArray(v) ? v[i] : null;
      var st = f && FASE_ESTADO[f[0]] ? f[0] : "na";
      var txt = f && f[1] ? String(f[1]).slice(0, 60) : "";
      out.push([st, txt]);
    }
    return out;
  }

  function baseline() {
    var b = window.DADOS_INICIAIS || { data: hoje(), empresas: [] };
    return {
      data: b.data || hoje(),
      empresas: (b.empresas || []).map(normalizar)
    };
  }

  var baseArquivo = null;
  function baselineComparavel() {
    if (baseArquivo) return baseArquivo;
    var b = baseline(), porNome = {};
    b.empresas.forEach(function (e) { var k = chaveNome(e.nome); if (k) porNome[k] = e; });
    baseArquivo = { porNome: porNome, data: b.data };
    return baseArquivo;
  }

  function carregar() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return baseline();
      var p = JSON.parse(raw);
      if (!p || !Array.isArray(p.empresas)) return baseline();
      return { data: p.data || hoje(), empresas: p.empresas.map(normalizar) };
    } catch (err) {
      console.warn("Não foi possível ler os dados salvos:", err);
      return baseline();
    }
  }

  function salvar() {
    if (!gravarCache()) return false;
    sync.alterou();          // avisa o sync.js: tem coisa nova para subir
    renderFooter();
    return true;
  }

  // grava a cache do navegador sem pedir o envio (usada quando a mudança veio do servidor)
  function gravarCache() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
      return true;
    } catch (err) {
      toast("Não foi possível salvar neste navegador (armazenamento cheio).");
      return false;
    }
  }

  /* ================= CÁLCULOS ================= */
  function porStatus(k) { return db.empresas.filter(function (e) { return e.status === k; }); }
  function totalFeito() { return db.empresas.reduce(function (a, e) { return a + e.feito.length; }, 0); }
  function totalFalta() { return db.empresas.reduce(function (a, e) { return a + e.falta.length; }, 0); }
  function mediaProgresso() {
    if (!db.empresas.length) return 0;
    return Math.round(db.empresas.reduce(function (a, e) { return a + e.progresso; }, 0) / db.empresas.length);
  }

  function filtradas() {
    var q = ui.q.toLowerCase();
    var lista = db.empresas.filter(function (e) {
      if (ui.status !== "all" && e.status !== ui.status) return false;
      if (ui.type !== "all" && e.tipo !== ui.type) return false;
      if (q) {
        var itensCronogramaBusca = (e.cronograma || []).map(function (item) { return [item.fase, item.atividade, item.responsavel].join(" "); });
        var hay = [e.nome, e.tipo, e.statusText, e.observacao].concat(e.feito, e.falta, e.grupo, itensCronogramaBusca).join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var s = ui.sort;
    if (s === "prog-desc") lista.sort(function (a, b) { return b.progresso - a.progresso; });
    if (s === "prog-asc") lista.sort(function (a, b) { return a.progresso - b.progresso; });
    if (s === "nome") lista.sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
    if (s === "status") lista.sort(function (a, b) {
      return STATUS_ORDEM.indexOf(a.status) - STATUS_ORDEM.indexOf(b.status) || a.nome.localeCompare(b.nome, "pt-BR");
    });
    if (s === "atualizado") lista.sort(function (a, b) {
      return String(b.atualizado).localeCompare(String(a.atualizado)) || a.nome.localeCompare(b.nome, "pt-BR");
    });
    return lista;
  }

  function porId(i) { return db.empresas.find(function (e) { return e.id === i; }); }

  /* ================= RENDER: TOPO / KPIs ================= */
  function renderTopo() {
    $("#dataRel").value = db.data;
    $("#lede").textContent = db.empresas.length
      ? db.empresas.length + (db.empresas.length > 1 ? " carteiras" : " carteira") + " em acompanhamento · " +
        totalFeito() + " itens concluídos · " + totalFalta() + " pendências mapeadas"
      : "Nenhuma empresa cadastrada ainda.";
  }

  function renderKpis() {
    var cards = [
      { v: db.empresas.length, l: "Empresas", c: "" },
      { v: mediaProgresso() + "%", l: "Progresso médio", c: "" },
      { v: porStatus("concluido").length, l: "Concluídas", c: "var(--ok)" },
      { v: porStatus("andamento").length, l: "Em andamento", c: "var(--run)" },
      { v: porStatus("cliente").length, l: "Aguardando cliente", c: "var(--wait)" },
      { v: porStatus("desenvolvimento").length, l: "Aguardando dev", c: "var(--dev)" },
      { v: porStatus("risco").length, l: "Atenção / risco", c: "var(--risk)" }
    ];
    $("#kpis").innerHTML = cards.map(function (c) {
      return '<div class="kpi"><div class="v" style="color:' + (c.c || "var(--txt)") + '">' + c.v + '</div>' +
        '<div class="l">' + c.l + "</div></div>";
    }).join("");
  }

  /* ================= RENDER: GRÁFICOS ================= */
  function renderStatusChart() {
    var total = db.empresas.length || 1;
    var html = STATUS_ORDEM.map(function (k) {
      var n = porStatus(k).length;
      var pct = Math.round(n / total * 100);
      return '<div class="bar-row clickable" data-status="' + k + '" title="Filtrar">' +
        '<div class="bar-label">' + STATUS[k].label + "</div>" +
        '<div class="bar-track"><div class="bar-fill" style="width:' + (n / Math.max.apply(null, STATUS_ORDEM.map(function (x) { return porStatus(x).length; }).concat([1])) * 100) + "%;background:" + STATUS[k].color + '"></div></div>' +
        '<div class="bar-val" style="color:' + STATUS[k].color + '">' + n + " · " + pct + "%</div></div>";
    }).join("");
    $("#statusChart").innerHTML = html || '<p class="none">Sem dados.</p>';
    $$("#statusChart .bar-row").forEach(function (r) {
      r.onclick = function () { setStatus(ui.status === r.dataset.status ? "all" : r.dataset.status); };
    });
  }

  function renderTypeChart() {
    var cores = { "Nova implantação": "var(--run)", "Reimplantação": "var(--ok)", "Migração Cloud": "var(--dev)", "Treinamento": "var(--wait)" };
    var mapa = {};
    db.empresas.forEach(function (e) { mapa[e.tipo] = (mapa[e.tipo] || 0) + 1; });
    var lista = Object.keys(mapa).map(function (t) { return { t: t, n: mapa[t] }; })
      .sort(function (a, b) { return b.n - a.n || a.t.localeCompare(b.t); });
    var max = Math.max.apply(null, lista.map(function (c) { return c.n; }).concat([1]));
    $("#typeChart").innerHTML = lista.length ? lista.map(function (c) {
      return '<div class="bar-row"><div class="bar-label">' + esc(c.t) + "</div>" +
        '<div class="bar-track"><div class="bar-fill" style="width:' + (c.n / max * 100) + "%;background:" + (cores[c.t] || "var(--accent)") + '"></div></div>' +
        '<div class="bar-val">' + c.n + "</div></div>";
    }).join("") : '<p class="none">Sem dados.</p>';

    var cli = porStatus("cliente").length, dev = porStatus("desenvolvimento").length;
    $("#gargalo").innerHTML = db.empresas.length
      ? "<b style='color:var(--wait)'>" + cli + "</b> de " + db.empresas.length + " aguardam retorno, validação ou uso do cliente · " +
        "<b style='color:var(--dev)'>" + dev + "</b> dependem do desenvolvimento."
      : "";
  }

  function itensCronograma() {
    var itens = [];
    db.empresas.forEach(function (e) {
      (e.cronograma || []).forEach(function (item) {
        itens.push({ empresa: e, item: item });
        if (item.visitaData && !(item.categoria === "visita" && item.visitaData === item.data)) {
          var visita = {};
          Object.keys(item).forEach(function (k) { visita[k] = item[k]; });
          visita.data = item.visitaData;
          visita.visitaData = "";
          visita.categoria = "visita";
          visita.atividade = "Visita agendada — " + item.atividade;
          itens.push({ empresa: e, item: visita });
        }
      });
    });
    return itens;
  }

  /* ================= RELATÓRIOS =================
     Um painel só, com abas: cada aba é um recorte diferente da carteira e
     traz filtros próprios, exportação CSV do que está na tela, cópia do
     resumo, impressão de tudo e drill-down (clique na empresa abre a ficha). */

  var LS_REL = "relatorio-implantacoes.rel";

  var rel = {
    aba: "resumo",                                        // aba ativa
    q: "", status: "all", tipo: "all", resp: "all",       // filtros do painel
    per: "todos", origem: "todas", item: "todos",         // filtros por aba
    campo: "progresso", dir: -1,                          // ordenação da tabela
    ver: 8,                                               // itens por grupo (Infinity = todos)
    seguir: false, aberto: true, foco: false
  };

  var FAIXAS_PROGRESSO = [
    { label: "0–25%", min: 0, max: 25 },
    { label: "26–50%", min: 26, max: 50 },
    { label: "51–75%", min: 51, max: 75 },
    { label: "76–99%", min: 76, max: 99 },
    { label: "100%", min: 100, max: 100 }
  ];

  function relSalvarUi() {
    try { localStorage.setItem(LS_REL, JSON.stringify({ aba: rel.aba, aberto: rel.aberto, seguir: rel.seguir })); } catch (e) {}
  }
  function relCarregarUi() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_REL) || "{}");
      if (!s || typeof s !== "object") return;
      if (typeof s.aba === "string" && RELATORIOS.some(function (r) { return r.id === s.aba; })) rel.aba = s.aba;
      if (typeof s.aberto === "boolean") rel.aberto = s.aberto;
      if (typeof s.seguir === "boolean") rel.seguir = s.seguir;
    } catch (e) {}
  }

  /* ---------- datas ---------- */
  function isoData(iso) {
    var p = String(iso || "").slice(0, 10).split("-");
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  function diasEntre(a, b) {
    var da = isoData(a), dbb = isoData(b);
    if (!da || !dbb) return null;
    return Math.round((dbb.getTime() - da.getTime()) / 86400000);
  }
  function pluralDias(n) { return n === 1 ? "1 dia" : n + " dias"; }
  function diaSemana(iso) {
    var d = isoData(iso);
    return d ? ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()] : "";
  }
  function diasSemAtualizar(e) {
    var d = diasEntre(e.atualizado, hoje());
    return d == null ? null : Math.max(0, d);
  }

  /* ---------- recorte de dados ---------- */
  function cronoAbertos(e) { return (e.cronograma || []).filter(function (i) { return i.status !== "concluido"; }).length; }
  function itensAbertosEmpresa(e) { return e.falta.length + cronoAbertos(e); }
  function responsaveisDaEmpresa(e) {
    var out = [];
    (e.cronograma || []).forEach(function (i) {
      if (i.responsavel && out.indexOf(i.responsavel) < 0) out.push(i.responsavel);
    });
    return out;
  }
  function listaResponsaveis() {
    var m = {};
    db.empresas.forEach(function (e) { responsaveisDaEmpresa(e).forEach(function (r) { m[r] = 1; }); });
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });
  }
  function tiposDaCarteira() {
    var out = [];
    db.empresas.forEach(function (e) { if (e.tipo && out.indexOf(e.tipo) < 0) out.push(e.tipo); });
    return out.sort(function (a, b) { return a.localeCompare(b, "pt-BR"); });
  }
  function relEmpresas() {
    var base = rel.seguir ? filtradas() : db.empresas.slice();
    var q = String(rel.q || "").trim().toLowerCase();
    return base.filter(function (e) {
      if (rel.status !== "all" && e.status !== rel.status) return false;
      if (rel.tipo !== "all" && e.tipo !== rel.tipo) return false;
      if (rel.resp !== "all" && responsaveisDaEmpresa(e).indexOf(rel.resp) < 0) return false;
      if (q) {
        var alvo = [e.nome, e.tipo, e.statusText, e.observacao].concat(e.feito, e.falta, e.grupo).join(" ").toLowerCase();
        if (alvo.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function relItens(empresas) {
    var ids = {};
    empresas.forEach(function (e) { ids[e.id] = 1; });
    return itensCronograma().filter(function (r) { return ids[r.empresa.id]; }).map(function (r) {
      var item = r.item;
      return {
        empresa: r.empresa, item: item,
        dias: item.data ? diasEntre(hoje(), item.data) : null,
        vencido: !!item.data && item.status !== "concluido" && item.data < hoje()
      };
    });
  }
  function relPendencias(empresas) {
    var out = [];
    empresas.forEach(function (e) {
      e.falta.forEach(function (t) {
        out.push({ empresa: e, texto: t, origem: "Pendência registrada", chave: "falta", fase: "", data: "", responsavel: "", vencido: false });
      });
      (e.cronograma || []).forEach(function (item) {
        if (item.status === "concluido") return;
        out.push({
          empresa: e, texto: item.atividade,
          origem: item.categoria === "visita" ? "Visita do cronograma" : "Etapa do cronograma",
          chave: item.categoria === "visita" ? "visita" : "etapa",
          fase: item.fase, data: item.data, responsavel: item.responsavel,
          vencido: !!item.data && item.data < hoje()
        });
      });
    });
    return out;
  }
  function relCtx() {
    var empresas = relEmpresas();
    var itens = relItens(empresas);
    return {
      todas: db.empresas, empresas: empresas, itens: itens,
      abertos: itens.filter(function (r) { return r.item.status !== "concluido"; }),
      vencidos: itens.filter(function (r) { return r.vencido; }),
      pend: relPendencias(empresas),
      ver: rel.ver, imprimir: false
    };
  }

  /* ---------- pecas de interface ---------- */
  function metrica(v, l, d, cor) {
    return '<div class="rp-metric"><div class="v"' + (cor ? ' style="color:' + cor + '"' : "") + ">" + v + "</div>" +
      '<div class="l">' + esc(l) + "</div>" + (d ? '<div class="d">' + esc(d) + "</div>" : "") + "</div>";
  }
  function pillStatus(e) {
    var c = STATUS[e.status].color;
    return '<span class="pill" style="--c:' + c + '">' + STATUS[e.status].label + "</span>";
  }
  function linkEmpresa(e) {
    return '<button class="rp-link" data-rel-empresa="' + esc(e.id) + '" title="Abrir a ficha de ' + esc(e.nome) + '">' + esc(e.nome) + "</button>";
  }
  function miniProg(valor, cor) {
    return '<span class="rp-prog"><span class="track" style="--c:' + cor + '"><i style="width:' + valor + '%"></i></span><b>' + valor + "%</b></span>";
  }
  function barraComValor(fracao, cor, texto) {
    return '<span class="rp-prog"><span class="track" style="--c:' + cor + '"><i style="width:' +
      Math.max(0, Math.min(100, fracao)) + '%"></i></span><b>' + esc(texto) + "</b></span>";
  }
  function botaoEditar(e) {
    return '<button class="btn sm ghost" data-rel-editar="' + esc(e.id) + '" title="Editar ' + esc(e.nome) + '">✎</button>';
  }
  function limite(lista, ver) { return ver === Infinity ? lista : lista.slice(0, ver); }
  function maisBtn(total, mostrando, c) {
    if (c.imprimir || total <= 8) return "";
    if (total > mostrando) return '<div class="rp-more"><button class="btn sm ghost" data-rel-mais="1">Ver todos os ' + total + "</button></div>";
    return '<div class="rp-more"><button class="btn sm ghost" data-rel-menos="1">Mostrar menos</button></div>';
  }
  function listaNomes(arr, ver) {
    var n = ver === Infinity ? arr.length : Math.min(arr.length, ver);
    return arr.slice(0, n).join(", ") + (arr.length > n ? " +" + (arr.length - n) : "");
  }
  function corFase(k) {
    return k === "done" ? "var(--ok)" : k === "now" ? "var(--run)" : k === "pend" ? "var(--wait)" : "var(--line2)";
  }
  function pctDe(n, total) { return total ? Math.round(n / total * 100) : 0; }
  function recorteTxt(c) {
    return c.empresas.length === c.todas.length ? "carteira completa" : "de " + c.todas.length + " no total";
  }
  function semDados(msg) { return '<p class="rp-empty">' + esc(msg) + "</p>"; }
  function acaoVazio(botao) {
    var filtrado = relFiltrosAtivos();
    return '<div class="rp-more">' +
      (filtrado ? '<button class="btn sm ghost" data-rel-limpar-filtros>Limpar filtros do relatório</button> ' : "") +
      (botao ? '<button class="btn sm" data-rel-importar>Importar cronograma (PDF/CSV)</button>' : "") +
      "</div>";
  }
  function vazioSemCronograma() {
    return semDados("Nenhum item de cronograma neste recorte. Importe um cronograma em PDF ou uma planilha CSV para preencher esta aba.") +
      acaoVazio(true);
  }
  function linhaEvento(r) {
    var item = r.item;
    var cor = r.vencido ? "var(--risk)" : item.categoria === "visita" ? "var(--dev)" : STATUS[r.empresa.status].color;
    var quando = r.dias != null && item.status !== "concluido"
      ? (r.dias === 0 ? "hoje" : r.dias > 0 ? "em " + pluralDias(r.dias) : "há " + pluralDias(-r.dias))
      : (item.concluidoEm ? "concluído" : "");
    var meta = [].concat(
      item.fase ? [item.fase] : [],
      item.hora ? [item.hora] : [],
      item.responsavel ? ["Resp.: " + item.responsavel] : [],
      [rotuloStatusCronograma(item.status)]
    ).join(" · ");
    return '<div class="rp-ev" style="--c:' + cor + '">' +
      '<span class="data"><b>' + (item.data ? esc(br(item.data)) : "—") + "</b>" +
        (item.data ? "<small>" + esc(diaSemana(item.data)) + "</small>" : "") + "</span>" +
      '<span class="main">' + linkEmpresa(r.empresa) +
        '<span style="display:block;font-size:12px;line-height:1.45;overflow-wrap:anywhere">' + esc(item.atividade) + "</span>" +
        (meta ? '<span style="display:block;font-size:11px;color:var(--muted);margin-top:2px">' + esc(meta) + "</span>" : "") +
      "</span>" +
      '<span class="side">' +
        '<span class="report-badge' + (item.categoria === "visita" ? " visita" : "") + '">' + (item.categoria === "visita" ? "Visita" : "Etapa") + "</span>" +
        (r.vencido ? '<span class="report-badge atrasado">Vencido</span>' : (quando ? '<span class="rp-muted">' + esc(quando) + "</span>" : "")) +
      "</span></div>";
  }

  /* ---------- score de atencao (usado no resumo) ---------- */
  function relCriticos(c) {
    var vencPor = {};
    c.vencidos.forEach(function (r) { vencPor[r.empresa.id] = (vencPor[r.empresa.id] || 0) + 1; });
    return c.empresas.filter(function (e) { return e.status !== "concluido"; }).map(function (e) {
      var dias = diasSemAtualizar(e) || 0;
      var venc = vencPor[e.id] || 0;
      var abertos = itensAbertosEmpresa(e);
      var score = Math.min(dias, 90) + venc * 10 + abertos * 3 + (100 - e.progresso) / 4 +
        (e.status === "risco" ? 70 : e.status === "cliente" ? 18 : e.status === "desenvolvimento" ? 10 : 0);
      return { e: e, dias: dias, venc: venc, abertos: abertos, score: score, motivos: motivosCriticos(e, dias, venc, abertos) };
    }).sort(function (a, b) { return b.score - a.score || a.e.nome.localeCompare(b.e.nome, "pt-BR"); });
  }
  function motivosCriticos(e, dias, venc, abertos) {
    var m = [];
    if (e.status === "risco") m.push("em risco");
    else if (e.status === "cliente") m.push("bola com o cliente");
    else if (e.status === "desenvolvimento") m.push("depende do dev");
    m.push(abertos + (abertos === 1 ? " item em aberto" : " itens em aberto"));
    if (venc) m.push(venc + (venc === 1 ? " prazo vencido" : " prazos vencidos"));
    m.push("atualizado há " + pluralDias(dias));
    return m;
  }

  /* ================= ABAS ================= */
  var RELATORIOS = [
    /* ------------------------------ RESUMO ------------------------------ */
    {
      id: "resumo", nome: "Resumo",
      sub: "Saúde da carteira: progresso, gargalos e o que precisa de atenção agora",
      filtros: ["busca", "status", "tipo", "responsavel"],
      headline: function (c) {
        if (!c.empresas.length) return "nenhuma empresa neste recorte";
        var media = Math.round(c.empresas.reduce(function (a, e) { return a + e.progresso; }, 0) / c.empresas.length);
        return c.empresas.length + " empresas · " + media + "% de progresso médio · " +
          c.vencidos.length + (c.vencidos.length === 1 ? " prazo vencido" : " prazos vencidos");
      },
      render: function (c) {
        if (!c.empresas.length) return semDados("Nenhuma empresa neste recorte.") + acaoVazio(false);
        var emp = c.empresas, total = emp.length;
        var concluidas = emp.filter(function (e) { return e.status === "concluido"; }).length;
        var risco = emp.filter(function (e) { return e.status === "risco"; }).length;
        var paradas = emp.filter(function (e) { var d = diasSemAtualizar(e); return d != null && d >= 30; }).length;
        var media = Math.round(emp.reduce(function (a, e) { return a + e.progresso; }, 0) / total);
        var html = '<div class="rp-metrics">' +
          metrica(total, "Empresas", recorteTxt(c), "") +
          metrica(media + "%", "Progresso médio", total + (total === 1 ? " carteira" : " carteiras"), "") +
          metrica(concluidas, "Concluídas", pctDe(concluidas, total) + "% do recorte", "var(--ok)") +
          metrica(risco, "Atenção / risco", risco ? "pedem decisão" : "nenhuma no momento", risco ? "var(--risk)" : "") +
          metrica(c.pend.length, "Itens em aberto", "pendências + cronograma", "var(--wait)") +
          metrica(c.vencidos.length, "Prazos vencidos", paradas ? paradas + " empresas há 30d+ sem updates" : "nenhum atraso", c.vencidos.length ? "var(--risk)" : "var(--ok)") +
          "</div>";

        var fatias = STATUS_ORDEM.map(function (k) {
          return { k: k, n: emp.filter(function (e) { return e.status === k; }).length };
        }).filter(function (f) { return f.n > 0; });
        html += '<div class="rp-block"><h3>Situação da carteira <small>clique numa fatia para filtrar</small></h3>' +
          '<div class="rp-stack">' + fatias.map(function (f) {
            return '<i style="width:' + (f.n / total * 100) + "%;background:" + STATUS[f.k].color + '" title="' + esc(STATUS[f.k].label + ": " + f.n) + '"></i>';
          }).join("") + "</div>" +
          '<div class="rp-legend">' + fatias.map(function (f) {
            return '<button type="button" data-rel-status="' + f.k + '" title="Filtrar por ' + esc(STATUS[f.k].label) + '">' +
              '<i style="background:' + STATUS[f.k].color + '"></i>' + esc(STATUS[f.k].label) + " <b>" + f.n + "</b></button>";
          }).join("") + "</div></div>";

        var criticos = relCriticos(c);
        var criticosVistos = limite(criticos, c.ver);
        var proximos = c.abertos.filter(function (r) { return r.item.data; })
          .sort(function (a, b) { return String(a.item.data).localeCompare(String(b.item.data)) || String(a.item.hora || "").localeCompare(String(b.item.hora || "")); });
        var proximosVistos = limite(proximos, c.ver);

        html += '<div class="rp-2col">' +
          '<div class="rp-block"><h3>Atenção prioritária <small>risco, atraso e tempo parado</small></h3>' +
          (criticosVistos.length ? '<div class="rp-rows">' + criticosVistos.map(function (s) {
            return '<div class="rp-row"><div class="main">' + linkEmpresa(s.e) +
              '<div class="meta">' + esc(s.motivos.join(" · ")) + "</div>" +
              '<div class="rp-badges">' + pillStatus(s.e) +
                (s.venc ? '<span class="report-badge atrasado">' + s.venc + " vencido" + (s.venc > 1 ? "s" : "") + "</span>" : "") +
                (s.dias >= 30 ? '<span class="report-badge atrasado">há ' + s.dias + " dias parada</span>" : "") +
              "</div></div>" +
              '<div class="side"><b style="font-size:13px;color:' + STATUS[s.e.status].color + '">' + s.e.progresso + '%</b>' +
              '<span class="rp-muted">' + esc(s.e.tipo) + "</span></div></div>";
          }).join("") + "</div>" + maisBtn(criticos.length, criticosVistos.length, c) : semDados("Nada crítico por aqui.")) +
          "</div>" +
          '<div class="rp-block"><h3>Próximos compromissos <small>agenda vinda do cronograma</small></h3>' +
          (proximosVistos.length ? '<div class="rp-rows">' + proximosVistos.map(function (r) { return linhaEvento(r); }).join("") + "</div>" +
            maisBtn(proximos.length, proximosVistos.length, c)
            : vazioSemCronograma()) +
          "</div></div>";
        return html;
      },
      csv: function (c) {
        var vencPor = {};
        c.vencidos.forEach(function (r) { vencPor[r.empresa.id] = (vencPor[r.empresa.id] || 0) + 1; });
        return {
          nome: "resumo-implantacoes",
          cab: ["Empresa", "Tipo", "Status", "Progresso", "Itens concluídos", "Itens em aberto", "Prazos vencidos", "Atualizado em", "Dias sem atualizar", "Prioridade", "Status atual"],
          linhas: relCriticos(c).map(function (s, i) {
            return [s.e.nome, s.e.tipo, STATUS[s.e.status].label, s.e.progresso + "%", s.e.feito.length, s.abertos,
              vencPor[s.e.id] || 0, s.e.atualizado, s.dias, i + 1, s.e.statusText];
          })
        };
      },
      texto: function (c) {
        var linhas = ["Resumo — " + this.headline(c)];
        relCriticos(c).slice(0, 5).forEach(function (s, i) {
          linhas.push((i + 1) + ". " + s.e.nome + " — " + s.e.progresso + "% · " + s.motivos.join(" · "));
        });
        return linhas.join("\n");
      }
    },

    /* ----------------------------- CARTEIRA ----------------------------- */
    {
      id: "carteira", nome: "Carteira",
      sub: "Todas as empresas do recorte, ordenáveis por qualquer coluna",
      filtros: ["busca", "status", "tipo", "responsavel"],
      contagem: function (c) { return c.empresas.length; },
      headline: function (c) {
        return c.empresas.length + (c.empresas.length === 1 ? " empresa" : " empresas") + " · " + recorteTxt(c);
      },
      render: function (c) {
        if (!c.empresas.length) return semDados("Nenhuma empresa neste recorte.") + acaoVazio(false);
        var vencPor = {};
        c.vencidos.forEach(function (r) { vencPor[r.empresa.id] = (vencPor[r.empresa.id] || 0) + 1; });
          var colunas = [
            { c: "nome", t: "Empresa" },
            { c: "status", t: "Status" },
            { c: "progresso", t: "Progresso" },
            { c: "feito", t: "Concluídos", num: true },
            { c: "falta", t: "Em aberto", num: true },
            { c: "agenda", t: "Agenda", num: true },
            { c: "atualizado", t: "Atualização" },
            { c: "", t: "" }
          ];
        var html = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr>' +
          colunas.map(function (col) {
            var ord = rel.campo === col.c ? " ord" + (rel.dir === 1 ? " asc" : "") : "";
            return '<th class="' + (col.num ? "num " : "") + ord.trim() + '"' +
              (col.c ? ' data-rel-ord="' + col.c + '"' : "") + ">" + esc(col.t) + "</th>";
          }).join("") + "</tr></thead><tbody>" +
          ordenarCarteira(c.empresas).map(function (e) {
            var dias = diasSemAtualizar(e);
            var aberto = itensAbertosEmpresa(e);
            var venc = vencPor[e.id] || 0;
            return "<tr>" +
              "<td>" + linkEmpresa(e) + '<span class="rp-muted">' + esc(e.tipo) + "</span></td>" +
              "<td>" + pillStatus(e) + "</td>" +
              "<td>" + miniProg(e.progresso, STATUS[e.status].color) + "</td>" +
              '<td class="num">' + e.feito.length + "</td>" +
              '<td class="num"><b style="color:' + (aberto ? "var(--wait)" : "var(--faint)") + '">' + aberto + "</b></td>" +
              '<td class="num">' + ((e.cronograma || []).length || "—") +
                (venc ? ' <span class="report-badge atrasado">' + venc + " venc.</span>" : "") + "</td>" +
              "<td>" + esc(br(e.atualizado)) + '<span class="rp-muted' + (dias != null && dias >= 30 ? " velho" : "") + '">' +
                (dias == null ? "sem data" : "há " + pluralDias(dias)) + "</span></td>" +
              '<td class="acao">' + botaoEditar(e) + "</td>" +
              "</tr>";
          }).join("") + "</tbody></table></div>" +
          '<p class="rp-note">Clique no nome para abrir a ficha completa, no ✎ para editar e no título de uma coluna para ordenar.</p>';
        return html;
      },
      csv: function (c) {
        var vencPor = {};
        c.vencidos.forEach(function (r) { vencPor[r.empresa.id] = (vencPor[r.empresa.id] || 0) + 1; });
        return {
          nome: "carteira-implantacoes",
          cab: ["Empresa", "Tipo", "Status", "Progresso", "Itens concluídos", "Itens em aberto", "Itens de cronograma", "Prazos vencidos", "Atualizado em", "Dias sem atualizar", "Status atual"],
          linhas: ordenarCarteira(c.empresas).map(function (e) {
            var dias = diasSemAtualizar(e);
            return [e.nome, e.tipo, STATUS[e.status].label, e.progresso + "%", e.feito.length, itensAbertosEmpresa(e),
              (e.cronograma || []).length, vencPor[e.id] || 0, e.atualizado, dias == null ? "" : dias, e.statusText];
          })
        };
      },
      texto: function (c) {
        var linhas = ["Carteira — " + this.headline(c)];
        ordenarCarteira(c.empresas).forEach(function (e) {
          linhas.push("· " + e.nome + " (" + e.tipo + ") — " + e.progresso + "% · " + STATUS[e.status].label +
            " · " + itensAbertosEmpresa(e) + " em aberto");
        });
        return linhas.join("\n");
      }
    },

    /* ---------------------------- PENDENCIAS ---------------------------- */
    {
      id: "pendencias", nome: "Pendências",
      sub: "Tudo o que está em aberto, agrupado por empresa",
      filtros: ["busca", "status", "tipo", "origem", "responsavel"],
      contagem: function (c) { return c.pend.length; },
      alerta: function (c) { return c.vencidos.length > 0; },
      headline: function (c) {
        var empresas = {};
        c.pend.forEach(function (p) { empresas[p.empresa.id] = 1; });
        return c.pend.length + (c.pend.length === 1 ? " item em aberto" : " itens em aberto") + " em " +
          Object.keys(empresas).length + (Object.keys(empresas).length === 1 ? " empresa" : " empresas");
      },
      render: function (c) {
        var itens = c.pend;
        if (rel.origem !== "todas") itens = itens.filter(function (p) { return p.chave === rel.origem; });
        if (!itens.length) return semDados("Nenhuma pendência neste recorte — tudo concluído por aqui.") + acaoVazio(false);
        var grupos = {};
        itens.forEach(function (p) { (grupos[p.empresa.id] = grupos[p.empresa.id] || []).push(p); });
        var lista = Object.keys(grupos).map(function (id) {
          var its = grupos[id];
          return { e: its[0].empresa, itens: its, venc: its.filter(function (p) { return p.vencido; }).length };
        }).sort(function (a, b) {
          return (b.e.status === "risco" ? 1 : 0) - (a.e.status === "risco" ? 1 : 0) ||
            b.itens.length - a.itens.length || a.e.nome.localeCompare(b.e.nome, "pt-BR");
        });
        var vistos = limite(lista, c.ver);
        var html = '<div class="rp-rows">' + vistos.map(function (g, i) {
          return '<details class="rp-group"' + (i < 2 || c.imprimir ? " open" : "") + "><summary>" +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + STATUS[g.e.status].color + ';flex:none"></span>' +
            '<span class="g-nome" title="' + esc(g.e.nome) + '">' + esc(g.e.nome) + "</span>" +
            (g.venc ? '<span class="report-badge atrasado">' + g.venc + " vencido" + (g.venc > 1 ? "s" : "") + "</span>" : "") +
            '<span class="rp-prog" style="width:92px"><span class="track" style="--c:' + STATUS[g.e.status].color + '"><i style="width:' + g.e.progresso + '%"></i></span><b>' + g.e.progresso + "%</b></span>" +
            '<span class="rp-count">' + g.itens.length + (g.itens.length === 1 ? " item" : " itens") + "</span>" +
            pillStatus(g.e) +
            "</summary>" +
            '<div class="g-body">' + g.itens.map(function (p) {
              var meta = [p.origem].concat(p.fase ? [p.fase] : [], p.responsavel ? ["Resp.: " + p.responsavel] : []).join(" · ");
              return '<div class="rp-item ' + esc(p.chave) + '"><span class="dot"></span>' +
                '<span class="txt">' + esc(p.texto) + '<span class="rp-muted">' + esc(meta) + "</span></span>" +
                '<span class="qdo">' + (p.data ? esc(br(p.data)) : "") +
                  (p.vencido ? '<br><span class="report-badge atrasado">Vencido</span>' : "") + "</span></div>";
            }).join("") +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
              '<button class="btn sm ghost" data-rel-empresa="' + esc(g.e.id) + '">Abrir ficha da empresa →</button> ' +
              botaoEditar(g.e) + "</div>" +
            "</div></details>";
        }).join("") + "</div>" + maisBtn(lista.length, vistos.length, c);
        return html;
      },
      csv: function (c) {
        var itens = rel.origem !== "todas" ? c.pend.filter(function (p) { return p.chave === rel.origem; }) : c.pend;
        return {
          nome: "pendencias-implantacoes",
          cab: ["Empresa", "Status da empresa", "Progresso", "Origem", "Fase", "Item", "Previsto", "Responsável", "Vencido"],
          linhas: itens.map(function (p) {
            return [p.empresa.nome, STATUS[p.empresa.status].label, p.empresa.progresso + "%", p.origem, p.fase,
              p.texto, p.data ? br(p.data) : "", p.responsavel, p.vencido ? "Sim" : "Não"];
          })
        };
      },
      texto: function (c) {
        var linhas = ["Pendências — " + this.headline(c)];
        c.pend.slice(0, 30).forEach(function (p) {
          linhas.push("· " + p.empresa.nome + ": " + p.texto + (p.vencido ? " (VENCIDO " + br(p.data) + ")" : ""));
        });
        return linhas.join("\n");
      }
    },

    /* ------------------------------ AGENDA ------------------------------ */
    {
      id: "agenda", nome: "Agenda",
      sub: "Etapas e visitas do cronograma, dos atrasados para os próximos",
      filtros: ["busca", "periodo", "item", "responsavel"],
      contagem: function (c) { return c.abertos.length; },
      alerta: function (c) { return c.vencidos.length > 0; },
      headline: function (c) {
        var visitas = c.abertos.filter(function (r) { return r.item.categoria === "visita"; }).length;
        return c.abertos.length + (c.abertos.length === 1 ? " compromisso em aberto" : " compromissos em aberto") +
          " · " + c.vencidos.length + " vencidos · " + visitas + (visitas === 1 ? " visita" : " visitas");
      },
      render: function (c) {
        var itens = c.itens.slice();
        if (rel.per === "vencidos") itens = itens.filter(function (r) { return r.vencido; });
        else if (rel.per === "semana") itens = itens.filter(function (r) { return r.item.status !== "concluido" && r.dias != null && r.dias >= 0 && r.dias <= 7; });
        else if (rel.per === "mes") itens = itens.filter(function (r) { return r.item.status !== "concluido" && r.dias != null && r.dias >= 0 && r.dias <= 30; });
        else if (rel.per === "concluidos") itens = itens.filter(function (r) { return r.item.status === "concluido"; });
        else if (rel.per === "semdata") itens = itens.filter(function (r) { return !r.item.data; });
        if (rel.item === "visitas") itens = itens.filter(function (r) { return r.item.categoria === "visita"; });
        else if (rel.item === "etapas") itens = itens.filter(function (r) { return r.item.categoria !== "visita"; });
        if (!itens.length) return vazioSemCronograma();
        var grupos = [
          { t: "Vencidos", critico: true, f: function (r) { return r.vencido; } },
          { t: "Hoje", f: function (r) { return r.item.status !== "concluido" && r.dias === 0; } },
          { t: "Próximos 7 dias", f: function (r) { return r.item.status !== "concluido" && r.dias != null && r.dias > 0 && r.dias <= 7; } },
          { t: "De 8 a 30 dias", f: function (r) { return r.item.status !== "concluido" && r.dias != null && r.dias > 7 && r.dias <= 30; } },
          { t: "Mais de 30 dias", f: function (r) { return r.item.status !== "concluido" && r.dias != null && r.dias > 30; } },
          { t: "Concluídos", f: function (r) { return r.item.status === "concluido"; } },
          { t: "Sem data definida", f: function (r) { return !r.item.data; } }
        ];
        var html = "";
        grupos.forEach(function (g) {
          var doGrupo = itens.filter(g.f).sort(function (a, b) {
            return String(a.item.data || "9999-99-99").localeCompare(String(b.item.data || "9999-99-99")) ||
              String(a.item.hora || "").localeCompare(String(b.item.hora || ""));
          });
          if (!doGrupo.length) return;
          var vistos = limite(doGrupo, c.ver);
          html += '<div class="rp-tl-group"><h4 class="rp-tl-head' + (g.critico ? " critico" : "") + '">' + g.t +
            ' <span class="n">' + doGrupo.length + "</span></h4>" +
            '<div class="rp-tl-items">' + vistos.map(function (r) { return linhaEvento(r); }).join("") + "</div>" +
            maisBtn(doGrupo.length, vistos.length, c) + "</div>";
        });
        return html;
      },
      csv: function (c) {
        var itens = c.itens;
        if (rel.per === "vencidos") itens = itens.filter(function (r) { return r.vencido; });
        else if (rel.per === "semana") itens = itens.filter(function (r) { return r.item.status !== "concluido" && r.dias != null && r.dias >= 0 && r.dias <= 7; });
        else if (rel.per === "mes") itens = itens.filter(function (r) { return r.item.status !== "concluido" && r.dias != null && r.dias >= 0 && r.dias <= 30; });
        else if (rel.per === "concluidos") itens = itens.filter(function (r) { return r.item.status === "concluido"; });
        else if (rel.per === "semdata") itens = itens.filter(function (r) { return !r.item.data; });
        if (rel.item !== "todos") itens = itens.filter(function (r) { return rel.item === "visitas" ? r.item.categoria === "visita" : r.item.categoria !== "visita"; });
        return {
          nome: "agenda-visitas-cronograma",
          cab: ["Empresa", "Fase", "Atividade", "Tipo", "Previsto", "Visita agendada", "Concluído em", "Hora", "Responsável", "Status", "Progresso", "Situação", "Origem"],
          linhas: itens.map(function (r) {
            var i = r.item;
            return [r.empresa.nome, i.fase, i.atividade, i.categoria === "visita" ? "Visita" : "Etapa",
              i.data ? br(i.data) : "", i.visitaData ? br(i.visitaData) : "", i.concluidoEm ? br(i.concluidoEm) : "",
              i.hora || "", i.responsavel || "", rotuloStatusCronograma(i.status),
              i.progresso == null ? "" : i.progresso + "%", r.vencido ? "Vencido" : r.dias === 0 ? "Hoje" : "", i.origem];
          })
        };
      },
      texto: function (c) {
        var linhas = ["Agenda — " + this.headline(c)];
        c.abertos.slice().sort(function (a, b) {
          return String(a.item.data || "9999-99-99").localeCompare(String(b.item.data || "9999-99-99"));
        }).slice(0, 20).forEach(function (r) {
          linhas.push("· " + (r.item.data ? br(r.item.data) : "sem data") + " — " + r.empresa.nome + ": " + r.item.atividade +
            (r.vencido ? " (VENCIDO)" : ""));
        });
        return linhas.join("\n");
      }
    },

    /* ------------------------------ FASES ------------------------------- */
    {
      id: "fases", nome: "Fases",
      sub: "Funil da matriz: quanto de cada etapa já foi concluído na carteira",
      filtros: ["busca", "status", "tipo"],
      headline: function (c) {
        var done = 0, previstas = 0;
        c.empresas.forEach(function (e) {
          e.fases.forEach(function (f) { if (f[0] === "done") done++; if (f[0] !== "na") previstas++; });
        });
        return done + " de " + previstas + " etapas concluídas" + (previstas ? " (" + pctDe(done, previstas) + "%)" : "");
      },
      render: function (c) {
        if (!c.empresas.length) return semDados("Nenhuma empresa neste recorte.") + acaoVazio(false);
        var html = '<div class="rp-funnel">' + FASES.map(function (nome, i) {
          var cont = { done: 0, now: 0, pend: 0, na: 0 };
          var quem = { done: [], now: [], pend: [] };
          c.empresas.forEach(function (e) {
            var f = e.fases[i] || ["na", ""];
            if (cont[f[0]] == null) cont[f[0]] = 0;
            cont[f[0]]++;
            if (quem[f[0]]) quem[f[0]].push(e.nome);
          });
          var previstas = cont.done + cont.now + cont.pend;
          return '<div class="rp-fase">' +
            '<span class="nome"><span class="i">' + (i + 1) + "</span>" + esc(nome) + "</span>" +
            '<span class="rp-stack">' + ["done", "now", "pend", "na"].map(function (k) {
              return cont[k] ? '<i style="width:' + (cont[k] / c.empresas.length * 100) + "%;background:" + corFase(k) + '"></i>' : "";
            }).join("") + "</span>" +
            '<span class="val"><b>' + cont.done + "</b>/" + previstas + " · " + pctDe(cont.done, previstas) + "%</span>" +
            (quem.pend.length ? '<span class="quem">Pendente em: ' + esc(listaNomes(quem.pend, c.ver)) + "</span>" : "") +
            "</div>";
        }).join("") + "</div>" +
          '<div class="rp-legend">' + ["done", "now", "pend", "na"].map(function (k) {
            return '<span><i style="background:' + corFase(k) + '"></i>' + FASE_ESTADO[k] + "</span>";
          }).join("") + "</div>" +
          '<p class="rp-note">A matriz completa, empresa por empresa, continua logo abaixo nesta página.</p>';
        return html;
      },
      csv: function (c) {
        return {
          nome: "matriz-fases-implantacoes",
          cab: ["Empresa", "Tipo", "Status", "Progresso"].concat(FASES),
          linhas: c.empresas.map(function (e) {
            return [e.nome, e.tipo, STATUS[e.status].label, e.progresso + "%"].concat(e.fases.map(function (f) {
              return FASE_ESTADO[f[0]] + (f[1] ? " — " + f[1] : "");
            }));
          })
        };
      },
      texto: function (c) {
        var linhas = ["Fases — " + this.headline(c)];
        FASES.forEach(function (nome, i) {
          var cont = { done: 0, now: 0, pend: 0, na: 0 };
          c.empresas.forEach(function (e) { cont[(e.fases[i] || ["na"])[0]]++; });
          linhas.push("· " + nome + ": " + cont.done + " concluídas, " + cont.now + " em andamento, " + cont.pend + " pendentes, " + cont.na + " não previstas");
        });
        return linhas.join("\n");
      }
    },

    /* --------------------------- RESPONSAVEIS --------------------------- */
    {
      id: "responsaveis", nome: "Responsáveis",
      sub: "Carga de cada pessoa nas etapas e visitas do cronograma",
      filtros: ["busca", "responsavel"],
      contagem: function (c) { return listaResponsaveis().length; },
      headline: function (c) {
        var abertos = c.abertos.length;
        return listaResponsaveis().length + (listaResponsaveis().length === 1 ? " responsável" : " responsáveis") +
          " · " + abertos + (abertos === 1 ? " item em aberto" : " itens em aberto");
      },
      render: function (c) {
        var mapa = {};
        c.empresas.forEach(function (e) {
          (e.cronograma || []).forEach(function (i) {
            var nome = i.responsavel || "Sem responsável";
            var m = mapa[nome] = mapa[nome] || { nome: nome, empresas: {}, abertos: 0, vencidos: 0, visitas: 0, concluidos: 0 };
            m.empresas[e.id] = e.nome;
            if (i.status === "concluido") m.concluidos++;
            else {
              m.abertos++;
              if (i.data && i.data < hoje()) m.vencidos++;
              if (i.categoria === "visita") m.visitas++;
            }
          });
        });
        var lista = Object.keys(mapa).map(function (k) { return mapa[k]; })
          .sort(function (a, b) { return b.abertos - a.abertos || a.nome.localeCompare(b.nome, "pt-BR"); });
        if (!lista.length) return vazioSemCronograma();
        var max = Math.max.apply(null, lista.map(function (m) { return m.abertos; }).concat([1]));
        var html = '<div class="rp-table-wrap"><table class="rp-table"><thead><tr>' +
          "<th>Responsável</th><th>Empresas</th><th>Em aberto</th><th class=\"num\">Vencidos</th>" +
          '<th class="num">Visitas</th><th class="num">Concluídos</th></tr></thead><tbody>' +
          lista.map(function (m) {
            var nomes = Object.keys(m.empresas).map(function (k) { return m.empresas[k]; });
            var filtravel = m.nome !== "Sem responsável";
            return "<tr>" +
              "<td>" + (filtravel
                ? '<button class="rp-link" data-rel-resp="' + esc(m.nome) + '" title="Filtrar o painel por ' + esc(m.nome) + '">' + esc(m.nome) + "</button>"
                : '<span style="color:var(--muted)">' + esc(m.nome) + "</span>") + "</td>" +
              '<td class="num">' + nomes.length + '<span class="rp-muted" title="' + esc(nomes.join(", ")) + '">' + esc(listaNomes(nomes, 2)) + "</span></td>" +
              "<td>" + barraComValor(m.abertos / max * 100, m.vencidos ? "var(--risk)" : "var(--accent)", m.abertos) +
                '<span class="rp-muted" style="display:inline">itens em aberto</span></td>' +
              '<td class="num"><b style="color:' + (m.vencidos ? "var(--risk)" : "var(--faint)") + '">' + m.vencidos + "</b></td>" +
              '<td class="num">' + m.visitas + "</td>" +
              '<td class="num">' + m.concluidos + "</td>" +
              "</tr>";
          }).join("") + "</tbody></table></div>" +
          '<p class="rp-note">Clique no nome para filtrar todo o painel por esse responsável. A coluna “Em aberto” é proporcional à maior carga da equipe.</p>';
        return html;
      },
      csv: function (c) {
        var mapa = {};
        c.empresas.forEach(function (e) {
          (e.cronograma || []).forEach(function (i) {
            var nome = i.responsavel || "Sem responsável";
            var m = mapa[nome] = mapa[nome] || { nome: nome, empresas: {}, abertos: 0, vencidos: 0, visitas: 0, concluidos: 0 };
            m.empresas[e.id] = e.nome;
            if (i.status === "concluido") m.concluidos++;
            else {
              m.abertos++;
              if (i.data && i.data < hoje()) m.vencidos++;
              if (i.categoria === "visita") m.visitas++;
            }
          });
        });
        return {
          nome: "carga-por-responsavel",
          cab: ["Responsável", "Empresas atendidas", "Empresas", "Itens em aberto", "Prazos vencidos", "Visitas em aberto", "Itens concluídos"],
          linhas: Object.keys(mapa).sort().map(function (k) {
            var m = mapa[k];
            var nomes = Object.keys(m.empresas).map(function (i) { return m.empresas[i]; });
            return [m.nome, nomes.length, nomes.join(", "), m.abertos, m.vencidos, m.visitas, m.concluidos];
          })
        };
      },
      texto: function (c) {
        var linhas = ["Responsáveis — " + this.headline(c)];
        var mapa = {};
        c.empresas.forEach(function (e) {
          (e.cronograma || []).forEach(function (i) {
            var nome = i.responsavel || "Sem responsável";
            var m = mapa[nome] = mapa[nome] || { abertos: 0, vencidos: 0 };
            if (i.status !== "concluido") { m.abertos++; if (i.data && i.data < hoje()) m.vencidos++; }
          });
        });
        Object.keys(mapa).sort().forEach(function (k) {
          linhas.push("· " + k + ": " + mapa[k].abertos + " em aberto, " + mapa[k].vencidos + " vencidos");
        });
        return linhas.join("\n");
      }
    },

    /* ----------------------------- EVOLUCAO ----------------------------- */
    {
      id: "evolucao", nome: "Evolução",
      sub: "Faixas de progresso, empresas paradas no tempo e últimas movimentações",
      filtros: ["busca", "status", "tipo"],
      headline: function (c) {
        var velhas = c.empresas.filter(function (e) { var d = diasSemAtualizar(e); return d != null && d >= 30; }).length;
        return mediaProgressoRecorte(c) + "% de progresso médio · " + velhas + (velhas === 1 ? " empresa" : " empresas") + " há 30 dias ou mais sem atualização";
      },
      render: function (c) {
        if (!c.empresas.length) return semDados("Nenhuma empresa neste recorte.") + acaoVazio(false);
        var total = c.empresas.length;
        var contagens = FAIXAS_PROGRESSO.map(function (f) {
          return c.empresas.filter(function (e) { var p = e.status === "concluido" ? 100 : e.progresso; return p >= f.min && p <= f.max; }).length;
        });
        var maxFaixa = Math.max.apply(null, contagens.concat([1]));
        var html = '<div class="rp-block"><h3>Faixas de progresso</h3><div class="rp-funnel">' +
          FAIXAS_PROGRESSO.map(function (f, i) {
            return '<div class="rp-fase"><span class="nome"><span class="i">' + f.label + "</span></span>" +
              '<span class="rp-stack"><i style="width:' + (contagens[i] / maxFaixa * 100) + '%;background:var(--accent)"></i></span>' +
              '<span class="val"><b>' + contagens[i] + "</b> · " + pctDe(contagens[i], total) + "%</span></div>";
          }).join("") + "</div>" +
          '<p class="rp-note">Média do recorte: <b>' + mediaProgressoRecorte(c) + "%</b> · " +
          c.empresas.filter(function (e) { return e.status === "concluido"; }).length + " concluídas de " + total + ".</p></div>";

        var paradas = c.empresas.map(function (e) { return { e: e, dias: diasSemAtualizar(e) || 0 }; })
          .filter(function (r) { return r.e.status !== "concluido"; })
          .sort(function (a, b) { return b.dias - a.dias || a.e.nome.localeCompare(b.e.nome, "pt-BR"); });
        var paradasVistas = limite(paradas, c.ver);
        html += '<div class="rp-2col"><div class="rp-block"><h3>Há quanto tempo não atualiza</h3>' +
          (paradasVistas.length ? '<div class="rp-rows">' + paradasVistas.map(function (r) {
            return '<div class="rp-row"><div class="main">' + linkEmpresa(r.e) +
              '<div class="meta">' + esc(STATUS[r.e.status].label) + " · " + r.e.progresso + "% · " + r.e.falta.length + " pendências registradas</div></div>" +
              '<div class="side"><b style="font-size:12.5px;color:' + (r.dias >= 30 ? "var(--risk)" : r.dias >= 14 ? "var(--wait)" : "var(--muted)") + '">' +
                pluralDias(r.dias) + '</b><span class="rp-muted">' + esc(br(r.e.atualizado)) + "</span></div></div>";
          }).join("") + "</div>" + maisBtn(paradas.length, paradasVistas.length, c) : semDados("Tudo atualizado.")) + "</div>";

        var mov = [];
        c.empresas.forEach(function (e) {
          e.historico.forEach(function (h) { mov.push({ e: e, h: h }); });
        });
        mov.sort(function (a, b) { return String(b.h.data).localeCompare(String(a.h.data)); });
        var movVistas = limite(mov, c.ver);
        html += '<div class="rp-block"><h3>Últimas movimentações <small>histórico salvo a cada edição</small></h3>' +
          (movVistas.length ? '<div class="rp-rows">' + movVistas.map(function (m) {
            return '<div class="rp-row"><div class="main">' + linkEmpresa(m.e) +
              '<div class="meta">' + esc(m.h.progresso + "% · " + (STATUS[m.h.status] ? STATUS[m.h.status].label : m.h.status)) +
                (m.h.texto ? " — " + esc(m.h.texto) : "") + "</div></div>" +
              '<div class="side"><span class="rp-muted">' + esc(br(m.h.data)) + "</span></div></div>";
          }).join("") + "</div>" + maisBtn(mov.length, movVistas.length, c)
            : semDados("Nenhuma edição registrada ainda — o histórico aparece depois do primeiro salvamento.")) +
          "</div></div>";
        return html;
      },
      csv: function (c) {
        return {
          nome: "evolucao-implantacoes",
          cab: ["Empresa", "Tipo", "Status", "Progresso", "Faixa", "Atualizado em", "Dias sem atualizar", "Última movimentação", "Progresso anterior", "Status anterior"],
          linhas: c.empresas.map(function (e) {
            var h = e.historico[0];
            var p = e.status === "concluido" ? 100 : e.progresso;
            var faixa = FAIXAS_PROGRESSO.filter(function (f) { return p >= f.min && p <= f.max; })[0];
            return [e.nome, e.tipo, STATUS[e.status].label, p + "%", faixa ? faixa.label : "", e.atualizado,
              diasSemAtualizar(e) == null ? "" : diasSemAtualizar(e), h ? h.data : "", h ? h.progresso + "%" : "",
              h ? (STATUS[h.status] ? STATUS[h.status].label : h.status) : ""];
          })
        };
      },
      texto: function (c) {
        var linhas = ["Evolução — " + this.headline(c)];
        c.empresas.slice().sort(function (a, b) { return b.progresso - a.progresso; }).forEach(function (e) {
          var d = diasSemAtualizar(e);
          linhas.push("· " + e.nome + ": " + e.progresso + "% · " + STATUS[e.status].label + " · atualizado há " + pluralDias(d || 0));
        });
        return linhas.join("\n");
      }
    }
  ];

  function mediaProgressoRecorte(c) {
    if (!c.empresas.length) return 0;
    return Math.round(c.empresas.reduce(function (a, e) { return a + e.progresso; }, 0) / c.empresas.length);
  }

  function relAtual() {
    return RELATORIOS.filter(function (r) { return r.id === rel.aba; })[0] || RELATORIOS[0];
  }

  function ordenarCarteira(lista) {
    var campo = rel.campo, dir = rel.dir;
    return lista.slice().sort(function (a, b) {
      var va, vb;
      if (campo === "nome") { va = a.nome.toLowerCase(); vb = b.nome.toLowerCase(); }
      else if (campo === "tipo") { va = a.tipo.toLowerCase(); vb = b.tipo.toLowerCase(); }
      else if (campo === "status") { va = STATUS_ORDEM.indexOf(a.status); vb = STATUS_ORDEM.indexOf(b.status); }
      else if (campo === "progresso") { va = a.progresso; vb = b.progresso; }
      else if (campo === "feito") { va = a.feito.length; vb = b.feito.length; }
      else if (campo === "falta") { va = itensAbertosEmpresa(a); vb = itensAbertosEmpresa(b); }
      else if (campo === "agenda") { va = (a.cronograma || []).length; vb = (b.cronograma || []).length; }
      else { va = String(a.atualizado || ""); vb = String(b.atualizado || ""); }
      if (typeof va === "string") return va.localeCompare(vb, "pt-BR") * dir || a.nome.localeCompare(b.nome, "pt-BR");
      return (va - vb) * dir || a.nome.localeCompare(b.nome, "pt-BR");
    });
  }

  /* ---------- filtros do painel ---------- */
  function relFiltrosAtivos() {
    return !!(String(rel.q || "").trim() || rel.status !== "all" || rel.tipo !== "all" || rel.resp !== "all" ||
      rel.origem !== "todas" || rel.item !== "todos" || rel.per !== "todos");
  }
  function relLimparFiltros() {
    rel.q = ""; rel.status = "all"; rel.tipo = "all"; rel.resp = "all";
    rel.origem = "todas"; rel.item = "todos"; rel.per = "todos"; rel.ver = 8;
  }
  function selectFiltro(id, rotulo, opcoes, valor) {
    return (rotulo ? '<span class="lbl">' + esc(rotulo) + "</span>" : "") +
      '<select id="' + id + '">' + opcoes.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(valor) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select>";
  }

  function renderFiltrosRel(c) {
    var box = $("#reportFilters");
    if (!box) return;
    var quais = relAtual().filtros || [];
    var html = "";
    if (quais.indexOf("busca") >= 0) {
      html += '<input type="text" id="relQ" placeholder="Filtrar este relatório…" value="' + esc(rel.q) + '">';
    }
    if (quais.indexOf("status") >= 0) {
      html += selectFiltro("relStatus", "", [["all", "Todos os status"]].concat(STATUS_ORDEM.map(function (k) { return [k, STATUS[k].label]; })), rel.status);
    }
    if (quais.indexOf("tipo") >= 0) {
      html += selectFiltro("relTipo", "", [["all", "Todos os tipos"]].concat(tiposDaCarteira().map(function (t) { return [t, t]; })), rel.tipo);
    }
    if (quais.indexOf("origem") >= 0) {
      html += selectFiltro("relOrigem", "Origem", [["todas", "Todas as origens"], ["falta", "Pendência registrada"], ["etapa", "Etapa do cronograma"], ["visita", "Visita agendada"]], rel.origem);
    }
    if (quais.indexOf("periodo") >= 0) {
      html += selectFiltro("relPer", "Período", [["todos", "Qualquer data"], ["vencidos", "Só vencidos"], ["semana", "Próximos 7 dias"],
        ["mes", "Próximos 30 dias"], ["concluidos", "Concluídos"], ["semdata", "Sem data"]], rel.per);
    }
    if (quais.indexOf("item") >= 0) {
      html += selectFiltro("relItem", "Tipo", [["todos", "Etapas e visitas"], ["visitas", "Só visitas"], ["etapas", "Só etapas"]], rel.item);
    }
    if (quais.indexOf("responsavel") >= 0) {
      var reps = listaResponsaveis();
      if (reps.length) {
        html += selectFiltro("relResp", "Responsável", [["all", "Todos os responsáveis"]].concat(reps.map(function (r) { return [r, r]; })), rel.resp);
      }
    }
    if (relFiltrosAtivos()) html += '<button class="btn sm ghost" id="relLimpar" title="Limpar os filtros do relatório">Limpar filtros</button>';
    box.innerHTML = html;

    var q = $("#relQ");
    if (q) {
      q.oninput = function () { rel.q = this.value; rel.ver = 8; rel.foco = true; renderReports(); };
      if (rel.foco) {
        rel.foco = false;
        q.focus();
        try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) {}
      }
    }
    var ligar = function (id, chave) {
      var el = $("#" + id);
      if (!el) return;
      el.onchange = function () { rel[chave] = this.value; rel.ver = 8; renderReports(); };
    };
    ligar("relStatus", "status"); ligar("relTipo", "tipo"); ligar("relOrigem", "origem");
    ligar("relPer", "per"); ligar("relItem", "item"); ligar("relResp", "resp");
    var limpar = $("#relLimpar");
    if (limpar) limpar.onclick = function () { relLimparFiltros(); renderReports(); };
  }

  function renderAbasRel(c) {
    var box = $("#reportTabs");
    if (!box) return;
    box.innerHTML = RELATORIOS.map(function (r) {
      var n = r.contagem ? r.contagem(c) : null;
      // zero só aparece quando é informação útil (pendências em aberto); o resto fica limpo
      if (n === 0 && r.id !== "pendencias") n = null;
      var alerta = r.alerta && r.alerta(c) ? " alerta" : "";
      var cls = "rp-tab" + (r.id === rel.aba ? " on" : "") + alerta;
      return '<button type="button" class="' + cls + '" data-rel-tab="' + r.id + '" role="tab" aria-selected="' +
        (r.id === rel.aba ? "true" : "false") + '" title="' + esc(r.sub) + '">' + esc(r.nome) +
        (n == null ? "" : '<span class="n">' + esc(n) + "</span>") + "</button>";
    }).join("");
  }

  function renderReports() {
    var painel = $("#reportPanel");
    if (!painel) return;
    var c = relCtx();
    var rep = relAtual();

    painel.classList.toggle("fechado", !rel.aberto);
    var toggle = $("#btnReportToggle");
    if (toggle) {
      toggle.textContent = rel.aberto ? "▾" : "▸";
      toggle.title = rel.aberto ? "Recolher o painel de relatórios" : "Expandir o painel de relatórios";
      toggle.setAttribute("aria-expanded", rel.aberto ? "true" : "false");
    }
    var follow = $("#reportFollow");
    if (follow) follow.checked = !!rel.seguir;

    var sub = $("#reportHeadSub");
    if (sub) sub.innerHTML = esc(rep.nome) + " · " + esc(rep.headline(c));

    if (!rel.aberto) return;

    renderAbasRel(c);
    renderFiltrosRel(c);

    var stage = $("#reportStage");
    if (stage) stage.innerHTML = rep.render(c);

    var pe = $("#reportFoot");
    if (pe) {
      var filtros = [];
      if (rel.seguir) filtros.push("seguindo os filtros da tela");
      if (rel.status !== "all" && STATUS[rel.status]) filtros.push(STATUS[rel.status].label);
      if (rel.tipo !== "all") filtros.push(rel.tipo);
      if (rel.resp !== "all") filtros.push("resp.: " + rel.resp);
      if (rel.origem !== "todas") filtros.push(rel.origem === "falta" ? "só pendências registradas" : rel.origem === "visita" ? "só visitas" : "só etapas do cronograma");
      if (rel.per !== "todos") filtros.push("período: " + rel.per);
      if (rel.item !== "todos") filtros.push(rel.item === "visitas" ? "só visitas" : "só etapas");
      if (String(rel.q || "").trim()) filtros.push('busca "' + String(rel.q).trim() + '"');
      pe.innerHTML = "<span>" + esc(rep.sub) + "</span><span>" +
        esc(c.empresas.length + " de " + c.todas.length + " empresas" + (filtros.length ? " · " + filtros.join(" · ") : " · sem filtros")) +
        " · levantamento de " + esc(br(db.data)) + "</span>";
    }

    ligarRelatorio();
  }

  function ligarRelatorio() {
    $$("[data-rel-empresa]").forEach(function (b) {
      b.onclick = function () { abrirDetalhe(b.dataset.relEmpresa); };
    });
    $$("[data-rel-tab]").forEach(function (b) {
      b.onclick = function () { rel.aba = b.dataset.relTab; rel.ver = 8; relSalvarUi(); renderReports(); };
    });
    $$("[data-rel-ord]").forEach(function (th) {
      th.onclick = function () {
        var campo = th.dataset.relOrd;
        if (rel.campo === campo) rel.dir = -rel.dir;
        else { rel.campo = campo; rel.dir = (campo === "nome" || campo === "tipo" || campo === "status") ? 1 : -1; }
        renderReports();
      };
    });
    $$("[data-rel-mais]").forEach(function (b) { b.onclick = function () { rel.ver = Infinity; renderReports(); }; });
    $$("[data-rel-menos]").forEach(function (b) { b.onclick = function () { rel.ver = 8; renderReports(); }; });
    $$("[data-rel-status]").forEach(function (b) {
      b.onclick = function () { rel.status = rel.status === b.dataset.relStatus ? "all" : b.dataset.relStatus; renderReports(); };
    });
    $$("[data-rel-resp]").forEach(function (b) {
      b.onclick = function () { rel.resp = rel.resp === b.dataset.relResp ? "all" : b.dataset.relResp; renderReports(); };
    });
    $$("[data-rel-editar]").forEach(function (b) {
      b.onclick = function () { abrirEditor(b.dataset.relEditar); };
    });
    $$("[data-rel-limpar-filtros]").forEach(function (b) {
      b.onclick = function () { relLimparFiltros(); renderReports(); };
    });
    var imp = $("[data-rel-importar]");
    if (imp) imp.onclick = abrirImportadorCronograma;
  }

  /* ---------- ações do painel (CSV, copiar, imprimir) ---------- */
  function exportarRelatorioCsv() {
    var c = relCtx();
    var rep = relAtual();
    var exp = rep.csv ? rep.csv(c) : null;
    if (!exp || !exp.linhas || !exp.linhas.length) { toast("Este relatório não tem linhas para exportar."); return; }
    baixarRelatorioCsv(exp.nome, exp.cab, exp.linhas);
  }

  function textoRelatorio() {
    var c = relCtx();
    var rep = relAtual();
    return "Relatório de implantações — " + rep.nome + "\n" +
      "Levantamento de " + br(db.data) + " · gerado em " + br(hoje()) + "\n" +
      rep.headline(c) + "\n\n" + (rep.texto ? rep.texto(c) : "");
  }

  function copiarRelatorio() {
    var txt = textoRelatorio();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () {
        toast("Resumo copiado — cole no WhatsApp, e-mail ou planilha.");
      }, function () { copiarTextoAntigo(txt); });
      return;
    }
    copiarTextoAntigo(txt);
  }
  function copiarTextoAntigo(txt) {
    var ta = document.createElement("textarea");
    ta.value = txt;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    toast(ok ? "Resumo copiado." : "Não foi possível copiar — use o CSV ou a impressão.");
  }

  function imprimirRelatorios() {
    var c = relCtx();
    c.ver = Infinity;
    c.imprimir = true;
    var box = $("#reportPrintAll");
    if (!box) return;
    box.innerHTML = RELATORIOS.map(function (r) {
      return '<section class="print-rep"><h2>' + esc(r.nome) + "</h2>" +
        '<p class="sub">' + esc(r.sub) + " · " + esc(r.headline(c)) + "</p>" + r.render(c) + "</section>";
    }).join("");
    document.body.classList.add("print-all");
    setTimeout(function () {
      window.print();
      setTimeout(function () {
        document.body.classList.remove("print-all");
        box.innerHTML = "";
      }, 500);
    }, 80);
    toast("Abrindo a impressão com todos os relatórios…");
  }

  relCarregarUi();

  /* ================= RENDER: MATRIZ ================= */
  function renderMatrix() {
    if (!db.empresas.length) { $("#matrix").innerHTML = '<p class="none">Nenhuma empresa cadastrada.</p>'; return; }
    var html = '<div class="mx-head"></div>' + FASES.map(function (f) { return '<div class="mx-head">' + f + "</div>"; }).join("");
    db.empresas.forEach(function (e) {
      html += '<div class="mx-name" title="' + esc(e.nome) + '"><span style="width:7px;height:7px;border-radius:50%;background:' +
        STATUS[e.status].color + ';flex:none"></span>' + esc(e.nome) + "</div>";
      e.fases.forEach(function (f) {
        var marca = f[0] === "done" ? "✓" : f[0] === "now" ? "●" : f[0] === "pend" ? "!" : "—";
        var titulo = FASE_ESTADO[f[0]] + (f[1] ? " · " + f[1] : "");
        html += '<div class="cell ' + f[0] + '" title="' + esc(titulo) + '">' + marca + "</div>";
      });
    });
    $("#matrix").innerHTML = html;
  }

  /* ================= RENDER: FILTROS ================= */
  function renderFiltros() {
    var tipos = TIPOS.filter(function (t) { return db.empresas.some(function (e) { return e.tipo === t; }); });
    db.empresas.forEach(function (e) { if (tipos.indexOf(e.tipo) < 0) tipos.push(e.tipo); });

    var html = '<span class="chip' + (ui.status === "all" ? " on" : "") + '" data-status="all">Todas<span class="n">' + db.empresas.length + "</span></span>";
    STATUS_ORDEM.forEach(function (k) {
      html += '<span class="chip' + (ui.status === k ? " on" : "") + '" data-status="' + k + '">' +
        STATUS[k].label + '<span class="n">' + porStatus(k).length + "</span></span>";
    });
    html += '<span class="sep"></span>';
    html += '<span class="chip' + (ui.type === "all" ? " on" : "") + '" data-type="all">Todos os tipos</span>';
    tipos.forEach(function (t) {
      html += '<span class="chip' + (ui.type === t ? " on" : "") + '" data-type="' + esc(t) + '">' + esc(t) + "</span>";
    });
    html += '<span class="sep"></span>' +
      '<select class="select" id="sort">' +
      '<option value="origem">Ordem original</option>' +
      '<option value="prog-desc">Maior progresso</option>' +
      '<option value="prog-asc">Menor progresso</option>' +
      '<option value="atualizado">Atualizadas recentemente</option>' +
      '<option value="status">Status</option>' +
      '<option value="nome">Nome (A-Z)</option></select>';

    $("#filters").innerHTML = html;
    $("#sort").value = ui.sort;

    $$("#filters .chip[data-status]").forEach(function (el) {
      el.onclick = function () { setStatus(ui.status === el.dataset.status ? "all" : el.dataset.status); };
    });
    $$("#filters .chip[data-type]").forEach(function (el) {
      el.onclick = function () {
        ui.type = el.dataset.type; ui.present = 0;
        renderFiltros(); renderGrid();
      };
    });
    $("#sort").onchange = function (e) { ui.sort = e.target.value; ui.present = 0; renderGrid(); };
  }

  function setStatus(k) {
    ui.status = k; ui.present = 0;
    renderFiltros(); renderGrid();
  }

  /* ================= RENDER: CARDS ================= */
  function renderGrid() {
    var lista = filtradas();
    var vazio = !lista.length;
    $("#empty").style.display = vazio ? "block" : "none";
    $("#grid").innerHTML = lista.map(function (e) {
      var c = STATUS[e.status].color;
      return '<article class="co" data-id="' + e.id + '" style="--c:' + c + '" tabindex="0">' +
        '<button class="edit" data-edit="' + e.id + '" title="Editar ' + esc(e.nome) + '" aria-label="Editar">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' +
        '<div class="hd"><div><h3><span class="dot"></span>' + esc(e.nome) + "</h3>" +
        '<div class="type">' + esc(e.tipo) + "</div></div>" +
        '<span class="pill">' + STATUS[e.status].label + "</span></div>" +
        '<div class="prog"><div class="tl"><span>Progresso</span><b>' + e.progresso + "%</b></div>" +
        '<div class="track"><i style="width:' + e.progresso + '%"></i></div></div>' +
        (e.statusText ? '<p class="st">' + esc(e.statusText) + "</p>" : "") +
        '<div class="meta"><span><b>' + e.feito.length + "</b> concluídos</span><span><b>" + e.falta.length + "</b> pendências</span>" +
        (e.grupo.length ? '<span><b>' + e.grupo.length + "</b> no grupo</span>" : "") +
        "<span>atualizado " + br(e.atualizado) + "</span></div>" +
        "</article>";
    }).join("");

    $$(".co").forEach(function (el) {
      el.onclick = function (ev) {
        var ed = ev.target.closest("[data-edit]");
        if (ed) { ev.stopPropagation(); abrirEditor(ed.dataset.edit); return; }
        abrirDetalhe(el.dataset.id);
      };
      el.onkeydown = function (ev) {
        if (ev.key === "Enter") abrirDetalhe(el.dataset.id);
        if (ev.key === "e" || ev.key === "E") abrirEditor(el.dataset.id);
      };
    });
  }

  function capital(t) { return String(t || "").charAt(0).toUpperCase() + String(t || "").slice(1); }

  function hora(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  // o estado da sincronização aparece no rodapé e na pílula do topo
  function estadoSync() {
    var s = sync.estado();
    if (s.modo === "conectando") return { cls: "wait", txt: "conectando ao servidor…" };
    if (s.modo === "erro") return { cls: "err", txt: "sem conexão com o servidor · guardado neste navegador · " + (s.msg || "") };
    if (s.modo === "ao-vivo" && s.pendente) return { cls: "wait", txt: "enviando para a equipe…" };
    if (s.modo === "ao-vivo") return { cls: "on", txt: "ao vivo com a equipe · " + s.linhas + " empresas · último sync " + hora(s.ultimaSync) };
    return { cls: "off", txt: "salvo só neste navegador — clique para compartilhar com a equipe" };
  }

  function renderFooter() {
    var es = estadoSync();
    var pill = $("#syncPill");
    if (pill) {
      pill.className = "sync " + es.cls;
      pill.innerHTML = '<span class="pt"></span><span class="tx">' + esc(es.txt) + "</span>";
      pill.title = "Sincronização compartilhada — clique para configurar";
    }
    $("#footer").innerHTML = "<span>Levantamento de " + br(db.data) + "</span><span>·</span>" +
      "<span>" + db.empresas.length + " empresas</span><span>·</span>" +
      "<span>" + totalFeito() + " itens concluídos</span><span>·</span>" +
      "<span>" + totalFalta() + " pendências</span>" +
      '<span class="' + (es.cls === "on" ? "save" : "sinc " + es.cls) + '">· ' + esc(es.txt) + "</span>" +
      (es.cls === "off" ? '<button class="linklike" id="footerSync">configurar</button>' : "");
    var fs = $("#footerSync");
    if (fs) fs.onclick = function () { abrirSync(); };
  }

  function renderTudo() {
    renderTopo(); renderKpis(); renderStatusChart(); renderTypeChart(); renderReports();
    renderMatrix(); renderFiltros(); renderGrid(); renderFooter();
  }

  /* ================= MODAL: DETALHES ================= */
  function passos(e) {
    return e.fases.map(function (f, i) {
      return '<div class="step ' + f[0] + '">' + FASES[i] + "<small>" + FASE_ESTADO[f[0]] +
        (f[1] ? " · " + esc(f[1]) : "") + "</small></div>";
    }).join("");
  }

  function abrirDetalhe(eid) {
    var e = porId(eid);
    if (!e) return;
    ui.aberto = eid;
    var c = STATUS[e.status].color;
    var hist = e.historico.length
      ? '<div class="hist"><div class="box" style="padding:0;border:0"><h4>Últimas atualizações</h4><ol>' +
        e.historico.slice(0, 6).map(function (h) {
          return "<li><time>" + br(h.data) + "</time><b>" + h.progresso + "%</b> · " +
            esc(STATUS[h.status] ? STATUS[h.status].label : h.status) +
            (h.texto ? ' <span style="color:var(--faint)">— ' + esc(h.texto) + "</span>" : "") + "</li>";
        }).join("") + "</ol></div></div>"
      : "";
    var agenda = e.cronograma && e.cronograma.length
      ? '<div class="statusbox" style="position:relative"><h4>Agenda / cronograma (' + e.cronograma.length + ')</h4>' +
        '<div style="display:flex;align-items:center;gap:8px;margin:6px 0 10px;flex-wrap:wrap">' +
          '<span class="report-badge visita">' + e.cronograma.length + ' itens vinculados</span>' +
          (e.cronograma[0].origem ? '<span class="hint" style="margin:0;font-size:11px">origem: ' + esc(e.cronograma[0].origem) + '</span>' : '') +
          (e.estadoAntesCronograma ? '<span class="hint" style="margin:0;font-size:11px;color:var(--ok)">· tem estado anterior salvo</span>' : '<span class="hint" style="margin:0;font-size:11px">· sem backup anterior</span>') +
        '</div>' +
        '<div class="schedule-items">' +
        e.cronograma.slice().sort(function (a, b) { return String(a.data || "9999-99-99").localeCompare(String(b.data || "9999-99-99")); }).slice(0, 12).map(function (item) {
          var metaItem = [];
          if (item.data) metaItem.push("Previsto: " + br(item.data));
          if (item.visitaData) metaItem.push("Visita agendada: " + br(item.visitaData));
          if (item.concluidoEm) metaItem.push("Concluído: " + br(item.concluidoEm));
          if (item.hora) metaItem.push(item.hora);
          metaItem.push(rotuloStatusCronograma(item.status));
          if (item.responsavel) metaItem.push("Resp.: " + item.responsavel);
          if (item.progresso != null) metaItem.push(item.progresso + "%");
          return '<div class="schedule-item"><div>' +
            (item.fase ? '<div class="report-meta"><b>' + esc(item.fase) + "</b></div>" : "") +
            '<span class="report-badge ' + (item.categoria === "visita" ? "visita" : "") + '">' +
            (item.categoria === "visita" ? "Visita" : "Etapa") + "</span> <b>" + esc(item.atividade) + "</b>" +
            '<div class="report-meta">' + esc(metaItem.join(" · ")) + "</div></div></div>";
        }).join("") +
        (e.cronograma.length > 12 ? '<p class="hint">+' + (e.cronograma.length - 12) + " itens no cronograma.</p>" : "") +
        "</div>" +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">' +
          '<button class="btn sm danger" data-desvincular="' + e.id + '" title="Remove o cronograma e restaura o estado anterior">Desvincular cronograma</button>' +
          '<button class="btn sm ghost" data-desvincular-editar="' + e.id + '">Desvincular na edição…</button>' +
          '<span class="hint" style="margin:0">Volta ao que era antes da vinculação</span>' +
        '</div>' +
        '<details style="margin-top:10px"><summary style="cursor:pointer;font-size:11px;color:var(--muted)">Ver detalhes da restauração</summary>' +
          '<pre style="white-space:pre-wrap;word-break:break-word;font:11px/1.5 ui-monospace,monospace;background:var(--surface);border:1px solid var(--line);border-radius:7px;padding:9px 10px;margin-top:7px;color:var(--muted)">' + esc(detalhesRestauracao(e)) + '</pre></details>' +
        "</div>"
      : "";

    $("#modalBody").innerHTML =
      '<div class="body">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">' +
          "<div><h2 style=\"color:" + c + '">' + esc(e.nome) + "</h2>" +
          '<div class="subline">' + esc(e.tipo) + " · " + e.feito.length + " concluídos · " + e.falta.length + " pendências · atualizado em " + br(e.atualizado) + "</div></div>" +
          '<div style="display:flex;gap:8px;align-items:center"><span class="pill" style="--c:' + c + '">' + STATUS[e.status].label + "</span>" +
          '<button class="btn sm" data-edit="' + e.id + '">Editar</button></div>' +
        "</div>" +
        '<div class="prog" style="margin-top:16px"><div class="tl" style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:5px"><span>Progresso</span><b style="color:var(--txt);font-size:13px">' + e.progresso + '%</b></div>' +
        '<div class="track" style="--c:' + c + '"><i style="width:' + e.progresso + '%"></i></div></div>' +
        '<div class="pipeline">' + passos(e) + "</div>" +
        '<div class="cols">' +
          '<div class="box"><h4>O que já foi feito</h4>' + (e.feito.length ? '<ul class="list">' + e.feito.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="none">Nada registrado ainda.</p>') + "</div>" +
          '<div class="box"><h4>O que ainda falta fazer</h4>' + (e.falta.length ? '<ul class="list pend">' + e.falta.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="none">Nada pendente.</p>') + "</div>" +
          (e.grupo.length ? '<div class="box"><h4>Outras empresas do grupo</h4><ul class="list grupo">' + e.grupo.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>" : "") +
        "</div>" +
        agenda +
        (e.statusText || e.observacao ? '<div class="statusbox"><h4>Status atual</h4><p>' + esc(e.statusText) + "</p>" +
          (e.observacao ? '<p class="obs">' + esc(e.observacao) + "</p>" : "") + "</div>" : "") +
        hist +
      "</div>";
    $("[data-edit]", $("#modalBody")).onclick = function () { abrirEditor(e.id); };
    var btnDesv = $("[data-desvincular]", $("#modalBody"));
    if (btnDesv) btnDesv.onclick = function () { desvincularCronogramaEmpresa(e.id); };
    var btnDesvEdit = $("[data-desvincular-editar]", $("#modalBody"));
    if (btnDesvEdit) btnDesvEdit.onclick = function () { abrirEditor(e.id); setTimeout(function(){
      var chk = $("#fDesvincularCronograma");
      var box = $("#vinculoCronogramaBox");
      if (chk && box) { box.scrollIntoView({behavior:"smooth", block:"center"}); chk.focus(); }
    }, 120); };
    $("#backdrop").classList.add("on");
  }
  function fecharDetalhe() { $("#backdrop").classList.remove("on"); ui.aberto = null; }
  function navegar(dir) {
    var lista = filtradas();
    if (!lista.length || !ui.aberto) return;
    var i = lista.findIndex(function (e) { return e.id === ui.aberto; });
    if (i < 0) return;
    abrirDetalhe(lista[(i + dir + lista.length) % lista.length].id);
  }

  /* ================= EDITOR ================= */
  function linhaLista(container, valores, placeholder) {
    container.innerHTML = "";
    var vals = valores.length ? valores : [""];
    vals.forEach(function (v) { addLinha(container, v, placeholder); });
  }
  function focarUltimo(container) {
    var rows = $$(".row", container);
    if (rows.length) $("input", rows[rows.length - 1]).focus();
  }
  function addLinha(container, valor, placeholder) {
    var row = document.createElement("div");
    row.className = "row";
    row.innerHTML = '<input type="text" placeholder="' + esc(placeholder || "") + '" value="' + esc(valor) + '">' +
      '<button type="button" class="mini" title="Remover">×</button>';
    $(".mini", row).onclick = function () {
      var rows = $$(".row", container);
      if (rows.length === 1) { $("input", row).value = ""; return; }
      row.remove();
    };
    container.appendChild(row);
  }
  function lerLinhas(container) {
    return $$(".row input", container).map(function (i) { return i.value.trim(); }).filter(Boolean);
  }

  function abrirEditor(eid) {
    var e = eid ? porId(eid) : null;
    editando = e ? e.id : null;

    $("#tipos").innerHTML = TIPOS.map(function (t) { return "<option value=\"" + esc(t) + "\">"; }).join("");
    $("#fStatus").innerHTML = Object.keys(STATUS).map(function (k) {
      return '<option value="' + k + '">' + STATUS[k].label + "</option>";
    }).join("");

    $("#edTitle").textContent = e ? "Editar " + e.nome : "Nova empresa";
    var destino = sync.ativo() ? "salvo e enviado para a equipe na hora" : "salvo automaticamente neste navegador";
    $("#edSub").textContent = e
      ? "Atualize o status, o que foi feito e o que ainda falta. " + capital(destino) + "."
      : "Cadastre a empresa e mantenha o status sempre atualizado (" + destino + ").";
    $("#fNome").value = e ? e.nome : "";
    $("#fTipo").value = e ? e.tipo : "";
    $("#fStatus").value = e ? e.status : "andamento";
    $("#fProg").value = e ? e.progresso : 0;
    $("#fProgVal").textContent = (e ? e.progresso : 0) + "%";
    $("#fStatusText").value = e ? e.statusText : "";
    $("#fObs").value = e ? e.observacao : "";
    $("#fData").value = e ? e.atualizado : hoje();
    $("#btnDelete").style.display = e ? "" : "none";

    linhaLista($("#rowsFeito"), e ? e.feito : [], "Ex.: Cadastro de usuários");
    linhaLista($("#rowsFalta"), e ? e.falta : [], "Ex.: Validação do cliente");
    linhaLista($("#rowsGrupo"), e ? e.grupo : [], "Ex.: Filial X — pendente Cloud");

    $("#phaseRows").innerHTML = FASES.map(function (f, i) {
      var f0 = e ? e.fases[i][0] : "na", txt = e ? e.fases[i][1] : "";
      return '<div class="prow"><span>' + f + "</span>" +
        '<select data-fase="' + i + '">' + Object.keys(FASE_ESTADO).map(function (k) {
          return '<option value="' + k + '"' + (k === f0 ? " selected" : "") + ">" + FASE_ESTADO[k] + "</option>";
        }).join("") + "</select>" +
        '<input type="text" data-fasetxt="' + i + '" placeholder="detalhe (opcional)" value="' + esc(txt) + '"></div>';
    }).join("");

    // ---- vinculo cronograma: mostra o box e prepara o desvincular ----
    (function atualizarVinculoUI() {
      var box = $("#vinculoCronogramaBox");
      var chk = $("#fDesvincularCronograma");
      if (!box || !chk) return;
      if (!e || !e.cronograma || !e.cronograma.length) {
        box.style.display = "none";
        chk.checked = false;
        return;
      }
      box.style.display = "";
      var qtd = e.cronograma.length;
      var origem = e.cronograma[0].origem || "importação";
      var badge = $("#vinculoBadge");
      if (badge) badge.textContent = qtd + " item(ns)";
      var info = $("#vinculoInfo");
      if (info) {
        var venc = e.cronograma.filter(function (it) { return it.data && it.data < hoje() && it.status !== "concluido"; }).length;
        var visitas = e.cronograma.filter(function (it) { return it.categoria === "visita"; }).length;
        info.textContent = qtd + " itens vinculados · origem " + origem + " · " + visitas + " visita(s)" + (venc ? " · " + venc + " vencido(s)" : "") + " · atualizado " + br(e.atualizado);
      }
      var origemEl = $("#vinculoOrigem");
      if (origemEl) origemEl.textContent = origem + " · " + qtd + " itens";
      var hint = $("#vinculoHint");
      var snap = e.estadoAntesCronograma;
      if (snap) {
        var lbl = STATUS[snap.status] ? STATUS[snap.status].label : (snap.status === "pendente" ? "Pendente" : snap.status || "—");
        var prog = snap.progresso != null ? snap.progresso + "%" : "—";
        if (hint) hint.textContent = "Ao salvar, o status voltará para \"" + lbl + "\" (" + prog + ") e o cronograma será removido. Estado de " + (snap.atualizado ? br(snap.atualizado) : "antes da vinculação") + ".";
      } else {
        var base = baselineComparavel().porNome[chaveNome(e.nome)];
        if (base) {
          var lblb = STATUS[base.status] ? STATUS[base.status].label : base.status;
          if (hint) hint.textContent = "Sem backup desta vinculação — ao salvar voltará ao baseline: \"" + lblb + "\" (" + base.progresso + "%, " + br(base.atualizado) + ").";
        } else {
          if (hint) hint.textContent = "Ao salvar, o cronograma será removido e o status/progresso preenchidos acima serão mantidos.";
        }
      }
      var prev = $("#vinculoPrevConteudo");
      if (prev) prev.textContent = detalhesRestauracao(e);
      // desmarcar por padrão a cada abertura
      chk.checked = false;
      // quando marcar, dá feedback visual no status/progresso
      var basePrev = baselineComparavel().porNome[chaveNome(e.nome)];
      chk.onchange = function () {
        if (chk.checked) {
          $("#fStatus").style.outline = "2px solid var(--risk)";
          $("#fProg").style.outline = "2px solid var(--risk)";
          if (snap) {
            // pré-visualiza a restauração nos campos (sem salvar ainda)
            $("#fStatus").value = STATUS[snap.status] ? snap.status : (snap.status === "pendente" ? "andamento" : $("#fStatus").value);
            if (snap.progresso != null) { $("#fProg").value = snap.progresso; $("#fProgVal").textContent = snap.progresso + "%"; }
            if (snap.statusText) $("#fStatusText").value = snap.statusText;
          } else if (basePrev) {
            $("#fStatus").value = basePrev.status;
            $("#fProg").value = basePrev.progresso;
            $("#fProgVal").textContent = basePrev.progresso + "%";
            $("#fStatusText").value = basePrev.statusText;
          }
        } else {
          $("#fStatus").style.outline = "";
          $("#fProg").style.outline = "";
          if (e) {
            $("#fStatus").value = e.status;
            $("#fProg").value = e.progresso;
            $("#fProgVal").textContent = e.progresso + "%";
            $("#fStatusText").value = e.statusText;
          }
        }
      };
    })();

    $("#editorBackdrop").classList.add("on");
    setTimeout(function () { $("#fNome").focus(); }, 40);
  }
  function fecharEditor() { $("#editorBackdrop").classList.remove("on"); editando = null; }

  $("#form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var nome = $("#fNome").value.trim();
    if (!nome) { $("#fNome").focus(); toast("Informe o nome da empresa."); return; }

    var fases = $$("#phaseRows select").map(function (s) {
      return [s.value, $("#phaseRows [data-fasetxt=\"" + s.dataset.fase + "\"]").value.trim().slice(0, 60)];
    });
    var antigo = editando ? porId(editando) : null;
    var desvincularChk = $("#fDesvincularCronograma");
    var querDesvincular = desvincularChk && desvincularChk.checked && antigo && antigo.cronograma && antigo.cronograma.length;
    var reg = {
      id: editando || id(),
      nome: nome,
      tipo: $("#fTipo").value.trim() || "Outro",
      status: $("#fStatus").value,
      progresso: clamp(num($("#fProg").value, 0), 0, 100),
      statusText: $("#fStatusText").value.trim(),
      feito: lerLinhas($("#rowsFeito")),
      falta: lerLinhas($("#rowsFalta")),
      grupo: lerLinhas($("#rowsGrupo")),
      fases: fases,
      observacao: $("#fObs").value.trim(),
      atualizado: $("#fData").value || hoje(),
      historico: antigo ? antigo.historico.slice() : [],
      cronograma: antigo ? (antigo.cronograma || []).slice() : [],
      estadoAntesCronograma: antigo ? antigo.estadoAntesCronograma : null
    };

    // se marcou desvincular, restaura o estado de antes do cronograma
    if (querDesvincular) {
      var snap = antigo.estadoAntesCronograma;
      if (snap) {
        if (snap.status && (STATUS[snap.status] || snap.status === "pendente")) {
          reg.status = snap.status === "pendente" ? "andamento" : snap.status;
        }
        if (snap.progresso != null) reg.progresso = snap.progresso;
        reg.statusText = snap.statusText || "";
        reg.cronograma = snap.cronograma ? snap.cronograma.slice() : [];
        reg.estadoAntesCronograma = null;
        reg.atualizado = $("#fData").value || hoje();
        reg.historico.unshift({ data: reg.atualizado, progresso: reg.progresso, status: reg.status, texto: "Cronograma desvinculado — voltou ao estado anterior" });
      } else {
        var base = baselineComparavel().porNome[chaveNome(antigo.nome)];
        if (base) {
          reg.status = base.status;
          reg.progresso = base.progresso;
          reg.statusText = base.statusText;
          reg.cronograma = base.cronograma ? base.cronograma.slice() : [];
          reg.feito = base.feito.slice();
          reg.falta = base.falta.slice();
          reg.fases = base.fases.map(function (f) { return f.slice(); });
          reg.estadoAntesCronograma = null;
          reg.historico.unshift({ data: reg.atualizado, progresso: reg.progresso, status: reg.status, texto: "Cronograma desvinculado — restaurado do baseline" });
        } else {
          reg.cronograma = [];
          reg.estadoAntesCronograma = null;
          reg.historico.unshift({ data: reg.atualizado, progresso: reg.progresso, status: reg.status, texto: "Cronograma desvinculado — status mantido" });
        }
      }
      reg.historico = reg.historico.slice(0, 30);
      // já deixa o histórico registrado, não precisa do bloco de continuidade abaixo
    } else {
      // histórico de continuidade: registra a mudança de status/progresso
      var ultimo = reg.historico[0];
      if (!ultimo || ultimo.progresso !== reg.progresso || ultimo.status !== reg.status || ultimo.texto !== reg.statusText) {
        reg.historico.unshift({
          data: reg.atualizado,
          progresso: reg.progresso,
          status: reg.status,
          texto: reg.statusText.slice(0, 90)
        });
        reg.historico = reg.historico.slice(0, 30);
      }
    }

    tocados[reg.id] = true;
    if (antigo) {
      var i = db.empresas.indexOf(antigo);
      db.empresas[i] = reg;
    } else {
      db.empresas.push(reg);
      ui.sort = "origem";
    }
    if (!salvar()) return;
    if (querDesvincular) {
      toast(nome + " — cronograma desvinculado e voltou ao que era antes" + (sync.ativo() ? " — salvando para a equipe…" : ""));
    } else {
      toast(nome + (antigo ? " atualizada" : " cadastrada no relatório") +
        (sync.ativo() ? " — salvando para a equipe…" : " — salva só neste navegador"));
    }
    fecharEditor();
    renderTudo();
    if (ui.aberto) abrirDetalhe(reg.id);
  });

  $("#btnDelete").onclick = function () {
    var e = editando ? porId(editando) : null;
    if (!e) return;
    if (!window.confirm("Excluir \"" + e.nome + "\" do relatório? Essa ação não pode ser desfeita.")) return;
    db.empresas = db.empresas.filter(function (x) { return x.id !== e.id; });
    salvar(); fecharEditor(); fecharDetalhe(); renderTudo();
    toast(e.nome + " removida do relatório.");
  };

  $("#addFeito").onclick = function () { addLinha($("#rowsFeito"), "", "Ex.: Cadastro de usuários"); focarUltimo($("#rowsFeito")); };
  $("#addFalta").onclick = function () { addLinha($("#rowsFalta"), "", "Ex.: Validação do cliente"); focarUltimo($("#rowsFalta")); };
  $("#addGrupo").onclick = function () { addLinha($("#rowsGrupo"), "", "Ex.: Filial X — pendente Cloud"); focarUltimo($("#rowsGrupo")); };
  $("#fProg").oninput = function () { $("#fProgVal").textContent = this.value + "%"; };

  /* ================= EXPORTAR / IMPORTAR ================= */
  function baixar(nomeArquivo, conteudo, tipo) {
    var blob = new Blob([conteudo], { type: tipo || "application/json;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nomeArquivo;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function payload() {
    return {
      app: "relatorio-implantacoes",
      versao: 1,
      data: db.data,
      geradoEm: new Date().toISOString(),
      empresas: db.empresas
    };
  }

  function csvCampo(valor) {
    var texto = String(valor == null ? "" : valor);
    if (/^[=+\-@\t\r]/.test(texto)) texto = "'" + texto;
    return '"' + texto.replace(/"/g, '""') + '"';
  }
  function baixarRelatorioCsv(nome, cabecalhos, linhas) {
    var conteudo = "\uFEFF" + [cabecalhos].concat(linhas).map(function (linha) {
      return linha.map(csvCampo).join(";");
    }).join("\r\n");
    baixar(nome + "-" + hoje() + ".csv", conteudo, "text/csv;charset=utf-8");
    toast(nome + " exportado em CSV (" + linhas.length + " linha(s)).");
  }

  /* ---------- ações do painel de relatórios (módulo "RELATÓRIOS") ---------- */
  $("#btnReportToggle").onclick = function () { rel.aberto = !rel.aberto; relSalvarUi(); renderReports(); };
  $("#btnReportCopy").onclick = copiarRelatorio;
  $("#btnReportCsv").onclick = exportarRelatorioCsv;
  $("#btnReportPrint").onclick = imprimirRelatorios;
  $("#reportFollow").onchange = function () { rel.seguir = this.checked; relSalvarUi(); renderReports(); };

  $("#mExport").onclick = function () {
    baixar("implantacoes-" + hoje() + ".json", JSON.stringify(payload(), null, 2));
    toast("JSON exportado (" + db.empresas.length + " empresas).");
  };

  $("#mExportJs").onclick = function () {
    var js = "/* Relatório de implantações — exportado em " + hoje() + " */\n" +
      "window.DADOS_INICIAIS = " + JSON.stringify({ data: db.data, empresas: db.empresas }, null, 2) + ";\n";
    baixar("dados.js", js, "text/javascript;charset=utf-8");
    toast("dados.js gerado — substitua o arquivo no repositório e faça o push.");
  };

  $("#mImport").onclick = function () { $("#fileInput").click(); };
  $("#fileInput").onchange = function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (!f) return;
    // planilha escolhida aqui por engano (ou de propósito): abre o importador de CSV
    if (/\.(csv|tsv)$/i.test(f.name || "")) {
      abrirImportadorCronograma();
      processarArquivoImportacao(f);
      return;
    }
    var r = new FileReader();
    r.onload = function () {
      var p;
      try {
        var txt = String(r.result);
        var i = txt.indexOf("{"), j = txt.lastIndexOf("}");
        p = JSON.parse(i >= 0 && j > i ? txt.slice(i, j + 1) : txt);
      } catch (err) { toast("Arquivo inválido: JSON não reconhecido."); return; }
      if (!p || !Array.isArray(p.empresas) || !p.empresas.length) { toast("Arquivo sem empresas."); return; }
      if (!window.confirm("Importar " + p.empresas.length + " empresa(s)? O relatório atual será substituído.")) return;
      db = { data: p.data || hoje(), empresas: p.empresas.map(normalizar) };
      ui = { status: "all", type: "all", q: ui.q, sort: "origem", aberto: null, present: 0 };
      $("#q").value = "";
      salvar(); fecharDetalhe(); renderTudo();
      toast("Relatório importado: " + db.empresas.length + " empresas.");
    };
    r.readAsText(f);
  };

  /* ========== IMPORTAR CRONOGRAMA (PDF) OU PLANILHA (CSV) ========== */
  function estadoImportacao(texto, tipo) {
    var el = $("#scheduleImportState");
    el.className = "import-state" + (tipo ? " " + tipo : "");
    el.textContent = texto;
  }

  function limparPreviasImportacao() {
    pdfImport = { arquivo: "", linhas: [], texto: "", paginas: 0, carregando: false, fonte: "PDF" };
    csvImport = { arquivo: "", analise: null, linhas: [], modo: "" };
    $("#schedulePreviewArea").style.display = "none";
    $("#schedulePreview").innerHTML = "";
    $("#companyPreviewArea").style.display = "none";
    $("#companyPreview").innerHTML = "";
    $("#importModeWrap").style.display = "none";
    $("#scheduleApply").disabled = true;
    $("#scheduleApply").textContent = "Aplicar atualizações";
  }

  function abrirImportadorCronograma() {
    limparPreviasImportacao();
    $("#scheduleFileInput").value = "";
    $("#scheduleChooseFile").disabled = false;
    atualizarRodapeImportacao("");
    estadoImportacao("Nenhum arquivo selecionado — PDF de cronograma ou planilha CSV. O relatório não será alterado até você clicar em “Aplicar”.", "");
    $("#scheduleBackdrop").classList.add("on");
  }

  function fecharImportadorCronograma() {
    $("#scheduleBackdrop").classList.remove("on");
  }

  function atualizarRodapeImportacao(modo) {
    $("#scheduleFootHint").textContent = modo === "empresas"
      ? "Cada linha vira uma empresa: as já cadastradas são atualizadas (campos em branco no CSV não apagam nada) e as marcadas como “criar nova” entram no relatório. Tudo fica registrado no histórico."
      : "Só empresas selecionadas são alteradas; os itens substituem o cronograma anterior daquela empresa. PENDENTE genérico vira Em andamento, todas as etapas concluídas viram Concluído e o progresso só muda com percentual explícito.";
    $("#scheduleApply").textContent = modo === "empresas" ? "Cadastrar / atualizar empresas" : "Aplicar atualizações";
  }

  function modoImportacaoAtual() {
    return $("#companyPreviewArea").style.display === "none" ? "cronograma" : "empresas";
  }

  // cria a empresa que veio do arquivo e ainda não existe no relatório
  function criarEmpresaDoImport(nome, dados, textoHistorico) {
    var d = dados || {};
    var reg = normalizar({
      nome: String(nome || "").trim().slice(0, 120) || "Nova empresa",
      tipo: d.tipo || "Outro",
      status: STATUS[d.status] ? d.status : "andamento",
      progresso: d.progresso == null ? 0 : clamp(num(d.progresso, 0), 0, 100),
      statusText: d.statusText || "",
      feito: d.feito || [],
      falta: d.falta || [],
      grupo: d.grupo || [],
      observacao: d.observacao || "",
      atualizado: d.atualizado || hoje()
    });
    if (porId(reg.id)) reg.id = id();          // nome repetido com outro id: não sobrescreve ninguém
    reg.historico = [{
      data: reg.atualizado, progresso: reg.progresso, status: reg.status,
      texto: String(textoHistorico || "Cadastrada por importação").slice(0, 90)
    }];
    db.empresas.push(reg);
    tocados[reg.id] = true;
    return reg;
  }

  /* ---------- prévia: cronograma (PDF e CSV) ---------- */
  function opcoesStatusCronograma(selecionado) {
    var html = '<option value="">Não reconhecido — não muda o status</option>' +
      '<option value="pendente"' + (selecionado === "pendente" ? " selected" : "") + ">Pendente</option>";
    Object.keys(STATUS).forEach(function (k) {
      html += '<option value="' + k + '"' + (selecionado === k ? " selected" : "") + ">" + esc(STATUS[k].label) + "</option>";
    });
    return html;
  }

  // preenche o seletor “Vincular todas as atividades a” com as empresas cadastradas
  function atualizarSeletorVinculoCronograma() {
    var empresas = db.empresas.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
    var seletor = $("#scheduleLinkCompany");
    var anterior = seletor.value;
    seletor.innerHTML = '<option value="">— escolha a empresa —</option>' + empresas.map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(e.nome) + "</option>";
    }).join("");
    if (anterior && porId(anterior)) seletor.value = anterior;
    $("#scheduleLinkApply").disabled = !empresas.length;
  }

  // vincula TODAS as atividades da prévia à empresa escolhida e marca para importar as que têm texto
  function vincularTodasAtividades() {
    var empresaId = $("#scheduleLinkCompany").value;
    var empresa = porId(empresaId);
    if (!empresa) { toast("Escolha uma empresa cadastrada para vincular."); return; }
    atualizarLinhasDaPrevia();
    var vinculadas = 0;
    pdfImport.linhas.forEach(function (linha) {
      linha.empresaId = empresa.id;
      linha.empresaNome = empresa.nome;
      if (String(linha.atividade || "").trim()) linha.usar = true;
      vinculadas++;
    });
    renderTabelaCronograma();
    toast(vinculadas + " atividade(s) vinculada(s) a " + empresa.nome + ".");
  }

  function renderTabelaCronograma() {
    atualizarSeletorVinculoCronograma();
    var empresas = db.empresas.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
    var html = pdfImport.linhas.map(function (linha, i) {
      var nomeNovo = String(linha.empresaCsv || "").trim();
      var opEmpresas = '<option value="">— selecione —</option>' +
        (nomeNovo ? '<option value="__nova__"' + (linha.empresaId === "__nova__" ? " selected" : "") + ">+ criar “" + esc(nomeNovo) + "”</option>" : "") +
        empresas.map(function (e) {
          return '<option value="' + esc(e.id) + '"' + (linha.empresaId === e.id ? " selected" : "") + ">" + esc(e.nome) + "</option>";
        }).join("");
      var prog = linha.progresso == null ? "" : linha.progresso;
      return '<tr data-pdf-row="' + i + '">' +
        '<td><select data-field="empresaId" aria-label="Empresa">' + opEmpresas + "</select></td>" +
        '<td><input type="text" data-field="fase" value="' + esc(linha.fase || "") + '" aria-label="Fase"></td>' +
        '<td class="activity"><input type="text" data-field="atividade" value="' + esc(linha.atividade) + '" aria-label="Atividade"></td>' +
        '<td><input type="date" data-field="data" value="' + esc(linha.data || "") + '" aria-label="Data prevista"></td>' +
        '<td><input type="date" data-field="visitaData" value="' + esc(linha.visitaData || "") + '" aria-label="Data da visita"></td>' +
        '<td><input type="date" data-field="concluidoEm" value="' + esc(linha.concluidoEm || "") + '" aria-label="Data de conclusão"></td>' +
        '<td><input type="time" data-field="hora" value="' + esc(linha.hora || "") + '" aria-label="Hora"></td>' +
        '<td><input type="text" data-field="responsavel" value="' + esc(linha.responsavel || "") + '" aria-label="Responsável"></td>' +
        '<td><select data-field="categoria" aria-label="Tipo"><option value="etapa"' + (linha.categoria !== "visita" ? " selected" : "") + '>Etapa</option><option value="visita"' + (linha.categoria === "visita" ? " selected" : "") + '>Visita</option></select></td>' +
        '<td><select data-field="status" aria-label="Status">' + opcoesStatusCronograma(linha.status) + "</select></td>" +
        '<td><input type="number" min="0" max="100" step="1" data-field="progresso" value="' + esc(prog) + '" placeholder="—" aria-label="Progresso percentual"></td>' +
        '<td class="use"><input type="checkbox" data-field="usar"' + (linha.usar ? " checked" : "") + ' aria-label="Usar esta linha"></td>' +
        "</tr>";
    }).join("");
    $("#schedulePreview").innerHTML = html;
    atualizarResumoCronograma();
  }

  function atualizarResumoCronograma() {
    var linhas = pdfImport.linhas || [];
    var selecionadas = linhas.filter(function (r) { return r.usar && r.empresaId && String(r.atividade || "").trim(); });
    var empresas = {}, novas = {};
    selecionadas.forEach(function (r) {
      if (r.empresaId === "__nova__") novas[chaveNome(r.empresaCsv) || r.id] = true;
      else empresas[r.empresaId] = true;
    });
    var statusConhecidos = selecionadas.filter(function (r) { return !!STATUS[r.status] || r.status === "pendente"; }).length;
    var visitas = selecionadas.filter(function (r) { return r.categoria === "visita" || !!r.visitaData; }).length;
    var semEmpresa = linhas.filter(function (r) { return !r.empresaId; }).length;
    var qtdNovas = Object.keys(novas).length;
    $("#scheduleSummary").innerHTML =
      '<span><b>' + linhas.length + "</b> itens lidos</span>" +
      '<span><b>' + selecionadas.length + "</b> selecionados</span>" +
      '<span><b>' + (Object.keys(empresas).length + qtdNovas) + "</b> empresas</span>" +
      (qtdNovas ? '<span><b>' + qtdNovas + "</b> a cadastrar</span>" : "") +
      '<span><b>' + statusConhecidos + "</b> status reconhecidos</span>" +
      '<span><b>' + visitas + "</b> visitas</span>" +
      (semEmpresa ? '<span><b>' + semEmpresa + "</b> sem empresa associada</span>" : "");
    $("#scheduleApply").disabled = !selecionadas.length || pdfImport.carregando;
  }

  function atualizarLinhasDaPrevia() {
    $$("#schedulePreview tr[data-pdf-row]").forEach(function (tr) {
      var i = num(tr.dataset.pdfRow, -1), linha = pdfImport.linhas[i];
      if (!linha) return;
      $$("[data-field]", tr).forEach(function (campo) {
        var nome = campo.dataset.field;
        if (nome === "usar") linha[nome] = campo.checked;
        else if (nome === "progresso") linha[nome] = campo.value === "" ? null : clamp(num(campo.value, 0), 0, 100);
        else linha[nome] = campo.value;
      });
      var empresa = porId(linha.empresaId);
      linha.empresaNome = empresa ? empresa.nome : (linha.empresaId === "__nova__" ? String(linha.empresaCsv || "") : "");
    });
  }

  function adicionarLinhaCronogramaManual() {
    pdfImport.linhas.push({
      id: "import-manual-" + (pdfImport.linhas.length + 1), empresaId: "", empresaNome: "", empresaCsv: "",
      atividade: "", fase: "", data: "", visitaData: "", concluidoEm: "", responsavel: "",
      hora: "", categoria: "etapa", status: "", progresso: null,
      usar: false, pagina: 0, trecho: ""
    });
    renderTabelaCronograma();
    var ultima = $("#schedulePreview tr:last-child input[data-field=atividade]");
    if (ultima) ultima.focus();
  }

  /* ---------- prévia: carteira de empresas (CSV) ---------- */
  function opcoesStatusEmpresa(selecionado) {
    var html = '<option value="">Manter o atual</option>';
    Object.keys(STATUS).forEach(function (k) {
      html += '<option value="' + k + '"' + (selecionado === k ? " selected" : "") + ">" + esc(STATUS[k].label) + "</option>";
    });
    return html;
  }

  function renderTabelaEmpresas() {
    var empresas = db.empresas.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
    $("#tipos").innerHTML = TIPOS.map(function (t) { return '<option value="' + esc(t) + '">'; }).join("");
    var html = csvImport.linhas.map(function (linha, i) {
      var alvo = porId(linha.empresaId);
      var opEmpresas = '<option value=""' + (alvo ? "" : " selected") + ">+ criar nova empresa</option>" +
        empresas.map(function (e) {
          return '<option value="' + esc(e.id) + '"' + (alvo && alvo.id === e.id ? " selected" : "") + ">" + esc(e.nome) + "</option>";
        }).join("");
      var prog = linha.progresso == null ? "" : linha.progresso;
      return '<tr data-company-row="' + i + '">' +
        '<td><select data-field="empresaId" aria-label="Empresa de destino">' + opEmpresas + "</select></td>" +
        '<td class="activity"><input type="text" data-field="nome" value="' + esc(alvo ? alvo.nome : linha.nome) + '"' + (alvo ? " disabled" : "") + ' aria-label="Nome da empresa"></td>' +
        '<td><input type="text" data-field="tipo" list="tipos" value="' + esc(linha.tipo || "") + '" placeholder="—" aria-label="Tipo de trabalho"></td>' +
        '<td><select data-field="status" aria-label="Status">' + opcoesStatusEmpresa(linha.status) + "</select></td>" +
        '<td><input type="number" min="0" max="100" step="1" data-field="progresso" value="' + esc(prog) + '" placeholder="—" aria-label="Progresso percentual"></td>' +
        '<td class="activity"><input type="text" data-field="statusText" value="' + esc(linha.statusText || "") + '" placeholder="—" aria-label="Status atual"></td>' +
        '<td class="activity"><input type="text" data-field="feito" value="' + esc((linha.feito || []).join(" | ")) + '" placeholder="item | item" aria-label="O que já foi feito"></td>' +
        '<td class="activity"><input type="text" data-field="falta" value="' + esc((linha.falta || []).join(" | ")) + '" placeholder="item | item" aria-label="O que ainda falta"></td>' +
        '<td><input type="date" data-field="atualizado" value="' + esc(linha.atualizado || "") + '" aria-label="Data da atualização"></td>' +
        '<td class="use"><input type="checkbox" data-field="usar"' + (linha.usar ? " checked" : "") + ' aria-label="Usar esta linha"></td>' +
        "</tr>";
    }).join("");
    $("#companyPreview").innerHTML = html;
    atualizarResumoEmpresas();
  }

  function atualizarResumoEmpresas() {
    var linhas = csvImport.linhas || [];
    var selecionadas = linhas.filter(function (r) { return r.usar && (porId(r.empresaId) || String(r.nome || "").trim()); });
    var novas = selecionadas.filter(function (r) { return !porId(r.empresaId); }).length;
    var comStatus = selecionadas.filter(function (r) { return !!STATUS[r.status]; }).length;
    var comProgresso = selecionadas.filter(function (r) { return r.progresso != null; }).length;
    var comListas = selecionadas.filter(function (r) { return (r.feito || []).length || (r.falta || []).length; }).length;
    $("#companySummary").innerHTML =
      '<span><b>' + linhas.length + "</b> linhas lidas</span>" +
      '<span><b>' + selecionadas.length + "</b> selecionadas</span>" +
      '<span><b>' + novas + "</b> a cadastrar</span>" +
      '<span><b>' + (selecionadas.length - novas) + "</b> a atualizar</span>" +
      '<span><b>' + comStatus + "</b> com status</span>" +
      '<span><b>' + comProgresso + "</b> com progresso</span>" +
      (comListas ? '<span><b>' + comListas + "</b> com listas de itens</span>" : "");
    $("#scheduleApply").disabled = !selecionadas.length;
  }

  function atualizarLinhasEmpresasDaPrevia() {
    $$("#companyPreview tr[data-company-row]").forEach(function (tr) {
      var i = num(tr.dataset.companyRow, -1), linha = csvImport.linhas[i];
      if (!linha) return;
      $$("[data-field]", tr).forEach(function (campo) {
        var nome = campo.dataset.field;
        if (nome === "usar") linha.usar = campo.checked;
        else if (nome === "progresso") linha.progresso = campo.value === "" ? null : clamp(num(campo.value, 0), 0, 100);
        else if (nome === "feito" || nome === "falta") linha[nome] = listaDoCampo(campo.value);
        else if (nome === "nome") { if (!campo.disabled) linha.nome = campo.value; }
        else linha[nome] = campo.value;
      });
    });
  }

  function listaDoCampo(valor) {
    return String(valor || "").split(/\s*[|;\n]\s*/).map(function (v) { return v.trim(); }).filter(Boolean).slice(0, 60);
  }

  /* ---------- leitura dos arquivos ---------- */
  function processarArquivoImportacao(arquivo) {
    if (!arquivo) return;
    var csv = window.IMPORTAR_CSV;
    var nome = String(arquivo.name || "").toLowerCase();
    if (/\.pdf$/.test(nome) || arquivo.type === "application/pdf") { processarPdfCronograma(arquivo); return; }
    if (csv && csv.pareceCsv(arquivo)) { processarCsvImportacao(arquivo); return; }
    estadoImportacao("Formato não suportado. Envie um PDF de cronograma ou uma planilha CSV/TSV (no Excel: Salvar como → CSV UTF-8).", "err");
  }

  async function processarPdfCronograma(arquivo) {
    if (!arquivo) return;
    limparPreviasImportacao();
    pdfImport = { arquivo: arquivo.name || "cronograma.pdf", linhas: [], texto: "", paginas: 0, carregando: true, fonte: "PDF" };
    atualizarRodapeImportacao("cronograma");
    $("#scheduleChooseFile").disabled = true;
    estadoImportacao("Lendo “" + pdfImport.arquivo + "”… o arquivo permanece neste dispositivo.", "");
    try {
      if (!window.CRONOGRAMA_PDF) throw new Error("O leitor de PDF não carregou. Atualize a página e tente novamente.");
      var extraido = await window.CRONOGRAMA_PDF.lerPdf(arquivo);
      pdfImport.paginas = extraido.paginas;
      pdfImport.texto = extraido.texto || "";
      $("#scheduleRawLabel").textContent = "Ver texto extraído do PDF (para conferir a leitura)";
      if (!pdfImport.texto.trim()) {
        $("#schedulePreviewArea").style.display = "";
        $("#scheduleRawText").textContent = "Nenhum texto foi encontrado. Este arquivo provavelmente é uma digitalização. É necessário aplicar OCR ao PDF antes de importar.";
        estadoImportacao("Não encontrei texto pesquisável no PDF. Se ele foi digitalizado como imagem, aplique OCR e envie novamente.", "err");
        return;
      }
      pdfImport.linhas = window.CRONOGRAMA_PDF.interpretarLinhas(extraido.linhas, db.empresas);
      $("#schedulePreviewArea").style.display = "";
      $("#scheduleRawText").textContent = pdfImport.texto;
      renderTabelaCronograma();
      var avisoLimite = extraido.linhas.length > window.CRONOGRAMA_PDF.maxLinhas ? " A prévia foi limitada a " + window.CRONOGRAMA_PDF.maxLinhas + " linhas." : "";
      if (pdfImport.linhas.length) {
        estadoImportacao("PDF lido: " + pdfImport.paginas + " página(s). Revise a empresa, a atividade e o status em cada linha antes de aplicar." + avisoLimite, "ok");
      } else {
        estadoImportacao("Extraí texto de " + pdfImport.paginas + " página(s), mas não reconheci linhas de atividade automaticamente. Adicione linhas manualmente ou envie este PDF para ajustarmos o leitor ao formato." + avisoLimite, "err");
      }
    } catch (erro) {
      estadoImportacao(erro && erro.message ? erro.message : "Não foi possível ler o PDF.", "err");
    } finally {
      pdfImport.carregando = false;
      $("#scheduleChooseFile").disabled = false;
      atualizarResumoCronograma();
    }
  }

  async function processarCsvImportacao(arquivo) {
    if (!arquivo) return;
    limparPreviasImportacao();
    var nomeArquivo = arquivo.name || "planilha.csv";
    $("#scheduleChooseFile").disabled = true;
    estadoImportacao("Lendo “" + nomeArquivo + "”… o arquivo permanece neste dispositivo.", "");
    try {
      if (!window.IMPORTAR_CSV) throw new Error("O leitor de CSV não carregou. Atualize a página e tente novamente.");
      var texto = await window.IMPORTAR_CSV.lerCsv(arquivo);
      var analise = window.IMPORTAR_CSV.analisarTexto(texto, db.empresas);
      csvImport = { arquivo: nomeArquivo, analise: analise, linhas: [], modo: "" };
      $("#importModeWrap").style.display = "";
      $("#importMode").value = analise.modo === "empresas" ? "empresas" : "cronograma";
      aplicarModoCsv($("#importMode").value, true);
    } catch (erro) {
      estadoImportacao(erro && erro.message ? erro.message : "Não foi possível ler o CSV.", "err");
    } finally {
      $("#scheduleChooseFile").disabled = false;
    }
  }

  function nomeDelimitador(d) {
    return d === ";" ? "ponto e vírgula" : d === "," ? "vírgula" : d === "\t" ? "tabulação" : "barra vertical";
  }

  function resumoColunasCsv(analise) {
    var rotulos = analise.colunas || {};
    var reconhecidas = Object.keys(rotulos).map(function (campo) { return campo + " ← “" + rotulos[campo] + "”"; });
    var ignoradas = (analise.cabecalho || []).filter(function (titulo) {
      return titulo && reconhecidas.join(" | ").indexOf("“" + String(titulo).trim() + "”") < 0;
    });
    return "Arquivo: " + csvImport.arquivo + "\n" +
      "Separador: " + nomeDelimitador(analise.delimitador) + " · " + analise.totalLinhas + " linha(s) de dados\n\n" +
      "Colunas reconhecidas:\n" + (reconhecidas.length ? "  " + reconhecidas.join("\n  ") : "  (nenhuma — o arquivo foi lido como texto)") +
      (ignoradas.length ? "\n\nColunas ignoradas:\n  " + ignoradas.join("\n  ") : "");
  }

  function aplicarModoCsv(modo, automatico) {
    var analise = csvImport.analise;
    if (!analise) return;
    var csv = window.IMPORTAR_CSV;
    var semCabecalho = !analise.comCabecalho;
    csvImport.modo = modo;
    atualizarRodapeImportacao(modo);
    $("#importModeHint").textContent = csvImport.arquivo + " · separador " + nomeDelimitador(analise.delimitador) +
      " · " + analise.totalLinhas + " linha(s) · " +
      (analise.comCabecalho ? Object.keys(analise.colunas).length + " coluna(s) reconhecida(s)" : "sem cabeçalho reconhecido");

    if (modo === "empresas") {
      var mapaEmpresas = analise.comCabecalho ? analise.mapa : csv.inferirColunas(analise.tabela, "empresas");
      csvImport.linhas = csv.interpretarEmpresas(analise.tabela, mapaEmpresas, db.empresas);
      $("#schedulePreviewArea").style.display = "none";
      $("#companyPreviewArea").style.display = "";
      $("#companyRawText").textContent = resumoColunasCsv(analise) +
        (semCabecalho ? "\n\nSem cabeçalho reconhecido: a 1ª coluna foi lida como empresa e as demais foram deduzidas pelo conteúdo." : "");
      renderTabelaEmpresas();
      var novas = csvImport.linhas.filter(function (r) { return !porId(r.empresaId); }).length;
      if (!csvImport.linhas.length) {
        estadoImportacao("Li o CSV (" + analise.totalLinhas + " linha(s)), mas não encontrei nomes de empresa. Confira se existe uma coluna “Empresa”.", "err");
      } else {
        estadoImportacao("CSV lido como carteira de empresas: " + csvImport.linhas.length + " linha(s), " + novas +
          " para cadastrar e " + (csvImport.linhas.length - novas) + " já no relatório." +
          (semCabecalho ? " Não reconheci um cabeçalho: a 1ª coluna virou o nome da empresa e as demais foram deduzidas pelo conteúdo." : "") +
          " Campos em branco não apagam o que já existe — revise antes de aplicar.", "ok");
      }
      return;
    }

    pdfImport = { arquivo: csvImport.arquivo, linhas: [], texto: "", paginas: 0, carregando: false, fonte: "CSV" };
    if (analise.comCabecalho) {
      pdfImport.linhas = csv.interpretarCronograma(analise.tabela, analise.mapa, db.empresas);
    } else if (window.CRONOGRAMA_PDF) {
      // sem cabeçalho: cada linha vira texto e passa pelo mesmo interpretador do PDF
      pdfImport.linhas = window.CRONOGRAMA_PDF.interpretarLinhas(analise.linhasTexto, db.empresas);
    }
    $("#companyPreviewArea").style.display = "none";
    $("#schedulePreviewArea").style.display = "";
    $("#scheduleRawLabel").textContent = "Ver as colunas reconhecidas no CSV";
    $("#scheduleRawText").textContent = resumoColunasCsv(analise) +
      (semCabecalho ? "\n\nSem cabeçalho reconhecido: as linhas foram interpretadas como texto (empresa, datas e status detectados pelo conteúdo)." : "");
    renderTabelaCronograma();
    var limite = analise.totalLinhas > csv.maxLinhas ? " A prévia foi limitada a " + csv.maxLinhas + " linhas." : "";
    var aCadastrar = pdfImport.linhas.filter(function (r) { return r.empresaId === "__nova__"; }).length;
    if (!pdfImport.linhas.length) {
      estadoImportacao("Li o CSV (" + analise.totalLinhas + " linha(s)), mas não reconheci itens de cronograma. Confira o cabeçalho (Empresa, Atividade, Previsto, Status…) ou troque o modo acima." + limite, "err");
    } else {
      estadoImportacao("CSV lido como cronograma: " + pdfImport.linhas.length + " item(ns) em " + nomeDelimitador(analise.delimitador) + "." +
        (semCabecalho ? " Não reconheci um cabeçalho: cada linha foi lida como texto, do mesmo jeito que o PDF." : "") +
        (aCadastrar ? " " + aCadastrar + " linha(s) são de empresas ainda não cadastradas — elas serão criadas se continuarem marcadas." : "") +
        " Revise a empresa, a atividade e o status antes de aplicar." + limite, "ok");
    }
    if (!automatico) toast("Modo de importação alterado.");
  }

  /* ---------- aplicar: cronograma ---------- */
  function statusAgregadoCronograma(linhas) {
    var estados = linhas.map(function (r) { return r.status; }).filter(function (s) { return !!STATUS[s] || s === "pendente"; });
    if (!estados.length) return "";
    var prioridade = ["risco", "cliente", "desenvolvimento", "andamento"];
    for (var i = 0; i < prioridade.length; i++) if (estados.indexOf(prioridade[i]) >= 0) return prioridade[i];
    if (estados.indexOf("pendente") >= 0) return "andamento";
    return linhas.length && linhas.every(function (r) { return r.status === "concluido"; }) ? "concluido" : "";
  }

  function progressoAgregadoCronograma(linhas) {
    var porcentagens = linhas.map(function (r) { return r.progresso; }).filter(function (n) { return n != null; });
    if (!porcentagens.length || (porcentagens.length !== linhas.length && linhas.length !== 1)) return null;
    return Math.round(porcentagens.reduce(function (a, n) { return a + n; }, 0) / porcentagens.length);
  }

  function aplicarCronogramaImportado() {
    atualizarLinhasDaPrevia();
    var fonte = pdfImport.fonte === "CSV" ? "CSV" : "PDF";
    var candidatas = pdfImport.linhas.filter(function (r) {
      if (!r.usar || !String(r.atividade || "").trim()) return false;
      return !!porId(r.empresaId) || (r.empresaId === "__nova__" && !!String(r.empresaCsv || "").trim());
    });
    if (!candidatas.length) { toast("Selecione ao menos uma linha e associe a uma empresa."); return; }

    var criadas = 0, novasPorNome = {};
    candidatas.forEach(function (linha) {
      if (linha.empresaId !== "__nova__") return;
      var nome = String(linha.empresaCsv || "").trim();
      var k = chaveNome(nome);
      if (!novasPorNome[k]) {
        novasPorNome[k] = criarEmpresaDoImport(nome, null, "Cadastrada pela importação de cronograma (" + fonte + ")");
        criadas++;
      }
      linha.empresaId = novasPorNome[k].id;
      linha.empresaNome = novasPorNome[k].nome;
    });

    var selecionadas = candidatas.filter(function (r) { return !!porId(r.empresaId); });
    var porEmpresa = {};
    selecionadas.forEach(function (linha) {
      if (!porEmpresa[linha.empresaId]) porEmpresa[linha.empresaId] = [];
      porEmpresa[linha.empresaId].push(linha);
    });
    var dataAtual = hoje(), atualizadas = 0, dadosStatusDetectados = 0;
    Object.keys(porEmpresa).forEach(function (empresaId) {
      var empresa = porId(empresaId), linhas = porEmpresa[empresaId];
      if (!empresa) return;
      // guarda o estado de antes para permitir "desvincular e voltar ao que era antes"
      var snapAntes = {
        status: empresa.status,
        progresso: empresa.progresso,
        statusText: empresa.statusText,
        cronograma: empresa.cronograma ? empresa.cronograma.slice() : [],
        atualizado: empresa.atualizado,
        origem: empresa.cronograma && empresa.cronograma.length ? String(empresa.cronograma[0].origem || "") : ""
      };
      // só sobrescreve o backup se ainda não existir um ou se o usuário não tiver desvinculado antes;
      // cada nova vinculação guarda o estado imediatamente anterior
      empresa.estadoAntesCronograma = snapAntes;
      empresa.cronograma = linhas.map(function (linha, i) {
        return {
          id: linha.id || ("import-" + dataAtual + "-" + i),
          atividade: linha.atividade.trim() || "Item do cronograma",
          fase: String(linha.fase || "").trim(),
          data: linha.data || "",
          visitaData: linha.visitaData || "",
          concluidoEm: linha.concluidoEm || "",
          responsavel: String(linha.responsavel || "").trim(),
          hora: linha.hora || "",
          categoria: linha.categoria === "visita" ? "visita" : "etapa",
          status: STATUS[linha.status] || linha.status === "pendente" ? linha.status : "",
          progresso: linha.progresso == null ? null : clamp(num(linha.progresso, 0), 0, 100),
          origem: pdfImport.arquivo,
          atualizado: dataAtual
        };
      });
      var novoStatus = statusAgregadoCronograma(linhas);
      var novoProgresso = progressoAgregadoCronograma(linhas);
      var concluidas = linhas.filter(function (r) { return r.status === "concluido"; }).length;
      var pendentes = linhas.filter(function (r) { return r.status === "pendente"; }).length;
      var temStatusReconhecido = linhas.some(function (r) { return !!STATUS[r.status] || r.status === "pendente"; });
      var resumo = "Cronograma atualizado via " + fonte + " em " + br(dataAtual) + ": " + linhas.length + " item(ns), " + concluidas + " concluído(s), " + pendentes + " pendente(s).";
      var mudouStatus = !!novoStatus && empresa.status !== novoStatus;
      var mudouProgresso = novoProgresso != null && empresa.progresso !== novoProgresso;
      if (novoStatus) empresa.status = novoStatus;
      if (novoProgresso != null) empresa.progresso = novoProgresso;
      if (novoStatus || novoProgresso != null || temStatusReconhecido) empresa.statusText = resumo;
      empresa.atualizado = dataAtual;
      empresa.historico = empresa.historico || [];
      empresa.historico.unshift({
        data: dataAtual,
        progresso: empresa.progresso,
        status: empresa.status,
        texto: (mudouStatus || mudouProgresso ? "Atualizado via cronograma (" + fonte + "): " : "Cronograma importado (" + fonte + "): ") +
          linhas.length + " item(ns), " + concluidas + " concluído(s)."
      });
      empresa.historico = empresa.historico.slice(0, 30);
      tocados[empresa.id] = true;
      atualizadas++;
      if (novoStatus || novoProgresso != null || temStatusReconhecido) dadosStatusDetectados++;
    });
    db.data = dataAtual;
    if (!salvar()) return;
    fecharImportadorCronograma();
    renderTudo();
    toast(atualizadas + " empresa(s) atualizada(s) pelo cronograma" + (criadas ? " · " + criadas + " cadastrada(s)" : "") +
      (dadosStatusDetectados ? " · status/progresso conferidos" : " · o arquivo não trouxe status reconhecível"));
  }

  /* ---------- DESVINCULAR CRONOGRAMA ---------- */
  function textoResumoEstado(e) {
    if (!e) return "—";
    var base = e.estadoAntesCronograma;
    if (base) {
      var lbl = STATUS[base.status] ? STATUS[base.status].label : (base.status === "pendente" ? "Pendente" : "—");
      var prog = base.progresso != null ? base.progresso + "%" : "—";
      var cronoQtd = base.cronograma ? base.cronograma.length : 0;
      var extra = cronoQtd ? " · " + cronoQtd + " item(ns) de cronograma" : " · sem cronograma";
      var orig = base.origem ? " (" + base.origem + ")" : "";
      return lbl + " · " + prog + " · " + (base.statusText || "sem statusText") + extra + orig + " · atualizado " + (base.atualizado ? br(base.atualizado) : "—");
    }
    var b = baselineComparavel().porNome[chaveNome(e.nome)];
    if (b) {
      var lbl2 = STATUS[b.status] ? STATUS[b.status].label : b.status;
      return lbl2 + " · " + b.progresso + "% · " + (b.statusText || "—") + " · baseline de " + br(b.atualizado);
    }
    return "Removerá apenas o cronograma (" + (e.cronograma ? e.cronograma.length : 0) + " itens) e manterá o status atual preenchido no formulário.";
  }

  function detalhesRestauracao(e) {
    if (!e || !e.cronograma || !e.cronograma.length) return "Esta empresa não tem cronograma vinculado.";
    var snap = e.estadoAntesCronograma;
    if (snap) {
      var lbl = STATUS[snap.status] ? STATUS[snap.status].label : (snap.status || "—");
      var prog = snap.progresso != null ? snap.progresso + "%" : "—";
      var qtd = snap.cronograma ? snap.cronograma.length : 0;
      return "Cronograma atual: " + e.cronograma.length + " item(ns) de " + esc(e.cronograma[0].origem || "importação") + "\n" +
        "Estado que será restaurado:\n" +
        "  Status: " + lbl + "\n" +
        "  Progresso: " + prog + "\n" +
        "  Status atual: " + (snap.statusText || "—") + "\n" +
        "  Cronograma anterior: " + qtd + " item(ns)" + (snap.origem ? " (" + snap.origem + ")" : "") + "\n" +
        "  Atualizado em: " + (snap.atualizado ? br(snap.atualizado) : "—");
    }
    var base = baselineComparavel().porNome[chaveNome(e.nome)];
    if (base) {
      var lblb = STATUS[base.status] ? STATUS[base.status].label : base.status;
      return "Cronograma atual: " + e.cronograma.length + " item(ns)\n" +
        "Não há backup salvo desta vinculação. Ao desvincular, a empresa voltará ao baseline original:\n" +
        "  Status: " + lblb + "\n" +
        "  Progresso: " + base.progresso + "%\n" +
        "  Status atual: " + (base.statusText || "—") + "\n" +
        "  Atualizado em: " + br(base.atualizado);
    }
    return "Cronograma atual: " + e.cronograma.length + " item(ns) de " + esc(e.cronograma[0].origem || "importação") + "\n" +
      "Não há estado anterior salvo. O cronograma será removido e o status/progresso atuais do formulário serão mantidos.";
  }

  function desvincularCronogramaEmpresa(eid) {
    var e = porId(eid);
    if (!e || !e.cronograma || !e.cronograma.length) { toast("Esta empresa não tem cronograma vinculado."); return; }
    var snap = e.estadoAntesCronograma;
    var base = baselineComparavel().porNome[chaveNome(e.nome)];
    var msg = "";
    if (snap) {
      var lbl = STATUS[snap.status] ? STATUS[snap.status].label : snap.status;
      msg = "Desvincular o cronograma de \"" + e.nome + "\" e voltar ao que era antes?\n\n" +
        "Cronograma atual: " + e.cronograma.length + " item(ns) de " + (e.cronograma[0].origem || "importação") + ".\n" +
        "Voltará para: " + lbl + " · " + (snap.progresso != null ? snap.progresso + "%" : "—") + " · " + br(snap.atualizado) + ".\n" +
        "Isso remove o cronograma vinculado e restaura o status/progresso anteriores.";
    } else if (base) {
      var lblb = STATUS[base.status] ? STATUS[base.status].label : base.status;
      msg = "Desvincular o cronograma de \"" + e.nome + "\" e restaurar os dados originais?\n\n" +
        "Cronograma atual: " + e.cronograma.length + " item(ns).\n" +
        "Não há backup da vinculação, então voltará ao baseline: " + lblb + " · " + base.progresso + "% · " + br(base.atualizado) + ".";
    } else {
      msg = "Desvincular o cronograma de \"" + e.nome + "\"? Isso removerá " + e.cronograma.length + " item(ns) vinculados e manterá o status atual.";
    }
    if (!window.confirm(msg)) return;
    if (snap) {
      e.status = snap.status && STATUS[snap.status] ? snap.status : (snap.status === "pendente" ? "andamento" : e.status);
      // se o backup não tinha progresso, mantém o atual
      if (snap.progresso != null) e.progresso = snap.progresso;
      e.statusText = snap.statusText || "";
      e.cronograma = snap.cronograma ? snap.cronograma.slice() : [];
      e.estadoAntesCronograma = null;
      // mantém a data do backup ou usa hoje como atualização do desfazer
      e.atualizado = hoje();
    } else if (base) {
      e.status = base.status;
      e.progresso = base.progresso;
      e.statusText = base.statusText;
      e.cronograma = base.cronograma ? base.cronograma.slice() : [];
      e.feito = base.feito.slice();
      e.falta = base.falta.slice();
      e.fases = base.fases.map(function (f) { return f.slice(); });
      e.estadoAntesCronograma = null;
      e.atualizado = hoje();
    } else {
      e.cronograma = [];
      e.estadoAntesCronograma = null;
      e.atualizado = hoje();
    }
    e.historico = e.historico || [];
    e.historico.unshift({ data: e.atualizado, progresso: e.progresso, status: e.status, texto: "Cronograma desvinculado — voltou ao estado anterior" });
    e.historico = e.historico.slice(0, 30);
    tocados[e.id] = true;
    if (!gravarCache()) return;
    sync.alterou();
    renderTudo();
    if (ui.aberto === eid) abrirDetalhe(eid);
    toast(e.nome + " — cronograma desvinculado e estado anterior restaurado.");
  }

  /* ---------- aplicar: carteira de empresas ---------- */
  function mesclarLista(atual, novos, modo) {
    if (!novos || !novos.length) return atual;
    if (modo === "substituir") return novos.slice(0, 60);
    var vistos = {};
    atual.forEach(function (v) { vistos[chaveTexto(v)] = true; });
    novos.forEach(function (v) {
      var k = chaveTexto(v);
      if (k && !vistos[k]) { vistos[k] = true; atual.push(v); }
    });
    return atual.slice(0, 60);
  }

  function aplicarEmpresasCsv() {
    atualizarLinhasEmpresasDaPrevia();
    var modoListas = $("#companyListMode").value === "substituir" ? "substituir" : "acrescentar";
    var selecionadas = csvImport.linhas.filter(function (r) { return r.usar && (porId(r.empresaId) || String(r.nome || "").trim()); });
    if (!selecionadas.length) { toast("Selecione ao menos uma linha com nome de empresa."); return; }

    var dataAtual = hoje(), criadas = 0, atualizadas = 0, criadasPorNome = {};
    selecionadas.forEach(function (linha) {
      var alvo = porId(linha.empresaId);
      var nome = String(linha.nome || "").trim();
      // duas linhas da mesma empresa nova viram uma empresa só
      if (!alvo && nome) alvo = criadasPorNome[chaveNome(nome)] || null;
      var dataLinha = linha.atualizado || dataAtual;
      if (!alvo) {
        criadasPorNome[chaveNome(nome)] = criarEmpresaDoImport(nome, {
          tipo: linha.tipo, status: linha.status, progresso: linha.progresso,
          statusText: linha.statusText, feito: linha.feito, falta: linha.falta,
          grupo: linha.grupo, observacao: linha.observacao, atualizado: dataLinha
        }, "Cadastrada pela planilha " + csvImport.arquivo);
        criadas++;
        return;
      }
      var mudou = [];
      if (String(linha.tipo || "").trim() && linha.tipo !== alvo.tipo) { alvo.tipo = String(linha.tipo).trim().slice(0, 80); mudou.push("tipo"); }
      if (STATUS[linha.status] && linha.status !== alvo.status) { alvo.status = linha.status; mudou.push("status"); }
      if (linha.progresso != null && clamp(num(linha.progresso, 0), 0, 100) !== alvo.progresso) { alvo.progresso = clamp(num(linha.progresso, 0), 0, 100); mudou.push("progresso"); }
      if (String(linha.statusText || "").trim()) { alvo.statusText = String(linha.statusText).trim(); mudou.push("status atual"); }
      if (String(linha.observacao || "").trim()) alvo.observacao = String(linha.observacao).trim();
      var antesItens = alvo.feito.length + alvo.falta.length + alvo.grupo.length;
      alvo.feito = mesclarLista(alvo.feito, linha.feito, modoListas);
      alvo.falta = mesclarLista(alvo.falta, linha.falta, modoListas);
      alvo.grupo = mesclarLista(alvo.grupo, linha.grupo, modoListas);
      var deltaItens = alvo.feito.length + alvo.falta.length + alvo.grupo.length - antesItens;
      if (deltaItens) mudou.push(Math.abs(deltaItens) + " item(ns)");
      alvo.atualizado = dataLinha;
      alvo.historico = alvo.historico || [];
      alvo.historico.unshift({
        data: dataLinha, progresso: alvo.progresso, status: alvo.status,
        texto: ("Atualizada por CSV: " + (mudou.length ? mudou.join(", ") : "sem mudanças de campo")).slice(0, 90)
      });
      alvo.historico = alvo.historico.slice(0, 30);
      tocados[alvo.id] = true;
      atualizadas++;
    });

    db.data = dataAtual;
    if (!salvar()) return;
    fecharImportadorCronograma();
    ui.sort = "origem";
    renderTudo();
    toast(criadas + " empresa(s) cadastrada(s) · " + atualizadas + " atualizada(s) pelo CSV" +
      (sync.ativo() ? " — enviando para a equipe…" : ""));
  }

  /* ---------- eventos do importador ---------- */
  $("#btnScheduleImport").onclick = abrirImportadorCronograma;
  $("#mImportSchedule").onclick = function () { $("#menu").classList.remove("open"); abrirImportadorCronograma(); };
  $("#closeSchedule").onclick = fecharImportadorCronograma;
  $("#cancelSchedule").onclick = fecharImportadorCronograma;
  $("#scheduleBackdrop").onclick = function (e) { if (e.target === this) fecharImportadorCronograma(); };
  $("#scheduleChooseFile").onclick = function () { $("#scheduleFileInput").click(); };
  $("#scheduleFileInput").onchange = function () {
    var arquivo = this.files && this.files[0];
    this.value = "";
    processarArquivoImportacao(arquivo);
  };
  $("#scheduleAddRow").onclick = adicionarLinhaCronogramaManual;
  $("#scheduleLinkApply").onclick = vincularTodasAtividades;
  $("#scheduleApply").onclick = function () {
    if (modoImportacaoAtual() === "empresas") aplicarEmpresasCsv();
    else aplicarCronogramaImportado();
  };
  $("#importMode").onchange = function () { aplicarModoCsv(this.value, false); };
  $("#companyListMode").onchange = function () { atualizarResumoEmpresas(); };
  $("#scheduleModelSchedule").onclick = function () {
    baixar("modelo-cronograma.csv", "\uFEFF" + window.IMPORTAR_CSV.modeloCronograma, "text/csv;charset=utf-8");
    toast("Modelo de cronograma em CSV baixado.");
  };
  $("#scheduleModelCompanies").onclick = function () {
    baixar("modelo-empresas.csv", "\uFEFF" + window.IMPORTAR_CSV.modeloEmpresas, "text/csv;charset=utf-8");
    toast("Modelo de carteira em CSV baixado.");
  };
  $("#schedulePreview").onchange = function (ev) {
    var linha = ev.target.closest("tr[data-pdf-row]");
    if (!linha) return;
    var idx = num(linha.dataset.pdfRow, -1), item = pdfImport.linhas[idx];
    if (!item) return;
    var campo = ev.target.dataset.field;
    if (campo === "usar") item.usar = ev.target.checked;
    else if (campo === "progresso") item.progresso = ev.target.value === "" ? null : clamp(num(ev.target.value, 0), 0, 100);
    else item[campo] = ev.target.value;
    if (campo === "empresaId") {
      var empresa = porId(item.empresaId);
      item.empresaNome = empresa ? empresa.nome : (item.empresaId === "__nova__" ? String(item.empresaCsv || "") : "");
      if (empresa || item.empresaId === "__nova__") item.usar = true;
    }
    if (campo === "empresaId" || campo === "usar") {
      var check = $("input[data-field=usar]", linha);
      if (check) check.checked = item.usar;
    }
    atualizarResumoCronograma();
  };
  $("#schedulePreview").oninput = function (ev) {
    var linha = ev.target.closest("tr[data-pdf-row]");
    if (!linha || ev.target.dataset.field !== "atividade") return;
    var item = pdfImport.linhas[num(linha.dataset.pdfRow, -1)];
    if (item) item.atividade = ev.target.value;
  };
  $("#companyPreview").onchange = function (ev) {
    var linha = ev.target.closest("tr[data-company-row]");
    if (!linha) return;
    var item = csvImport.linhas[num(linha.dataset.companyRow, -1)];
    if (!item) return;
    var campo = ev.target.dataset.field;
    if (campo === "usar") item.usar = ev.target.checked;
    else if (campo === "progresso") item.progresso = ev.target.value === "" ? null : clamp(num(ev.target.value, 0), 0, 100);
    else if (campo === "feito" || campo === "falta") item[campo] = listaDoCampo(ev.target.value);
    else if (campo !== "nome") item[campo] = ev.target.value;
    if (campo === "empresaId") {
      var alvo = porId(item.empresaId);
      var inputNome = $("input[data-field=nome]", linha);
      if (inputNome) {
        inputNome.disabled = !!alvo;
        inputNome.value = alvo ? alvo.nome : (item.empresaCsv || item.nome);
      }
      if (!alvo) item.nome = item.empresaCsv || item.nome;
      item.usar = true;
      var check = $("input[data-field=usar]", linha);
      if (check) check.checked = true;
    }
    atualizarResumoEmpresas();
  };
  $("#companyPreview").oninput = function (ev) {
    var linha = ev.target.closest("tr[data-company-row]");
    if (!linha) return;
    var item = csvImport.linhas[num(linha.dataset.companyRow, -1)];
    var campo = ev.target.dataset.field;
    if (!item || ev.target.disabled) return;
    if (campo === "nome" || campo === "statusText" || campo === "tipo") item[campo] = ev.target.value;
  };
  var scheduleDrop = $("#scheduleDrop");
  scheduleDrop.addEventListener("dragover", function (e) { e.preventDefault(); scheduleDrop.classList.add("drag"); });
  scheduleDrop.addEventListener("dragleave", function () { scheduleDrop.classList.remove("drag"); });
  scheduleDrop.addEventListener("drop", function (e) {
    e.preventDefault(); scheduleDrop.classList.remove("drag");
    var arquivo = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (arquivo) processarArquivoImportacao(arquivo);
  });

  $("#mReset").onclick = function () {
    var b = baseline();
    var aoServidor = sync.ativo();
    var aviso = aoServidor
      ? "Restaurar o relatório original (dados de " + br(b.data) + ")?\n\nATENÇÃO: com o servidor compartilhado ligado, isso envia o baseline para o banco e vale para a EQUIPE INTEIRA — as alterações de todo mundo que não estejam no dados.js serão perdidas."
      : "Restaurar o relatório original (dados de " + br(b.data) + ")? As alterações salvas neste navegador serão descartadas.";
    if (!window.confirm(aviso)) return;
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    db = b;
    ui = { status: "all", type: "all", q: "", sort: "origem", aberto: null, present: 0 };
    $("#q").value = "";
    fecharDetalhe(); fecharEditor();
    var fim = function () { renderTudo(); toast("Relatório original restaurado."); };
    if (aoServidor) sync.substituirTudo(db).then(fim); else fim();
  };

  /* ================= MENU / TEMA / TOPO ================= */
  $("#btnMenu").onclick = function (e) { e.stopPropagation(); $("#menu").classList.toggle("open"); };
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#menu")) $("#menu").classList.remove("open");
  });

  function aplicarTema(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("#btnTheme").textContent = t === "dark" ? "☀" : "☾";
    try { localStorage.setItem(LS_TEMA, t); } catch (e) {}
  }
  $("#btnTheme").onclick = function () {
    aplicarTema(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  };

  $("#dataRel").onchange = function () {
    db.data = this.value || hoje();
    salvar(); renderTopo(); renderFooter();
    toast("Data do levantamento atualizada.");
  };

  $("#btnNew").onclick = function () { abrirEditor(null); };
  $("#btnPrint").onclick = function () { window.print(); };
  $("#btnPresent").onclick = function () { document.body.classList.add("focus"); ui.present = 0; renderPresent(); };
  $("#btnClear").onclick = function () { ui.status = "all"; ui.type = "all"; ui.q = ""; $("#q").value = ""; renderFiltros(); renderGrid(); };

  $("#q").addEventListener("input", function (e) {
    ui.q = e.target.value.trim();
    ui.present = 0;
    renderGrid();
    if (document.body.classList.contains("focus")) renderPresent();
  });

  /* ================= MODAIS: FECHAR / TECLAS ================= */
  $("#closeModal").onclick = fecharDetalhe;
  $("#backdrop").onclick = function (e) { if (e.target === this) fecharDetalhe(); };
  $("#prev").onclick = function () { navegar(-1); };
  $("#next").onclick = function () { navegar(1); };
  $("#closeEditor").onclick = fecharEditor;
  $("#cancelEditor").onclick = fecharEditor;
  $("#editorBackdrop").onclick = function (e) { if (e.target === this) fecharEditor(); };

  document.addEventListener("keydown", function (e) {
    var digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "");
    if (e.key === "/" && !digitando) { e.preventDefault(); $("#q").focus(); return; }
    if (e.key === "Escape") {
      if ($("#scheduleBackdrop").classList.contains("on")) fecharImportadorCronograma();
      else if ($("#syncBackdrop").classList.contains("on")) fecharSync();
      else if ($("#editorBackdrop").classList.contains("on")) fecharEditor();
      else if ($("#backdrop").classList.contains("on")) fecharDetalhe();
      else if (document.body.classList.contains("focus")) document.body.classList.remove("focus");
      else $("#menu").classList.remove("open");
      return;
    }
    if (document.body.classList.contains("focus")) {
      var n = filtradas().length;
      if (e.key === "ArrowRight" || e.key === "PageDown") { ui.present = (ui.present + 1) % n; renderPresent(); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { ui.present = (ui.present - 1 + n) % n; renderPresent(); }
      return;
    }
    if (ui.aberto) {
      if (e.key === "ArrowRight") navegar(1);
      if (e.key === "ArrowLeft") navegar(-1);
    }
  });

  /* ================= APRESENTAÇÃO ================= */
  function renderPresent() {
    var lista = filtradas();
    if (!lista.length) {
      $("#stage").innerHTML = '<div class="sh"><button class="btn" data-exit>← Sair</button></div>' +
        '<div class="card"><p class="none">Nada para exibir com os filtros atuais.</p></div>';
      $("[data-exit]").onclick = sairPresent;
      return;
    }
    ui.present = clamp(ui.present, 0, lista.length - 1);
    var e = lista[ui.present];
    var c = STATUS[e.status].color;
    $("#stage").innerHTML =
      '<div class="sh">' +
        '<button class="btn" data-exit>← Sair da apresentação</button>' +
        '<div style="display:flex;gap:9px;align-items:center">' +
          '<span class="hint">' + (ui.present + 1) + " de " + lista.length + " · " + STATUS[e.status].label + "</span>" +
          '<button class="btn" id="pPrev">←</button><button class="btn" id="pNext">→</button>' +
        "</div>" +
      "</div>" +
      '<div class="big" style="--c:' + c + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">' +
          "<div><h2>" + esc(e.nome) + '</h2><div class="subline">' + esc(e.tipo) + "</div></div>" +
          '<div style="text-align:right"><div class="pct">' + e.progresso + '%</div><div class="subline">progresso</div></div>' +
        "</div>" +
        '<div class="prog-big"><i style="width:' + e.progresso + '%"></i></div>' +
        '<div class="pipeline">' + passos(e) + "</div>" +
        '<div class="cols">' +
          '<div class="box"><h4>O que já foi feito</h4>' + (e.feito.length ? '<ul class="list">' + e.feito.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="none">—</p>') + "</div>" +
          '<div class="box"><h4>O que ainda falta fazer</h4>' + (e.falta.length ? '<ul class="list pend">' + e.falta.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="none">—</p>') + "</div>" +
        "</div>" +
        (e.statusText ? '<div class="statusbox"><h4>Status atual</h4><p>' + esc(e.statusText) + "</p></div>" : "") +
      "</div>";
    $("[data-exit]").onclick = sairPresent;
    $("#pPrev").onclick = function () { ui.present = (ui.present - 1 + lista.length) % lista.length; renderPresent(); };
    $("#pNext").onclick = function () { ui.present = (ui.present + 1) % lista.length; renderPresent(); };
  }
  function sairPresent() { document.body.classList.remove("focus"); }

  /* ================= SERVIDOR COMPARTILHADO: LIGAÇÃO + UI ================= */
  function iniciarSync() {
    return sync.iniciar({
      getDb: function () { return db; },
      setDb: function (novo) { db = novo; gravarCache(); renderTudo(); },
      normalizar: normalizar,
      hoje: hoje,
      tocado: function (eid) { return !!tocados[eid]; },
      baseline: baselineComparavel,
      toast: toast,
      salvarCache: gravarCache,
      aoStatus: function () { renderFooter(); if ($("#syncBackdrop").classList.contains("on")) renderSync(); },
      aoRemoto: function (ids) {
        if (!ids.length) return;
        if (ui.aberto && ids.indexOf(ui.aberto) >= 0) abrirDetalhe(ui.aberto);
        if (editando && ids.indexOf(editando) >= 0) {
          toast("Outra pessoa mexeu nesta empresa enquanto você editava — salvar sobrescreve.");
          return;
        }
        toast(ids.length === 1 ? "Atualização da equipe aplicada." : ids.length + " atualizações da equipe aplicadas.");
      },
      aoPublicar: function () { tocados = {}; toast("Publicado para a equipe ☁"); }
    }).then(function (ok) { renderFooter(); return ok; });
  }

  function abrirSync() { $("#syncBackdrop").classList.add("on"); preencherSync(); }
  function fecharSync() { $("#syncBackdrop").classList.remove("on"); }

  function preencherSync() {
    var c = sync.config();
    if ($("#syncUrl").value !== c.url) $("#syncUrl").value = c.url || "";
    if ($("#syncKey").value !== c.anonKey) $("#syncKey").value = c.anonKey || "";
    renderSync();
  }

  function renderSync() {
    var s = sync.estado();
    var cor = { "ao-vivo": "var(--ok)", conectando: "var(--wait)", erro: "var(--risk)" }[s.modo] || "var(--muted)";
    var rot = {
      "ao-vivo": s.pendente ? "conectado · enviando o que mudou…" : "conectado · tempo real ligado",
      conectando: "conectando…",
      erro: "erro de conexão",
      local: "desligado — as alterações ficam só neste navegador",
      off: "desligado"
    }[s.modo] || s.modo;
    var conf = s.config || {};

    $("#syncStatus").innerHTML =
      '<div style="display:flex;gap:10px;align-items:flex-start">' +
        '<span style="width:9px;height:9px;border-radius:50%;background:' + cor + ';margin-top:5px;flex:none"></span>' +
        '<div style="min-width:0"><b>' + esc(rot) + "</b>" +
        (s.msg ? '<div style="color:var(--muted);font-size:12.5px;margin-top:3px;overflow-wrap:anywhere">' + esc(s.msg) + "</div>" : "") +
        '<div style="color:var(--faint);font-size:12px;margin-top:6px">última sincronização ' + hora(s.ultimaSync) +
        " · " + s.linhas + " empresa(s) no servidor · tabela <code>" + esc(conf.table || "documentos") + "</code></div>" +
        '<div style="color:var(--faint);font-size:12px;margin-top:3px">URL do projeto: <code>' +
          esc(conf.url || "—") + "</code> · chave: " + (conf.anonKey ? "definida (" + String(conf.anonKey).length + " caracteres)" : "não definida") +
        "</div></div>" +
      "</div>";

    var acoes = "";
    if (s.modo === "ao-vivo") {
      acoes = '<button class="btn sm" data-acao="puxar">↻ Buscar alterações agora</button>' +
        '<button class="btn sm" data-acao="forcar">Publicar este navegador inteiro</button>' +
        '<button class="btn sm" data-acao="reset">Zerar o banco e recriar do zero</button>';
    }
    $("#syncAcoes").innerHTML = acoes;
    $$("#syncAcoes [data-acao]").forEach(function (b) {
      b.onclick = function () { acaoSync(b.dataset.acao); };
    });

    $("#syncBaixar").style.display = conf.url && conf.anonKey ? "" : "none";

    $("#syncPassos").innerHTML = s.modo === "ao-vivo" ? "" :
      '<h4 style="margin:14px 0 0;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:650">Ligar em 4 passos</h4>' +
      '<ol class="passos">' +
        "<li><b>Criar o projeto</b> — em <code>supabase.com</code>: <i>New project</i>, região South America (São Paulo). É gratuito e leva 1 minuto.</li>" +
        "<li><b>Rodar o SQL</b> — <i>SQL Editor → New query</i>, cole o conteúdo de <code>supabase.sql</code> deste repositório e clique <i>Run</i>. Cria a tabela <code>documentos</code>, libera acesso para quem tem o link e liga o tempo real.</li>" +
        "<li><b>Copiar as chaves</b> — <i>Project Settings → API</i>: <code>Project URL</code> e <code>anon public key</code>. Cole nos campos acima e clique <b>Testar e conectar</b> para ver funcionando já neste navegador.</li>" +
        "<li><b>Valer para todos</b> — clique <b>Baixar sync-config.js pronto</b>, substitua o arquivo no repositório e faça commit. A Vercel republica e o mesmo link passa a ser compartilhado pela equipe.</li>" +
      "</ol>";
  }

  function acaoSync(qual) {
    if (qual === "puxar") { sync.sincronizarAgora().then(function () { toast("Procurado no servidor."); }); }
    if (qual === "forcar") {
      if (!window.confirm("Enviar as " + db.empresas.length + " empresas deste navegador para o servidor (sem apagar as que só existem lá)?")) return;
      sync.forcarPublicacao().then(function (ok) { toast(ok ? "Enviado para a equipe." : "Não consegui enviar — veja o estado acima."); });
    }
    if (qual === "reset") {
      if (!window.confirm("Apagar TODAS as linhas do servidor e publicar o relatório deste navegador no lugar? Isso vale para a equipe inteira.")) return;
      sync.substituirTudo(db).then(function (ok) { toast(ok ? "Servidor recriado a partir deste navegador." : "Não consegui recriar."); });
    }
  }

  $("#syncPill").onclick = abrirSync;
  $("#mSync").onclick = function () { $("#menu").classList.remove("open"); abrirSync(); };
  $("#mPull").onclick = function () {
    $("#menu").classList.remove("open");
    if (!sync.ativo()) { abrirSync(); toast("Sem servidor configurado ainda."); return; }
    sync.sincronizarAgora().then(function () { toast("Relatório comparado com o servidor."); });
  };
  $("#closeSync").onclick = fecharSync;
  $("#syncFechar").onclick = fecharSync;
  $("#syncBackdrop").onclick = function (e) { if (e.target === this) fecharSync(); };

  $("#syncTestar").onclick = function () {
    var u = $("#syncUrl").value.trim(), k = $("#syncKey").value.trim();
    if (!u || !k) { toast("Cole a URL e a anon key do Supabase."); return; }
    toast("Conectando…");
    sync.reconectar(u, k).then(function (ok) {
      renderTudo();
      renderSync();
      if (ok) toast("Conectado: o que você alterar vai para a equipe.");
      else toast("Não conectou — " + (sync.estado().msg || "veja os passos abaixo"));
    });
  };

  $("#syncBaixar").onclick = function () {
    var u = $("#syncUrl").value.trim(), k = $("#syncKey").value.trim();
    if (!u || !k) { toast("Cole a URL e a anon key primeiro."); return; }
    baixar("sync-config.js", sync.textoDoArquivoConfig(u, k), "text/javascript;charset=utf-8");
    toast("sync-config.js baixado — substitua o arquivo no repositório e faça commit.");
  };

  $("#syncEsquecer").onclick = function () {
    sync.esquecerConfig();
    preencherSync();
    renderTudo();
    toast("Chaves esquecidas neste navegador. O app volta a salvar só localmente.");
  };

  /* ================= INIT ================= */
  (function init() {
    var t = "light";
    try { t = localStorage.getItem(LS_TEMA) || "light"; } catch (e) {}
    aplicarTema(t);
    db = carregar();
    renderTudo();
    iniciarSync();
  })();
})();
