/* =====================================================================
   MODO TESTE — simula o Supabase dentro do próprio navegador.
   ---------------------------------------------------------------------
   Para ver o "vale para todos" funcionando antes de criar qualquer conta:

       http://localhost:8080/?mock=1

   Abra em DUAS abas/janelas lado a lado: o que você salvar em uma aparece
   na outra sozinho. O armazenamento vira o localStorage compartilhado da
   origem e o "tempo real" é um BroadcastChannel entre as abas.

   Carregue este arquivo DEPOIS de sync-config.js (ele sobrescreve a
   configuração) e antes de app.js. Sem ?mock=1 no endereço ele não faz
   absolutamente nada.
   ===================================================================== */
(function () {
  "use strict";
  if (!/[?&]mock=1/.test(location.search)) return;

  var LS = "mock-supabase.documentos";   // prefixo: uma chave por linha (como o Postgres, que escreve por linha)
  var POR_LINHA = true;
  function chave(id) { return LS + "." + encodeURIComponent(id); }

  function tr() {
    if (!window.__mockVerbose) return;
    var a = ["[mock-supabase]"].concat([].slice.call(arguments));
    console.log.apply(console, a);
  }
  var bc = null;
  try { bc = new BroadcastChannel("mock-supabase"); } catch (e) {}
  var assinantes = [];
  var atraso = Number((location.search.match(/[?&]lag=(\d+)/) || [0, 0])[1]) || 0;

  function ler() {
    if (!POR_LINHA) { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch (e) { return []; } }
    var out = [], i = 0;
    while (i < localStorage.length) {
      var k = localStorage.key(i++);
      if (!k || k.indexOf(LS + ".") !== 0) continue;
      try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) {}
    }
    return out;
  }
  function gravar(rows) {
    if (!POR_LINHA) { try { localStorage.setItem(LS, JSON.stringify(rows)); } catch (e) {} return; }
    rows.forEach(function (r) { try { localStorage.setItem(chave(r.id), JSON.stringify(r)); } catch (e) {} });
  }
  function apagar(ids) {
    if (!POR_LINHA) return;
    ids.forEach(function (id) { try { localStorage.removeItem(chave(id)); } catch (e) {} });
  }
  function entregar(ev) {
    assinantes.forEach(function (cb) { try { cb(ev); } catch (e) {} });
  }
  function emitir(ev) {
    if (atraso) setTimeout(function () { entregar(ev); }, atraso);
    else entregar(ev);
    if (bc) { try { bc.postMessage(ev); } catch (e) {} }
  }
  if (bc) bc.onmessage = function (e) { entregar(e.data); };

  function erro(msg, code) { var e = new Error(msg); e.code = code; e.message = msg; return e; }

  /* ---- construtor de consulta thenable, como o do supabase-js ---- */
  function Q(tabela, tipo) {
    this.t = tabela; this.tipo = tipo; this.filtro = null; this.ord = null;
  }
  Q.prototype.select = function () { return this; };
  Q.prototype.eq = function (c, v) { this.filtro = [c, function (x) { return x === v; }]; return this; };
  Q.prototype.in = function (c, vs) {
    var lista = [].concat(vs || []);
    this.filtro = [c, function (x) { return lista.indexOf(x) >= 0; }];
    return this;
  };
  Q.prototype.order = function (col) { this.ord = col; return this; };
  Q.prototype.upsert = function (rows) { this.linhas = rows; return this; };

  Q.prototype.exec = function () {
    var self = this;
    return new Promise(function (ok, fail) {
      if (window.__mockFalhar) { setTimeout(function () { fail(erro("fetch failed (simulado)", "NETWORK")); }, 0); return; }
      var linhas = ler();
      if (self.tipo === "select") {
        var out = linhas.slice();
        if (self.ord) out.sort(function (a, b) { return (a[self.ord] || 0) - (b[self.ord] || 0); });
        setTimeout(function () { ok({ data: out, error: null }); }, atraso);
        return;
      }
      if (self.tipo === "upsert") {
        var porId = {};
        linhas.forEach(function (r) { porId[r.id] = r; });
        var eventos = [], gravadas = [];
        (self.linhas || []).forEach(function (r) {
          var existia = porId[r.id] !== undefined;
          var novo = { id: r.id, dados: r.dados, ordem: r.ordem == null ? 0 : r.ordem, atualizado_em: new Date().toISOString() };
          gravadas.push(novo);
          eventos.push({ eventType: existia ? "UPDATE" : "INSERT", new: novo, old: porId[r.id] || null });
        });
        tr("upsert", gravadas.map(function (r) { return r.id + (r.id === "__meta__" ? "" : ":" + (r.dados && r.dados.progresso) + "/" + (r.dados && r.dados.status)); }));
        gravar(gravadas);
        setTimeout(function () {
          eventos.forEach(emitir);
          ok({ data: gravadas, error: null });
        }, atraso);
        return;
      }
      if (self.tipo === "delete") {
        var tiradas = [];
        linhas.forEach(function (r) {
          if (self.filtro && self.filtro[1](r[self.filtro[0]])) tiradas.push(r);
        });
        tr("delete", tiradas.map(function (r) { return r.id; }));
        apagar(tiradas.map(function (r) { return r.id; }));
        setTimeout(function () {
          tiradas.forEach(function (r) { emitir({ eventType: "DELETE", new: null, old: r }); });
          ok({ data: null, error: null });
        }, atraso);
        return;
      }
      ok({ data: null, error: erro("operacao não implementada no mock", "MOCK") });
    });
  };
  Q.prototype.then = function (ok, fail) { return this.exec().then(ok, fail); };
  Q.prototype.catch = function (fail) { return this.exec().catch(fail); };

  function Canal() {}
  Canal.prototype.on = function (tipo, filtro, cb) {
    if (tipo === "postgres_changes") assinantes.push(cb);
    return this;
  };
  Canal.prototype.subscribe = function (cb) {
    setTimeout(function () { cb && cb("SUBSCRIBED"); }, 0);
    return this;
  };
  Canal.prototype.unsubscribe = function () { assinantes = []; return this; };

  window.supabase = {
    createClient: function () {
      return {
        from: function (t) {
          return {
            select: function () { return new Q(t, "select"); },
            upsert: function (rows) { return new Q(t, "upsert").upsert(rows); },
            insert: function (rows) { return new Q(t, "upsert").upsert(rows); },
            update: function (r) { return new Q(t, "upsert").upsert([r]); },
            "delete": function () { return new Q(t, "delete"); }
          };
        },
        channel: function () { return new Canal(); },
        removeChannel: function () { assinantes = []; }
      };
    }
  };

  // config falsa, só para o sync.js aceitar ligar o modo compartilhado
  window.SYNC_CONFIG = {
    url: "https://mock-local.supabase.co",
    anonKey: "mock-anon-key-para-teste-0123456789-abcdef",
    table: "documentos",
    schema: "public"
  };

  // utilidades para brincar no console
  window.__mock = {
    linhas: ler,
    limpar: function () {
      var ks = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf("mock-supabase") === 0) ks.push(k); }
      ks.forEach(function (k) { localStorage.removeItem(k); });
      location.reload();
    },
    verboso: function (v) { window.__mockVerbose = v === undefined ? true : !!v; },
    falhar: function (v) { window.__mockFalhar = v === undefined ? true : !!v; },
    dados: function () { return JSON.parse(localStorage.getItem(LS) || "[]"); }
  };
  console.log("%c[mock] Supabase simulado ativo — abra outra aba com a mesma URL para ver o tempo real.",
    "background:#4f46e5;color:#fff;padding:2px 6px;border-radius:3px");
})();
