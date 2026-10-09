/* =====================================================================
   RELATÓRIO DE IMPLANTAÇÕES — sincronização compartilhada (Supabase)
   ---------------------------------------------------------------------
   É a camada que faz "o que um altera valer para todos".

   Modelo no servidor: UMA tabela só  ->  documentos(id, dados jsonb, ordem, atualizado_em)
     · linha "__meta__"    = { data: "2026-10-08" }  (a data do levantamento)
     · uma linha por empresa = o objeto da empresa, exatamente como no dados.js
   Uma linha por empresa (em vez de um registro único com o relatório inteiro) é
   o que deixa duas pessoas editarem empresas diferentes ao mesmo tempo sem uma
   pisar na outra.

   Fluxo:
     · no boot: baixa tudo, faz merge de 3 vias com o que está no navegador e
       publica o que estiver pendurado (quem já tinha alterações locais não
       perde nada na primeira conexão);
     · em cada salvamento: envia só o diff — upsert das linhas que mudaram e
       delete das que saíram, sem regravar o relatório inteiro;
     · realtime (postgres_changes): o que chega do servidor é aplicado na hora;
     · o localStorage continua sendo a cache: o site abre instantâneo, funciona
       sem internet e nada se perde se o Supabase estiver fora do ar.

   Depende de window.supabase (vendor/supabase-*.umd.min.js) e window.SYNC_CONFIG.
   Sem configuração preenchida, nada aqui acontece e o app segue 100% local.
   ===================================================================== */
