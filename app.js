/* =====================================================================
   RELATÓRIO DE IMPLANTAÇÕES — aplicação
   ---------------------------------------------------------------------
   · Lê o baseline de dados.js (window.DADOS_INICIAIS)
   · Guarda as alterações no navegador (localStorage) -> cache, abre na hora
   · Sincroniza com o Supabase via sync.js -> o que um altera vale para todos
   · Permite cadastrar novas empresas e atualizar as existentes
   · Exporta/importa JSON (backup) e gera o dados.js para commitar no Git
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
  var pdfImport = { arquivo: "", linhas: [], texto: "", paginas: 0, carregando: false };
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

  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  /* ================= PERSISTÊNCIA ================= */
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
      cronograma: limparCronograma(e.cronograma)
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

  function renderReports() {
    var faixas = [
      { label: "0–25%", min: 0, max: 25 },
      { label: "26–50%", min: 26, max: 50 },
      { label: "51–75%", min: 51, max: 75 },
      { label: "76–99%", min: 76, max: 99 },
      { label: "100%", min: 100, max: 100 }
    ];
    var contagens = faixas.map(function (f) {
      return db.empresas.filter(function (e) {
        var pct = e.status === "concluido" ? 100 : e.progresso;
        return pct >= f.min && pct <= f.max;
      }).length;
    });
    var maxFaixa = Math.max.apply(null, contagens.concat([1]));
    $("#progressReport").innerHTML = db.empresas.length ? faixas.map(function (f, i) {
      var n = contagens[i];
      return '<div class="report-bar"><span class="label">' + f.label + "</span>" +
        '<div class="bar-track"><div class="bar-fill" style="width:' + (n / maxFaixa * 100) + '%;background:var(--accent)"></div></div>' +
        '<b class="value">' + n + "</b></div>";
    }).join("") + '<p class="report-note">Média da carteira: ' + mediaProgresso() + "% de progresso.</p>"
      : '<p class="none">Nenhuma empresa cadastrada.</p>';

    var ranking = db.empresas.map(function (e) {
      var itensAbertos = (e.cronograma || []).filter(function (item) { return item.status !== "concluido"; }).length;
      var quantidade = e.falta.length + itensAbertos;
      return { empresa: e, quantidade: quantidade, base: e.falta.length + " pendências · " + itensAbertos + " itens de cronograma" };
    }).filter(function (r) { return r.quantidade > 0; }).sort(function (a, b) {
      var riscoA = a.empresa.status === "risco" ? 1 : 0, riscoB = b.empresa.status === "risco" ? 1 : 0;
      return riscoB - riscoA || b.quantidade - a.quantidade || a.empresa.nome.localeCompare(b.empresa.nome, "pt-BR");
    }).slice(0, 6);
    $("#priorityReport").innerHTML = ranking.length
      ? '<div class="report-list">' + ranking.map(function (r) {
          return '<div class="report-row"><div style="min-width:0"><button class="report-company" data-report-company="' + esc(r.empresa.id) + '">' + esc(r.empresa.nome) + "</button>" +
            '<div class="report-meta">' + esc(STATUS[r.empresa.status].label) + " · " + esc(r.base) + "</div></div>" +
            '<span class="report-count">' + r.quantidade + " em aberto</span></div>";
        }).join("") + "</div>"
      : '<p class="none">Nenhuma pendência registrada.</p>';

    var todos = itensCronograma();
    var emAberto = todos.filter(function (reg) { return reg.item.status !== "concluido"; });
    var atrasados = emAberto.filter(function (reg) { return reg.item.data && reg.item.data < hoje(); }).length;
    var visitas = emAberto.filter(function (reg) { return reg.item.categoria === "visita"; }).length;
    emAberto.sort(function (a, b) {
      var da = a.item.data || "9999-99-99", dbb = b.item.data || "9999-99-99";
      return da.localeCompare(dbb) || String(a.item.hora || "").localeCompare(String(b.item.hora || ""));
    });
    $("#agendaReport").innerHTML = todos.length
      ? '<div class="report-summary" style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:8px">' +
        '<span class="report-badge' + (atrasados ? " atrasado" : "") + '">' + atrasados + " vencidos</span>" +
        '<span class="report-badge visita">' + visitas + " visitas em aberto</span>" +
        '<span class="report-badge">' + todos.length + " eventos (etapas/visitas)</span></div>" +
        (emAberto.length ? '<div class="report-list">' + emAberto.slice(0, 6).map(function (reg) {
          var item = reg.item, vencido = item.data && item.data < hoje();
          var status = rotuloStatusCronograma(item.status);
          return '<div class="report-row"><div style="min-width:0"><button class="report-company" data-report-company="' + esc(reg.empresa.id) + '">' + esc(reg.empresa.nome) + "</button>" +
            '<div class="report-meta">' + esc(item.atividade) + " · " + esc(status) + "</div>" +
            '<span class="report-badge ' + (item.categoria === "visita" ? "visita" : "") + '">' + (item.categoria === "visita" ? "Visita" : "Etapa") + "</span>" +
            (vencido ? ' <span class="report-badge atrasado">Vencido</span>' : "") + "</div>" +
            '<span class="report-date">' + (item.data ? esc(br(item.data)) : "Sem data") + (item.hora ? "<br>" + esc(item.hora) : "") + "</span></div>";
        }).join("") + "</div>" : '<p class="none">Todos os itens do cronograma estão concluídos.</p>')
      : '<p class="none">Importe um cronograma PDF para preencher este relatório de agenda e visitas.</p><button type="button" class="btn sm" id="reportImportSchedule">Importar cronograma PDF</button>';

    $$("[data-report-company]").forEach(function (button) {
      button.onclick = function () { abrirDetalhe(button.dataset.reportCompany); };
    });
    var importar = $("#reportImportSchedule");
    if (importar) importar.onclick = abrirImportadorCronograma;
  }

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
      ? '<div class="statusbox"><h4>Agenda / cronograma (' + e.cronograma.length + ')</h4><div class="schedule-items">' +
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
        "</div></div>"
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
      cronograma: antigo ? (antigo.cronograma || []).slice() : []
    };

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

    tocados[reg.id] = true;
    if (antigo) {
      var i = db.empresas.indexOf(antigo);
      db.empresas[i] = reg;
    } else {
      db.empresas.push(reg);
      ui.sort = "origem";
    }
    if (!salvar()) return;
    toast(nome + (antigo ? " atualizada" : " cadastrada no relatório") +
      (sync.ativo() ? " — salvando para a equipe…" : " — salva só neste navegador"));
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

  $("#btnReportPortfolio").onclick = function () {
    var linhas = db.empresas.map(function (e) {
      return [e.nome, e.tipo, STATUS[e.status].label, e.progresso + "%", e.feito.length, e.falta.length, e.atualizado, e.statusText];
    });
    baixarRelatorioCsv("carteira-implantacoes", ["Empresa", "Tipo", "Status", "Progresso", "Itens concluídos", "Pendências", "Atualizado em", "Status atual"], linhas);
  };
  $("#btnReportPendencias").onclick = function () {
    var linhas = [];
    db.empresas.forEach(function (e) {
      e.falta.forEach(function (item) { linhas.push([e.nome, "", item, STATUS[e.status].label, "Pendência registrada", "", "", ""]); });
      (e.cronograma || []).filter(function (item) { return item.status !== "concluido"; }).forEach(function (item) {
        linhas.push([e.nome, item.fase, item.atividade, STATUS[e.status].label, item.categoria === "visita" ? "Visita em aberto" : "Etapa em aberto", item.data ? br(item.data) : "", item.visitaData ? br(item.visitaData) : "", item.responsavel || ""]);
      });
    });
    baixarRelatorioCsv("pendencias-implantacoes", ["Empresa", "Fase", "Item", "Status da empresa", "Origem", "Previsto", "Visita agendada", "Responsável"], linhas);
  };
  $("#btnReportAgenda").onclick = function () {
    var linhas = [];
    db.empresas.forEach(function (e) {
      (e.cronograma || []).forEach(function (item) {
        linhas.push([e.nome, item.fase, item.atividade, item.categoria === "visita" ? "Visita" : "Etapa", item.data ? br(item.data) : "", item.visitaData ? br(item.visitaData) : "", item.concluidoEm ? br(item.concluidoEm) : "", item.hora || "", item.responsavel || "", rotuloStatusCronograma(item.status), item.progresso == null ? "" : item.progresso + "%", item.origem]);
      });
    });
    baixarRelatorioCsv("agenda-visitas-cronograma", ["Empresa", "Fase", "Atividade", "Tipo", "Previsto", "Visita agendada", "Concluído em", "Hora", "Responsável", "Status", "Progresso", "Origem"], linhas);
  };

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

  /* ================= IMPORTAR CRONOGRAMA PDF ================= */
  function estadoImportacaoPdf(texto, tipo) {
    var el = $("#scheduleImportState");
    el.className = "import-state" + (tipo ? " " + tipo : "");
    el.textContent = texto;
  }

  function abrirImportadorCronograma() {
    pdfImport = { arquivo: "", linhas: [], texto: "", paginas: 0, carregando: false };
    $("#scheduleFileInput").value = "";
    $("#schedulePreviewArea").style.display = "none";
    $("#schedulePreview").innerHTML = "";
    $("#scheduleChooseFile").disabled = false;
    $("#scheduleApply").disabled = true;
    estadoImportacaoPdf("Nenhum arquivo selecionado. O relatório não será alterado até você clicar em “Aplicar atualizações”.", "");
    $("#scheduleBackdrop").classList.add("on");
  }

  function fecharImportadorCronograma() {
    $("#scheduleBackdrop").classList.remove("on");
  }

  function opcoesStatusCronograma(selecionado) {
    var html = '<option value="">Não reconhecido — não muda o status</option>' +
      '<option value="pendente"' + (selecionado === "pendente" ? " selected" : "") + ">Pendente</option>";
    Object.keys(STATUS).forEach(function (k) {
      html += '<option value="' + k + '"' + (selecionado === k ? " selected" : "") + ">" + esc(STATUS[k].label) + "</option>";
    });
    return html;
  }

  function renderTabelaCronograma() {
    var empresas = db.empresas.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, "pt-BR"); });
    var html = pdfImport.linhas.map(function (linha, i) {
      var opEmpresas = '<option value="">— selecione —</option>' + empresas.map(function (e) {
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
    var empresas = {};
    selecionadas.forEach(function (r) { empresas[r.empresaId] = true; });
    var statusConhecidos = selecionadas.filter(function (r) { return !!STATUS[r.status] || r.status === "pendente"; }).length;
    var visitas = selecionadas.filter(function (r) { return r.categoria === "visita" || !!r.visitaData; }).length;
    var semEmpresa = linhas.filter(function (r) { return !r.empresaId; }).length;
    $("#scheduleSummary").innerHTML =
      '<span><b>' + linhas.length + "</b> itens lidos</span>" +
      '<span><b>' + selecionadas.length + "</b> selecionados</span>" +
      '<span><b>' + Object.keys(empresas).length + "</b> empresas</span>" +
      '<span><b>' + statusConhecidos + "</b> status reconhecidos</span>" +
      '<span><b>' + visitas + "</b> visitas</span>" +
      (semEmpresa ? '<span><b>' + semEmpresa + "</b> sem empresa associada</span>" : "");
    $("#scheduleApply").disabled = !selecionadas.length || pdfImport.carregando;
  }

  async function processarPdfCronograma(arquivo) {
    if (!arquivo) return;
    pdfImport = { arquivo: arquivo.name || "cronograma.pdf", linhas: [], texto: "", paginas: 0, carregando: true };
    $("#schedulePreviewArea").style.display = "none";
    $("#scheduleChooseFile").disabled = true;
    $("#scheduleApply").disabled = true;
    estadoImportacaoPdf("Lendo “" + pdfImport.arquivo + "”… o arquivo permanece neste dispositivo.", "");
    try {
      if (!window.CRONOGRAMA_PDF) throw new Error("O leitor de PDF não carregou. Atualize a página e tente novamente.");
      var extraido = await window.CRONOGRAMA_PDF.lerPdf(arquivo);
      pdfImport.paginas = extraido.paginas;
      pdfImport.texto = extraido.texto || "";
      if (!pdfImport.texto.trim()) {
        $("#schedulePreviewArea").style.display = "";
        $("#scheduleRawText").textContent = "Nenhum texto foi encontrado. Este arquivo provavelmente é uma digitalização. É necessário aplicar OCR ao PDF antes de importar.";
        estadoImportacaoPdf("Não encontrei texto pesquisável no PDF. Se ele foi digitalizado como imagem, aplique OCR e envie novamente.", "err");
        return;
      }
      pdfImport.linhas = window.CRONOGRAMA_PDF.interpretarLinhas(extraido.linhas, db.empresas);
      $("#schedulePreviewArea").style.display = "";
      $("#scheduleRawText").textContent = pdfImport.texto;
      renderTabelaCronograma();
      var avisoLimite = extraido.linhas.length > window.CRONOGRAMA_PDF.maxLinhas ? " A prévia foi limitada a " + window.CRONOGRAMA_PDF.maxLinhas + " linhas." : "";
      if (pdfImport.linhas.length) {
        estadoImportacaoPdf("PDF lido: " + pdfImport.paginas + " página(s). Revise a empresa, a atividade e o status em cada linha antes de aplicar." + avisoLimite, "ok");
      } else {
        estadoImportacaoPdf("Extraí texto de " + pdfImport.paginas + " página(s), mas não reconheci linhas de atividade automaticamente. Adicione linhas manualmente ou envie este PDF para ajustarmos o leitor ao formato." + avisoLimite, "err");
      }
    } catch (erro) {
      estadoImportacaoPdf(erro && erro.message ? erro.message : "Não foi possível ler o PDF.", "err");
    } finally {
      pdfImport.carregando = false;
      $("#scheduleChooseFile").disabled = false;
      atualizarResumoCronograma();
    }
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
      linha.empresaNome = empresa ? empresa.nome : "";
    });
  }

  function adicionarLinhaCronogramaManual() {
    pdfImport.linhas.push({
      id: "pdf-manual-" + (pdfImport.linhas.length + 1), empresaId: "", empresaNome: "",
      atividade: "", fase: "", data: "", visitaData: "", concluidoEm: "", responsavel: "",
      hora: "", categoria: "etapa", status: "", progresso: null,
      usar: false, pagina: 0, trecho: ""
    });
    renderTabelaCronograma();
    var ultima = $("#schedulePreview tr:last-child input[data-field=atividade]");
    if (ultima) ultima.focus();
  }

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

  function aplicarCronogramaPdf() {
    atualizarLinhasDaPrevia();
    var selecionadas = pdfImport.linhas.filter(function (r) { return r.usar && r.empresaId && String(r.atividade || "").trim() && porId(r.empresaId); });
    if (!selecionadas.length) { toast("Selecione ao menos uma linha e associe a uma empresa."); return; }
    var porEmpresa = {};
    selecionadas.forEach(function (linha) {
      if (!porEmpresa[linha.empresaId]) porEmpresa[linha.empresaId] = [];
      porEmpresa[linha.empresaId].push(linha);
    });
    var dataAtual = hoje(), atualizadas = 0, dadosStatusDetectados = 0;
    Object.keys(porEmpresa).forEach(function (empresaId) {
      var empresa = porId(empresaId), linhas = porEmpresa[empresaId];
      if (!empresa) return;
      empresa.cronograma = linhas.map(function (linha, i) {
        return {
          id: linha.id || ("pdf-" + dataAtual + "-" + i),
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
      var resumo = "Cronograma atualizado via PDF em " + br(dataAtual) + ": " + linhas.length + " item(ns), " + concluidas + " concluído(s), " + pendentes + " pendente(s).";
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
        texto: (mudouStatus || mudouProgresso ? "Atualizado via cronograma: " : "Cronograma importado: ") +
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
    toast(atualizadas + " empresa(s) atualizada(s) pelo cronograma" + (dadosStatusDetectados ? " · status/progresso conferidos" : " · o PDF não trouxe status reconhecível"));
  }

  $("#btnScheduleImport").onclick = abrirImportadorCronograma;
  $("#mImportSchedule").onclick = function () { $("#menu").classList.remove("open"); abrirImportadorCronograma(); };
  $("#closeSchedule").onclick = fecharImportadorCronograma;
  $("#cancelSchedule").onclick = fecharImportadorCronograma;
  $("#scheduleBackdrop").onclick = function (e) { if (e.target === this) fecharImportadorCronograma(); };
  $("#scheduleChooseFile").onclick = function () { $("#scheduleFileInput").click(); };
  $("#scheduleFileInput").onchange = function () {
    var arquivo = this.files && this.files[0];
    this.value = "";
    processarPdfCronograma(arquivo);
  };
  $("#scheduleAddRow").onclick = adicionarLinhaCronogramaManual;
  $("#scheduleApply").onclick = aplicarCronogramaPdf;
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
      item.empresaNome = empresa ? empresa.nome : "";
      if (empresa) item.usar = true;
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
  var scheduleDrop = $("#scheduleDrop");
  scheduleDrop.addEventListener("dragover", function (e) { e.preventDefault(); scheduleDrop.classList.add("drag"); });
  scheduleDrop.addEventListener("dragleave", function () { scheduleDrop.classList.remove("drag"); });
  scheduleDrop.addEventListener("drop", function (e) {
    e.preventDefault(); scheduleDrop.classList.remove("drag");
    var arquivo = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (arquivo) processarPdfCronograma(arquivo);
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
