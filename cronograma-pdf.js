/* =====================================================================
   Leitura local de PDFs de cronograma (PDF.js) e interpretação heurística.
   Nenhum arquivo é enviado para a rede. A importação sempre passa por uma
   prévia editável antes de atualizar o relatório.
   ===================================================================== */
(function (root) {
  "use strict";

  var MAX_PAGINAS = 80;
  var MAX_LINHAS_PREVIA = 300;
  var MAX_TEXTO = 1200000;

  function normalizarTexto(valor) {
    var texto = String(valor == null ? "" : valor).toLowerCase();
    try { texto = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return texto.replace(/[^a-z0-9%:/.-]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function linhaPorItens(items, pagina) {
    var grupos = [];
    (items || []).forEach(function (item) {
      if (!item || typeof item.str !== "string" || !item.str.trim()) return;
      var matriz = item.transform || [];
      var x = Number(matriz[4]) || 0;
      var y = Number(matriz[5]) || 0;
      var grupo = null, distancia = Infinity;
      for (var i = 0; i < grupos.length; i++) {
        var d = Math.abs(grupos[i].y - y);
        if (d <= 3.2 && d < distancia) { grupo = grupos[i]; distancia = d; }
      }
      if (!grupo) { grupo = { y: y, partes: [] }; grupos.push(grupo); }
      grupo.partes.push({ x: x, largura: Number(item.width) || 0, texto: item.str.trim() });
    });

    return grupos.sort(function (a, b) { return b.y - a.y; }).map(function (grupo) {
      grupo.partes.sort(function (a, b) { return a.x - b.x; });
      var texto = "", fim = null;
      grupo.partes.forEach(function (p) {
        var gap = fim == null ? 0 : p.x - fim;
        if (texto && gap > 1.8 && !/\s$/.test(texto)) texto += " ";
        texto += p.texto;
        fim = Math.max(fim || 0, p.x + p.largura);
      });
      return { pagina: pagina, y: grupo.y, texto: texto.replace(/\s+/g, " ").trim() };
    }).filter(function (linha) { return linha.texto; });
  }

  function dataIso(valor) {
    var s = String(valor || "").trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
      return dataValidada(+m[1], +m[2], +m[3]);
    }
    if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) {
      var ano = +m[3];
      if (ano < 100) ano += ano >= 70 ? 1900 : 2000;
      return dataValidada(ano, +m[2], +m[1]);
    }
    return "";
  }

  function dataValidada(ano, mes, dia) {
    var d = new Date(Date.UTC(ano, mes - 1, dia));
    if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return "";
    return String(ano).padStart(4, "0") + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
  }

  function datasDaLinha(texto) {
    var regex = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\b/g;
    var achadas = [], m;
    while ((m = regex.exec(texto)) && achadas.length < 3) {
      var iso = dataIso(m[0]);
      if (iso && achadas.indexOf(iso) < 0) achadas.push(iso);
    }
    return achadas;
  }

  function horarioDaLinha(texto) {
    var m = String(texto || "").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    return m ? String(m[1]).padStart(2, "0") + ":" + m[2] : "";
  }

  function statusDaLinha(texto) {
    var s = normalizarTexto(texto);
    if (/\b(atraso|atrasad[oa]s?|bloquead[oa]s?|impedid[oa]s?|em risco|critico|critica|cancelad[oa]s?)\b/.test(s)) return "risco";
    if (/\b(aguardando|pendente|dependencia) (o |a |do |da |de )?(desenvolvimento|dev|programacao)\b/.test(s) || /\bretorno do desenvolvimento\b/.test(s)) return "desenvolvimento";
    if (/\b(aguardando|pendente|dependencia) (o |a |do |da |de )?cliente\b/.test(s) || /\b(retorno|validacao) do cliente\b/.test(s)) return "cliente";
    if (/\b(em andamento|em execucao|em curso|executando|iniciad[oa]s?|em realizacao)\b/.test(s)) return "andamento";
    if (/\b(concluid[oa]s?|finalizad[oa]s?|realizad[oa]s?|executad[oa]s?|completad[oa]s?|feito|feita|done)\b/.test(s)) return "concluido";
    if (/\b(pendente|a fazer|nao iniciado|nao iniciada)\b/.test(s)) return "pendente";
    return "";
  }

  function progressoDaLinha(texto) {
    var m = String(texto || "").match(/(?:^|\s)(\d{1,3})\s*%/);
    if (!m) return null;
    var n = Number(m[1]);
    return n >= 0 && n <= 100 ? n : null;
  }

  function categoriaDaLinha(texto) {
    return /\b(visita|reuniao|atendimento|presencial|on.site)\b/i.test(normalizarTexto(texto)) ? "visita" : "etapa";
  }

  function nomesAliasEmpresa(empresa) {
    var nome = String(empresa && empresa.nome || "").trim();
    var aliases = [nome, nome.replace(/\s*\([^)]*\)\s*/g, " ").trim()];
    return aliases.filter(function (v, i, todos) { return v && todos.indexOf(v) === i; });
  }

  function aliasEmpresa(empresa) {
    return nomesAliasEmpresa(empresa).map(normalizarTexto).filter(function (v, i, todos) { return v && todos.indexOf(v) === i; });
  }

  function localizarEmpresa(texto, empresas) {
    var normalizado = " " + normalizarTexto(texto) + " ";
    var melhor = null;
    (empresas || []).forEach(function (empresa) {
      aliasEmpresa(empresa).forEach(function (alias) {
        var palavras = alias.split(" ").filter(Boolean);
        var encontra = normalizado.indexOf(" " + alias + " ") >= 0;
        if (!encontra && palavras.length > 1) {
          encontra = palavras.every(function (p) { return normalizado.indexOf(" " + p + " ") >= 0; });
        }
        if (encontra && (!melhor || alias.length > melhor.tamanho)) {
          melhor = { empresa: empresa, tamanho: alias.length };
        }
      });
    });
    return melhor && melhor.empresa || null;
  }

  function pareceCabecalho(texto) {
    var s = normalizarTexto(texto);
    if (/^(cronograma|agenda|relatorio|implantacao|visitas?)\b/.test(s) && s.length < 90) return true;
    if (/\b(empresa|cliente)\b/.test(s) && /\b(atividade|tarefa|status|data|prazo)\b/.test(s) && s.length < 140) return true;
    return /^(atividade|tarefa|status|data|prazo|responsavel|inicio|termino|fim)(\s|$)/.test(s);
  }

  function textoDaAtividade(texto, empresa) {
    var atividade = String(texto || "");
    nomesAliasEmpresa(empresa || {}).sort(function (a, b) { return b.length - a.length; }).forEach(function (alias) {
      if (!alias) return;
      var regex = new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "ig");
      atividade = atividade.replace(regex, " ");
    });
    atividade = atividade
      .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ")
      .replace(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/g, " ")
      .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, " ")
      .replace(/\b\d{1,3}\s*%/g, " ")
      .replace(/\b(previsto|visita agendada|resp(?:ons[aá]vel)?|aguardando desenvolvimento|aguardando dev|aguardando cliente|retorno do cliente|validacao do cliente|retorno do desenvolvimento|em andamento|em execu[cç][aã]o|em curso|em atraso|em risco|aguardando|conclu[ií]d[oa]s?|finalizad[oa]s?|realizad[oa]s?|executad[oa]s?|completad[oa]s?|cancelad[oa]s?|atraso|atrasad[oa]s?|pendente|bloquead[oa]s?|feito|feita|status|atividade|tarefa|prazo|data)\b/ig, " ")
      .replace(/^\s*[#\d.›»>•·\-–—|:]+\s*/, "")
      .replace(/[|\t]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[-–—:;,\s]+|[-–—:;,\s]+$/g, "")
      .trim();
    return atividade.slice(0, 240) || String(texto || "").trim().slice(0, 240);
  }

  function dataRotulada(texto, rotulo) {
    var padraoData = "(\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2})";
    var m = String(texto || "").match(new RegExp("(?:" + rotulo + ")\\s*:?\\s*" + padraoData, "i"));
    return m ? dataIso(m[1]) : "";
  }

  function metadadosCronograma(texto) {
    var visitaData = dataRotulada(texto, "visita\\s+agendada");
    var concluidoEm = dataRotulada(texto, "conclu[ií]do");
    var previsto = dataRotulada(texto, "previsto|previs[aã]o");
    var mResp = String(texto || "").match(/\bresp(?:ons[aá]vel)?\.?\s*:\s*(.+)$/i);
    var responsavel = mResp ? mResp[1].split(/[•·|]/)[0].trim().slice(0, 120) : "";
    return { previsto: previsto, visitaData: visitaData, concluidoEm: concluidoEm, responsavel: responsavel };
  }

  function linhaDeMetadados(texto) {
    var s = normalizarTexto(texto);
    return /\b(previsto|previsao)\b/.test(s) || /\bvisita agendada\b/.test(s) ||
      /\bconcluido\s*:/.test(s) || /\bresp\s*:/.test(s);
  }

  function linhaDeCabecalho(texto) {
    var s = normalizarTexto(texto);
    return /^(cliente|inicio|modalidade|cadencia|equipe|planejamento e execucao|sistema use)(\s|:|$)/.test(s) ||
      /^cliente\s*:/.test(s) || /^inicio\s*:/.test(s) || /^equipe\s+use/.test(s);
  }

  function interpretarLinhas(linhas, empresas) {
    var resultado = [], empresaAtual = null, faseAtual = "", ultimaAtividade = null;
    (linhas || []).forEach(function (linha) {
      var texto = String(linha.texto || "").replace(/\s+/g, " ").trim();
      if (!texto || texto.length < 3) return;
      var encontrada = localizarEmpresa(texto, empresas);
      if (encontrada) empresaAtual = encontrada;
      var empresa = encontrada || empresaAtual;

      // O PDF da implantação organiza atividades em fases numeradas (01., 02., ...).
      var fase = texto.match(/^\s*\d{1,2}\s*[.)]\s*(.+)$/);
      if (fase && !/^\d{1,2}[/.\-]\d{1,2}/.test(fase[1])) {
        faseAtual = fase[1].trim().slice(0, 120);
        ultimaAtividade = null;
        return;
      }
      if (linhaDeCabecalho(texto) || pareceCabecalho(texto)) return;

      // A linha sob cada item reúne previsto, visita agendada, conclusão e responsável.
      // Associe-a à atividade logo acima em vez de transformá-la em uma tarefa falsa.
      if (linhaDeMetadados(texto)) {
        if (ultimaAtividade && (!empresa || !ultimaAtividade.empresaId || ultimaAtividade.empresaId === empresa.id)) {
          var meta = metadadosCronograma(texto);
          if (meta.previsto) ultimaAtividade.data = meta.previsto;
          if (meta.visitaData) ultimaAtividade.visitaData = meta.visitaData;
          if (meta.concluidoEm) ultimaAtividade.concluidoEm = meta.concluidoEm;
          if (meta.responsavel) ultimaAtividade.responsavel = meta.responsavel;
          if (!ultimaAtividade.status && meta.concluidoEm) ultimaAtividade.status = "concluido";
          ultimaAtividade.trecho = (ultimaAtividade.trecho + " · " + texto).slice(0, 260);
        }
        return;
      }

      var datas = datasDaLinha(texto);
      var status = statusDaLinha(texto);
      var progresso = progressoDaLinha(texto);
      var atividade = textoDaAtividade(texto, encontrada || empresa);
      var somenteNome = empresa && normalizarTexto(atividade) === normalizarTexto(empresa.nome);
      if (somenteNome && !datas.length && !status && progresso == null) return;
      if (!atividade || atividade.length < 2) return;
      if (/^(pagina|p[aá]gina|total de|gerado em)\b/i.test(atividade)) return;
      var item = {
        id: "pdf-row-" + (resultado.length + 1),
        empresaId: empresa ? empresa.id : "",
        empresaNome: empresa ? empresa.nome : "",
        atividade: atividade,
        fase: faseAtual,
        data: datas.length ? datas[datas.length - 1] : "",
        visitaData: "",
        concluidoEm: "",
        responsavel: "",
        hora: horarioDaLinha(texto),
        categoria: categoriaDaLinha(atividade),
        status: status,
        progresso: progresso,
        usar: !!(empresa && atividade),
        pagina: Number(linha.pagina) || 1,
        trecho: texto.slice(0, 260)
      };
      resultado.push(item);
      ultimaAtividade = item;
    });
    return resultado.slice(0, MAX_LINHAS_PREVIA);
  }

  var pdfjsCarregando = null;
  function carregarPdfjs() {
    if (root.pdfjsLib && root.pdfjsLib.getDocument) return Promise.resolve(root.pdfjsLib);
    if (!pdfjsCarregando) {
      pdfjsCarregando = import("./vendor/pdfjs-6.4.299.min.mjs").then(function (modulo) {
        root.pdfjsLib = modulo;
        return modulo;
      }).catch(function () {
        pdfjsCarregando = null;
        throw new Error("Não consegui carregar o leitor de PDF. Atualize a página e tente novamente.");
      });
    }
    return pdfjsCarregando;
  }

  function lerPdf(arquivo, aoProgresso) {
    return new Promise(function (resolve, reject) {
      if (!arquivo || !arquivo.size) { reject(new Error("Escolha um arquivo PDF.")); return; }
      if (arquivo.size > 35 * 1024 * 1024) { reject(new Error("O PDF excede 35 MB. Escolha um arquivo menor.")); return; }

      var leitor = new FileReader();
      leitor.onerror = function () { reject(new Error("Não foi possível ler o arquivo selecionado.")); };
      leitor.onload = function () {
        var bytes = leitor.result;
        if (!bytes || new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 5)).length < 5 ||
            String.fromCharCode.apply(null, Array.prototype.slice.call(new Uint8Array(bytes, 0, 5))) !== "%PDF-") {
          reject(new Error("O arquivo escolhido não parece ser um PDF válido."));
          return;
        }
        (async function () {
          var pdfjs = await carregarPdfjs();
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs-6.4.299.worker.min.mjs", root.location.href).toString();
          var tarefa = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true });
          if (aoProgresso) tarefa.onProgress = aoProgresso;
          var pdf = await tarefa.promise;
          var totalPaginas = pdf.numPages;
          // A liberação do documento fica no PDFDocumentLoadingTask (tarefa.destroy()).
          // O PDFDocumentProxy (pdf) não tem destroy() nas versões recentes do PDF.js.
          if (totalPaginas > MAX_PAGINAS) {
            await tarefa.destroy();
            throw new Error("O PDF tem " + totalPaginas + " páginas. O limite para importação é " + MAX_PAGINAS + ".");
          }
          var linhas = [], textoTotal = "";
          try {
            for (var paginaAtual = 1; paginaAtual <= totalPaginas && textoTotal.length <= MAX_TEXTO; paginaAtual++) {
              var pagina = await pdf.getPage(paginaAtual);
              var conteudo = await pagina.getTextContent();
              linhaPorItens(conteudo.items, paginaAtual).forEach(function (linha) {
                linhas.push(linha);
                textoTotal += linha.texto + "\n";
              });
            }
          } finally { await tarefa.destroy(); }
          resolve({ paginas: totalPaginas, linhas: linhas, texto: textoTotal.slice(0, MAX_TEXTO) });
        })().catch(function (erro) {
          var msg = erro && erro.name === "PasswordException"
            ? "Este PDF está protegido por senha. Remova a proteção e tente de novo."
            : (erro && erro.message ? erro.message : "Não foi possível abrir o PDF. Verifique se ele não está corrompido ou protegido.");
          reject(new Error(msg));
        });
      };
      leitor.readAsArrayBuffer(arquivo);
    });
  }

  root.CRONOGRAMA_PDF = {
    lerPdf: lerPdf,
    interpretarLinhas: interpretarLinhas,
    normalizarTexto: normalizarTexto,
    statusDaLinha: statusDaLinha,
    datasDaLinha: datasDaLinha,
    maxLinhas: MAX_LINHAS_PREVIA
  };
})(window);