(function () {
  "use strict";

  var META_ID = "__meta__";
  var LS_CONF = "relatorio-implantacoes.sync-conf.v1";   // override local (testar sem commitar)
  var LS_BASE = "relatorio-implantacoes.sync-base.v1";   // ancestral comum do merge de 3 vias
  var PUSH_ESPERA = 500;        // junta as teclas antes de gravar no servidor
  var RENDER_ESPERA = 140;      // agrupa eventos de realtime em um re-render só
  var POLL = 30000;             // rede de segurança se o websocket cair
  var NOVA_TENTATIVA = 12000;

  /* ================= ESTADO ================= */
  var h = null;                       // ganchos que o app.js injeta
  var sb = null;                      // cliente supabase
  var cfg = null;
  var canal = null;
  var tPush = null, tRender = null, tPoll = null, tRetry = null;

  var st = {
    modo: "off",                      // off | conectando | ao-vivo | local | erro
    msg: "",
    pendente: false,                  // tem mudança local ainda não enviada
    ultimaSync: 0,
    enviadas: {},                     // id -> json que eu mandei (para ignorar meu próprio eco)
    snap: setVazio(),                 // o que o servidor tem, segundo a gente
    base: null,                       // o que servidor e navegador concordavam no último sync
    limpar: []                        // duplicados que precisam sair do servidor
  };

  /* ================= COMPARAÇÃO CANÔNICA =================
     jsonb do Postgres reordena as chaves, então comparar JSON.stringify
     direto daria diferença falsa o tempo todo. */
  function canon(v) {
    if (v === undefined || v === null) return "null";
    if (Object.prototype.toString.call(v) === "[object Array]") {
      return "[" + v.map(canon).join(",") + "]";
    }
    if (typeof v === "object") {
      return "{" + Object.keys(v).sort().map(function (k) {
        return JSON.stringify(k) + ":" + canon(v[k]);
      }).join(",") + "}";
    }
    return JSON.stringify(v);
  }
  function igual(a, b) { return canon(a) === canon(b); }

  // "Raguso", "raguso.", "RAGUSO " -> mesma chave: serve para juntar a mesma
  // empresa quando dois navegadores chegaram a ids diferentes para ela
  function chaveNome(v) {
    var s = String(v == null ? "" : v).toLowerCase();
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s;
  }

  /* ================= "SET" DE DADOS ================= */
  function setVazio() { return { meta: { data: "" }, ids: [], porId: {} }; }
  function clonarSet(s) {
    var out = setVazio();
    out.meta = { data: (s.meta && s.meta.data) || "" };
    out.ids = s.ids.slice();
    out.porId = {};
    s.ids.forEach(function (id) { out.porId[id] = s.porId[id]; });
    return out;
  }
  function igualSet(a, b) {
    return !!a && !!b && a.meta.data === b.meta.data && igual(a.porId, b.porId);
  }
  function setDoApp() {
    var db = (h && h.getDb && h.getDb()) || { data: "", empresas: [] };
    var s = setVazio();
    s.meta.data = db.data || "";
    (db.empresas || []).forEach(function (e) {
      if (!e || !e.id || s.porId[e.id] !== undefined) return;
      s.porId[e.id] = e;
      s.ids.push(e.id);
    });
    return s;
  }
  function setDeDb(db) {
    var antigo = h.getDb();
    h.setDb(db);
    var s = setDoApp();
    h.setDb(antigo);
    return s;
  }
  function setDasLinhas(rows) {
    var s = setVazio();
    (rows || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (r.id === META_ID) { s.meta.data = (r.dados && r.dados.data) || ""; return; }
      s.porId[r.id] = r.dados || {};
      s.ids.push(r.id);
    });
    return s;
  }
  function aplicarSet(s) {
    if (!h || !h.setDb) return;
    h.setDb({
      data: s.meta.data || (h.hoje ? h.hoje() : ""),
      empresas: s.ids.map(function (id) {
        var d = s.porId[id];
        return h.normalizar ? h.normalizar(d) : d;
      })
    });
  }

  // o conteúdo é exatamente o que está no dados.js? então não é uma alteração
  // de ninguém: é um navegador que acabou de abrir (ou uma aba anônima) e o
  // servidor é que manda — senão cada visitante novo publicaria o baseline por
  // cima do relatório da equipe.
  function soOOArquivo(L) {
    if (!h || !h.baseline) return false;
    var b = h.baseline();
    if (!b || !b.porNome) return false;
    var k = chaveNome(L && L.nome);
    var bl = k ? b.porNome[k] : null;
    return !!bl && igual(L, bl);
  }

  function avisar() { if (h && h.aoStatus) { try { h.aoStatus(); } catch (e) {} } }
  function dizer(msg) { if (h && h.toast) h.toast(msg); }

  /* ================= CONFIG ================= */
  function configEfetiva() {
    var base = window.SYNC_CONFIG || {};
    var out = {
      url: base.url || "",
      anonKey: base.anonKey || base.key || "",
      table: base.table || "documentos",
      schema: base.schema || "public"
    };
    try {
      var ov = JSON.parse(localStorage.getItem(LS_CONF) || "null");
      if (ov) { out.url = ov.url || out.url; out.anonKey = ov.key || ov.anonKey || out.anonKey; }
    } catch (e) {}
    try {
      var q = new URLSearchParams(location.search);
      var u = q.get("sburl") || q.get("supabase_url");
      var k = q.get("sbkey") || q.get("supabase_key");
      if (u) out.url = u;
      if (k) out.anonKey = k;
    } catch (e) {}
    out.url = String(out.url).trim().replace(/\/+$/, "");
    out.anonKey = String(out.anonKey).trim();
    out.completo = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(out.url) && out.anonKey.length > 20;
    return out;
  }

  /* ================= BASE PERSISTIDA ================= */
  function gravarBase(s) {
    try { localStorage.setItem(LS_BASE, JSON.stringify(s)); } catch (e) {}
  }
  function lerBase() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_BASE) || "null");
      return v && v.porId ? v : null;
    } catch (e) { return null; }
  }

  /* ================= MERGE DE 3 VIAS =================
     local    = o que está na tela deste navegador
     servidor = o que está no Supabase (st.snap)
     base     = como os dois estavam no último sync bem-sucedido (null = nunca sincronizou)

     1. cada registro local é amarrado a um do servidor: pelo id ou, se o id não
        bater, pelo nome — é isso que faz a migração do modelo "só neste
        navegador" publicar no lugar certo em vez de duplicar a empresa;
     2. o que o servidor tem e ninguém reclamou fica (alguém cadastrou); se está
        na base e sumiu do local, é porque fui eu que apaguei -> remove no servidor;
     3. o que veio do app por cima:
          · igual nos dois                -> nada
          · servidor não mudou desde a base -> a minha alteração sobe
          · os dois mudaram               -> vence quem editou nesta sessão, senão o
                                             "atualizado" mais recente, senão o servidor
          · nunca sincronizei (base nula) -> só sobe o que NÃO for o dados.js, para um
                                             navegador novo não publicar o baseline por
                                             cima do relatório da equipe;
     4. sobra a limpeza de duplicados que já existem no servidor (mesma empresa,
        ids diferentes), mantendo o registro mais recente.

     "mudou" = o resultado é diferente do que está na tela -> o app re-renderiza.
  */
  function resolver(local, servidor, base) {
    var porId = {}, ids = [];
    var novos = [], sobrescrita = [], conflito = [], deletados = [], limpar = [];
    var chaveServ = {}, usado = {}, alvo = {};

    servidor.ids.forEach(function (id) {
      var k = chaveNome(servidor.porId[id] && servidor.porId[id].nome);
      if (k && chaveServ[k] === undefined) chaveServ[k] = id;
    });

    // 1) cada registro local aponta para um do servidor: pelo id, ou pelo nome
    //    (é o nome que faz a migração do modelo "só neste navegador" dar certo)
    local.ids.forEach(function (id) {
      var L = local.porId[id], k = chaveNome(L && L.nome);
      var para = servidor.porId[id] !== undefined ? id
        : (k && chaveServ[k] !== undefined ? chaveServ[k] : null);
      alvo[id] = para;
      if (para) usado[para] = true;
    });

    // 2) o que o servidor tem e ninguém reclamou: fica (outro cadastrou) ou sai
    //    (fui eu que apaguei — e por isso ele estava na base)
    servidor.ids.forEach(function (id) {
      porId[id] = servidor.porId[id];
      ids.push(id);
      if (!usado[id] && base && base.porId[id] !== undefined) deletados.push(id);
    });

    // 3) por cima, o que veio do app
    local.ids.forEach(function (id) {
      var L = local.porId[id], para = alvo[id];
      if (!para) {
        // não está no servidor: se eu já conhecia esse registro, é porque ALGUÉM
        // apagou lá — some da minha tela também, em vez de eu republicá-lo
        if (base && base.porId[id] !== undefined) return;
        if (!base && soOOArquivo(L)) return;      // é só o baseline do arquivo
        porId[id] = L; ids.push(id); novos.push(id); return;
      }
      var S = servidor.porId[para], C = base ? base.porId[para] : undefined;
      if (igual(L, S)) return;
      if (!base) {
        // nunca sincronizei neste navegador: só sobe o que não for o arquivo original
        if (!soOOArquivo(L)) { porId[para] = L; sobrescrita.push(para); }
        return;
      }
      if (igual(S, C)) { porId[para] = L; sobrescrita.push(para); return; }
      conflito.push(para);
      var meu = !!(h && h.tocado && h.tocado(id)) ||
        String((L && L.atualizado) || "") > String((S && S.atualizado) || "");
      if (meu) { porId[para] = L; sobrescrita.push(para); }
    });

    var meta = { data: servidor.meta.data };
    var dq = local.meta.data;
    var arquivoMeta = h.baseline && h.baseline() ? h.baseline().data : null;
    if (dq && (base ? dq !== base.meta.data : (dq !== servidor.meta.data && dq !== arquivoMeta))) meta = { data: dq };

    // 4) duplicados dentro do próprio servidor (dois navegadores publicaram a
    //    mesma empresa antes de os ids baterem): fica a mais recente, a outra sai do banco
    var porNome = {};
    var antes = ids.length;
    ids.slice().forEach(function (id) {
      var k = chaveNome(porId[id] && porId[id].nome);
      if (!k) return;
      var outro = porNome[k];
      if (outro === undefined) { porNome[k] = id; return; }
      var a = String((porId[id] && porId[id].atualizado) || "");
      var b = String((porId[outro] && porId[outro].atualizado) || "");
      var guarda = a === b ? (servidor.porId[outro] !== undefined ? outro : id) : (a > b ? id : outro);
      var fora = guarda === outro ? id : outro;
      delete porId[fora];
      ids.splice(ids.indexOf(fora), 1);
      if (servidor.porId[fora] !== undefined) limpar.push(fora);
      porNome[k] = guarda;
    });

    var resolvido = { ids: ids, porId: porId, meta: meta };
    return {
      ids: ids, porId: porId, meta: meta,
      novos: novos, sobrescrita: sobrescrita, conflito: conflito, deletados: deletados, limpar: limpar,
      // "mudou" = a tela precisa ser reescrita com o resultado do merge
      mudou: !igualSet(resolvido, local) || deletados.length > 0 || ids.length < antes
    };
  }
  // devolve o merge para a tela e decide se há o que enviar
  function reconciliar(autoPush) {
    var r = resolver(setDoApp(), st.snap, st.base);
    st.base = clonarSet(st.snap);
    gravarBase(st.base);
    if (r.mudou) aplicarSet({ meta: r.meta, ids: r.ids, porId: r.porId });
    if (r.limpar.length) st.limpar = st.limpar.concat(r.limpar);
    st.pendente = !igualSet(setDoApp(), st.snap) || st.limpar.length > 0;
    if (st.pendente && autoPush) agendarPush(0);
    avisar();
    return r;
  }

  /* ================= REDE ================= */
  function erroDe(res) { return res && res.error ? res.error : null; }

  function puxar() {
    return sb.from(cfg.table).select("*").order("ordem", { ascending: true }).then(function (res) {
      var err = erroDe(res);
      if (err) throw err;
      return setDasLinhas(res.data || []);
    });
  }

  function publicarTudo(local) {
    var rows = [{ id: META_ID, dados: { data: local.meta.data }, ordem: -1 }];
    local.ids.forEach(function (id, i) { rows.push({ id: id, dados: local.porId[id], ordem: i }); });
    st.enviadas = {};
    rows.forEach(function (r) { st.enviadas[r.id] = canon(r.dados); });
    return sb.from(cfg.table).upsert(rows).then(function (res) {
      var err = erroDe(res);
      if (err) throw err;
      st.snap = clonarSet(local);
      st.base = clonarSet(local);
      gravarBase(st.base);
      st.pendente = false;
      st.ultimaSync = Date.now();
    });
  }

  function agendarPush(ms) {
    if (!sb || st.modo === "off") return;
    if (tPush) clearTimeout(tPush);
    tPush = setTimeout(function () { tPush = null; empurrar(); }, ms == null ? PUSH_ESPERA : ms);
  }

  var empurrando = false;
  function empurrar() {
    if (!sb || st.modo === "off") return Promise.resolve(false);
    if (empurrando) { agendarPush(900); return Promise.resolve(false); }
    // se acabou de chegar coisa do servidor, aplica ANTES de diffar: senão eu
    // publicaria um valor obsoleto por cima da mudança do colega
    flushRemoto(true);
    empurrando = true;
    st.pendente = true;
    avisar();

    var local = setDoApp();
    var rows = [];
    local.ids.forEach(function (id, i) {
      if (!igual(local.porId[id], st.snap.porId[id])) rows.push({ id: id, dados: local.porId[id], ordem: i });
    });
    var metaMudou = local.meta.data !== st.snap.meta.data;
    if (metaMudou) rows.push({ id: META_ID, dados: { data: local.meta.data }, ordem: -1 });
    var delet = st.snap.ids.filter(function (id) {
      return local.porId[id] === undefined || st.limpar.indexOf(id) >= 0;
    });
    st.limpar = [];

    if (!rows.length && !delet.length) {
      empurrando = false;
      st.pendente = false;
      avisar();
      return Promise.resolve(true);
    }

    var nada = Promise.resolve({ data: null, error: null });
    return (rows.length ? sb.from(cfg.table).upsert(rows) : nada).then(function (res) {
      var err = erroDe(res);
      if (err) throw err;
      if (!delet.length) return null;
      return sb.from(cfg.table).delete().in("id", delet).then(function (r2) {
        var e2 = erroDe(r2);
        if (e2) throw e2;
      });
    }).then(function () {
      rows.forEach(function (r) {
        if (r.id === META_ID) { st.snap.meta.data = r.dados.data; return; }
        if (st.snap.porId[r.id] === undefined) st.snap.ids.push(r.id);
        st.snap.porId[r.id] = r.dados;
        st.enviadas[r.id] = canon(r.dados);
      });
      delet.forEach(function (id) {
        delete st.snap.porId[id];
        var p = st.snap.ids.indexOf(id);
        if (p >= 0) st.snap.ids.splice(p, 1);
        delete st.enviadas[id];
      });
      st.base = clonarSet(st.snap);
      gravarBase(st.base);
      st.pendente = false;
      st.ultimaSync = Date.now();
      st.modo = "ao-vivo";
      st.msg = "";
      empurrando = false;
      if (h && h.aoPublicar) { try { h.aoPublicar(rows.length, delet.length); } catch (e) {} }
      avisar();
      return true;
    }).catch(function (err) {
      empurrando = false;
      falhou(err);
      return false;
    });
  }

  function falhou(err) {
    st.modo = "erro";
    st.msg = (err && (err.message || err.hint || err.details)) || "falha de rede";
    avisar();
    if (tRetry) clearTimeout(tRetry);
    tRetry = setTimeout(function () {
      if (navigator.onLine === false) return;
      puxarAGora(true);
    }, NOVA_TENTATIVA);
  }

  function puxarAGora(silencioso) {
    if (!sb) return Promise.resolve(false);
    return puxar().then(function (servidor) {
      var mudou = !igualSet(servidor, st.snap);
      st.snap = servidor;
      if (mudou) reconciliar(true);
      st.ultimaSync = Date.now();
      st.modo = "ao-vivo";
      st.msg = "";
      avisar();
      return mudou;
    }).catch(function (err) { falhou(err); return false; });
  }

  /* ================= REALTIME ================= */
  var filaRemota = [];
  function aoEvento(ev) {
    var tipo = ev.eventType || (ev.update ? "UPDATE" : "INSERT");
    var reg = ev.new || ev.record || ev.old;
    var id = reg && reg.id;
    if (!id) return;

    if (tipo === "DELETE") {
      if (id === META_ID || st.snap.porId[id] === undefined) return;
      delete st.snap.porId[id];
      var p = st.snap.ids.indexOf(id);
      if (p >= 0) st.snap.ids.splice(p, 1);
    } else if (id === META_ID) {
      st.snap.meta.data = ((reg.dados && reg.dados.data) || "");
    } else {
      if (st.enviadas[id] && igual(reg.dados, JSON.parse(st.enviadas[id]))) return;   // fui eu mesmo
      st.snap.porId[id] = reg.dados || {};
      if (st.snap.ids.indexOf(id) < 0) st.snap.ids.push(id);
    }
    filaRemota.push(id);
    st.ultimaSync = Date.now();
    if (!tRender) tRender = setTimeout(function () { tRender = null; flushRemoto(false); }, RENDER_ESPERA);
  }

  // aplica de uma vez o que chegou do servidor (semPush: quem chama vai publicar em seguida)
  function flushRemoto(semPush) {
    if (tRender) { clearTimeout(tRender); tRender = null; }
    if (!filaRemota.length) return false;
    var ids = filaRemota.slice();
    filaRemota = [];
    reconciliar(!semPush);
    if (h && h.aoRemoto) { try { h.aoRemoto(ids); } catch (e) {} }
    return true;
  }

  function assinar() {
    if (!sb || !sb.channel || canal) return;
    try {
      canal = sb.channel("rel-rt-" + cfg.table)
        .on("postgres_changes", { event: "*", schema: cfg.schema, table: cfg.table }, aoEvento)
        .subscribe(function (status, err) {
          if (status === "SUBSCRIBED") { st.modo = "ao-vivo"; st.msg = ""; avisar(); }
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            st.msg = "tempo real caiu — atualizando sozinho a cada " + (POLL / 1000) + "s";
            avisar();
          }
          if (err) console.warn("[sync]", status, err);
        });
    } catch (e) {
      console.warn("[sync] tempo real indisponível:", e);
    }
  }

  /* ================= BOOT ================= */
  function iniciar(ganchos) {
    if (ganchos) h = ganchos;
    cfg = configEfetiva();
    if (!cfg.completo) {
      st.modo = "local";
      st.msg = "sem servidor configurado — as alterações ficam só neste navegador";
      avisar();
      return Promise.resolve(false);
    }
    if (!window.supabase || !window.supabase.createClient) {
      st.modo = "erro";
      st.msg = "a biblioteca do Supabase não carregou (falta vendor/supabase-*.umd.min.js)";
      avisar();
      return Promise.resolve(false);
    }
    st.modo = "conectando";
    avisar();
    try {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 10 } }
      });
    } catch (e) {
      st.modo = "erro";
      st.msg = "URL ou anon key inválidos";
      avisar();
      return Promise.resolve(false);
    }

    return puxar().then(function (servidor) {
      if (!servidor.ids.length && !servidor.meta.data) {
        var local = setDoApp();
        if (!local.ids.length) { st.modo = "ao-vivo"; avisar(); return false; }
        return publicarTudo(local).then(function () {
          st.modo = "ao-vivo";
          if (h && h.salvarCache) h.salvarCache();
          avisar();
          dizer("Relatório publicado para a equipe: o que qualquer um alterar vale para todos.");
          return true;
        });
      }
      st.snap = servidor;
      st.base = lerBase();
      var r = resolver(setDoApp(), st.snap, st.base);
      st.base = clonarSet(st.snap);
      gravarBase(st.base);
      if (r.mudou) {
        aplicarSet({ meta: r.meta, ids: r.ids, porId: r.porId });
        if (h && h.salvarCache) h.salvarCache();
      }
      st.modo = "ao-vivo";
      avisar();
      var sobem = r.novos.length + r.sobrescrita.length;
      if (sobem || r.deletados.length) {
        dizer(sobem + " alteração(ões) deste navegador estão subindo para a equipe.");
        agendarPush(300);
      }
      return true;
    }).catch(function (err) {
      st.modo = "erro";
      st.msg = (err && (err.message || err.hint)) || "não foi possível conectar ao Supabase";
      avisar();
      console.warn("[sync] boot falhou:", err);
      return false;
    }).then(function (ok) {
      if (ok) {
        assinar();
        if (tPoll) clearInterval(tPoll);
        tPoll = setInterval(function () {
          if (document.hidden) return;          // aba escondida não fica batendo no banco
          puxarAGora(true);
        }, POLL);
        window.addEventListener("online", function () { puxarAGora(true); });
        window.addEventListener("focus", function () { puxarAGora(true); });
        return true;
      }
      if (tRetry) clearTimeout(tRetry);
      tRetry = setTimeout(function () { iniciar(null); }, NOVA_TENTATIVA);
      return false;
    });
  }

  /* ================= API ================= */
  window.SYNC = {
    iniciar: iniciar,
    ativo: function () { return !!sb; },
    aoVivo: function () { return st.modo === "ao-vivo" && !st.pendente; },
    estado: function () {
      return {
        modo: st.modo,
        msg: st.msg,
        pendente: st.pendente,
        ultimaSync: st.ultimaSync,
        config: cfg || configEfetiva(),
        linhas: st.snap.ids.length
      };
    },
    config: function () { return cfg || configEfetiva(); },

    sincronizarAgora: function () {
      if (!sb) { dizer("Ainda não há servidor configurado."); return Promise.resolve(false); }
      return empurrar().then(function () { return puxarAGora(false); });
    },

    // manda todas as linhas deste navegador para o servidor sem apagar nada
    forcarPublicacao: function () {
      if (!sb) return Promise.resolve(false);
      st.snap = setVazio();
      st.limpar = [];
      return empurrar().then(function () { return puxarAGora(false); });
    },

    // limpa o override de chaves guardado no navegador (volta a usar o sync-config.js)
    esquecerConfig: function () {
      try { localStorage.removeItem(LS_CONF); localStorage.removeItem(LS_BASE); } catch (e) {}
      cfg = configEfetiva();
      return cfg;
    },

    // o app chama a cada salvamento local
    alterou: function () {
      if (!sb) return;                 // sem servidor: não há o que "enviar"
      st.pendente = true; agendarPush(); avisar();
    },

    // guardou as chaves no navegador: reconecta sem precisar de commit
    reconectar: function (url, key) {
      try {
        if (url || key) localStorage.setItem(LS_CONF, JSON.stringify({ url: url || "", key: key || "" }));
        else localStorage.removeItem(LS_CONF);
      } catch (e) {}
      sb = null; canal = null; tPoll = null;
      st.modo = "off"; st.base = null; st.enviadas = {};
      return iniciar(null);
    },

    textoDoArquivoConfig: function (url, key) {
      return "/* =====================================================================\n" +
        "   SERVIDOR COMPARTILHADO do Relatório de Implantações.\n" +
        "   Quem editar este arquivo e dar commit está publicando a conexão para a\n" +
        "   equipe inteira. A anon key é pública por natureza: a segurança vem das\n" +
        "   políticas RLS criadas em supabase.sql.\n" +
        "   ===================================================================== */\n" +
        "window.SYNC_CONFIG = {\n" +
        '  url: "' + String(url || "").trim() + '",\n' +
        '  anonKey: "' + String(key || "").trim() + '",\n' +
        '  table: "documentos",\n' +
        '  schema: "public"\n' +
        "};\n";
    },

    // "Restaurar relatório original" com servidor ligado: publica o baseline para todos
    substituirTudo: function (db) {
      if (!sb) return Promise.resolve(false);
      var local = setDeDb(db);
      st.snap = setVazio();
      st.base = null;
      return publicarTudo(local).then(function () {
        aplicarSet(st.snap);
        if (h && h.salvarCache) h.salvarCache();
        st.modo = "ao-vivo";
        st.msg = "";
        avisar();
        return true;
      }).catch(function (err) { falhou(err); return false; });
    }
  };
})();
