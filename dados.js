/* =====================================================================
   RELATÓRIO DE IMPLANTAÇÕES — dados iniciais (baseline)
   ---------------------------------------------------------------------
   Este arquivo é o "relatório original": ele volta sozinho sempre que
   alguém clicar em "Restaurar relatório original" no site.

   Formato de cada empresa:
   {
     nome        : "Griffe",                       // obrigatório
     tipo        : "Nova implantação",             // texto livre (sugestões no site)
     status      : "cliente",                      // cliente | desenvolvimento | andamento | risco | concluido
     progresso   : 45,                             // 0 a 100
     statusText  : "Frase do que está acontecendo agora.",
     feito       : ["item 1", "item 2"],           // o que já foi feito
     falta       : ["item 1"],                     // o que ainda falta fazer
     grupo       : ["Banks — ..."],                // opcional: outras empresas do mesmo grupo
     fases       : [["done",""],["now",""],...],   // opcional: 5 fases (done|now|pend|na)
     observacao  : "Nota interna (opcional)",
     atualizado  : "2026-10-08"                    // data da última atualização
   }

   Para fixar alterações feitas no site para todos os usuários:
   botão "Dados" -> "Baixar dados.js" e substitua este arquivo no Git.
   ===================================================================== */

window.DADOS_INICIAIS = {
  data: "2026-10-08",
  empresas: [

    {
      nome: "Griffe",
      tipo: "Nova implantação",
      status: "cliente",
      progresso: 45,
      statusText: "Aguardando retorno do cliente para podermos prosseguir.",
      feito: [
        "Instalação do sistema nas máquinas",
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes"
      ],
      falta: ["Retorno do cliente para dar sequência à implantação"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["pend", ""], ["na", ""], ["na", ""]],
      observacao: "Base cadastral pronta. Próximo passo depende exclusivamente do retorno do cliente.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Raguso",
      tipo: "Nova implantação",
      status: "cliente",
      progresso: 50,
      statusText: "Aguardando retorno sobre o cadastro de matéria-prima e semielaborado para podermos rodar a produção. Preferência do cliente: começar pela produção e depois partir para os pedidos.",
      feito: [
        "Instalação do sistema nas máquinas",
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes",
        "Cadastro de semielaborado",
        "Cadastro de matéria-prima",
        "Movimentações de estoque",
        "Cadastros iniciais da produção"
      ],
      falta: ["Validação do cadastro de matéria-prima e semielaborado (bloqueia o início da produção)"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["pend", ""], ["now", ""], ["na", ""]],
      observacao: "Cadastros de produção montados; falta a validação do cliente para rodar o primeiro ciclo produtivo.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Visual Destak",
      tipo: "Nova implantação",
      status: "cliente",
      progresso: 65,
      statusText: "Aguardando o retorno da conexão de internet da empresa para finalizar as configurações de faturamento e então passar a emissão de notas para o Cloud.",
      feito: [
        "Instalação do sistema nas máquinas",
        "Cadastro de usuários",
        "Liberação de telas",
        "Importação de clientes",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Tabela de preço de venda",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes",
        "Cadastro de matéria-prima",
        "Movimentações de estoque",
        "Emissão de pedidos de venda",
        "Emissão de orçamentos",
        "Emissão de pedidos",
        "Emissão de pedidos pelo UseCommerce"
      ],
      falta: [
        "Conexão de internet do cliente",
        "Configurações de faturamento",
        "Migração da emissão de notas para o Cloud"
      ],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["done", ""], ["pend", ""], ["now", ""]],
      observacao: "Uma das carteiras mais avançadas. Único bloqueio real: infraestrutura de internet do cliente.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Terço e Cia",
      tipo: "Nova implantação",
      status: "cliente",
      progresso: 55,
      statusText: "Aguardando retorno deles sobre o cadastro dos produtos para podermos passar à emissão de pedidos.",
      feito: [
        "Instalação do sistema nas máquinas",
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Tabela de preço",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes",
        "Cadastro de matéria-prima",
        "Movimentações de estoque",
        "Movimento de inventário",
        "Cadastro de etiquetas para produtos de venda",
        "Cadastro de detalhes do produto"
      ],
      falta: ["Fechamento do cadastro de produtos", "Início da emissão de pedidos"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["pend", ""], ["na", ""], ["na", ""]],
      observacao: "Estoque e inventário operando; comercial trava no cadastro de produtos.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Moderat",
      tipo: "Nova implantação",
      status: "desenvolvimento",
      progresso: 45,
      statusText: "Aguardando as tabelas de importação de produtos, clientes e fornecedores serem preenchidas para dar treinamento sobre pedidos de venda e emissão de notas. Também aguardando retorno do desenvolvimento sobre as planilhas de importação do financeiro.",
      feito: [
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Tabela de preço",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes",
        "Cadastro de matéria-prima",
        "Movimentações de estoque",
        "Movimento de inventário"
      ],
      falta: [
        "Preenchimento das planilhas de importação de produtos",
        "Preenchimento das planilhas de importação de clientes",
        "Preenchimento das planilhas de importação de fornecedores",
        "Treinamento de pedidos de venda e emissão de notas",
        "Planilhas de importação do financeiro (retorno do desenvolvimento)"
      ],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["now", ""], ["pend", ""], ["pend", ""]],
      observacao: "Duplo bloqueio: cliente precisa entregar as planilhas e o desenvolvimento precisa liberar o import financeiro.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Doogs",
      tipo: "Reimplantação",
      status: "andamento",
      progresso: 80,
      statusText: "Gravação de videoaulas para treinamento da ferramenta de integração com o Bling.",
      feito: [
        "GRH completo",
        "Módulo de produção completo",
        "Todos os cadastros necessários para rodar a produção"
      ],
      falta: ["Videoaulas da integração com o Bling", "Treinamento final da integração"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["done", ""], ["done", ""], ["now", ""]],
      observacao: "Escopo técnico entregue; fase final de treinamento/integração.",
      atualizado: "2026-10-08"
    },

    {
      nome: "McGyver (grupo)",
      tipo: "Migração Cloud",
      status: "andamento",
      progresso: 55,
      statusText: "A migração do sistema para o Cloud irá finalizar as três empresas do grupo McGyver de uma vez só. Única parte em andamento é o PCP da Ponto Forte.",
      feito: [
        "Banks: implantação no Delphi concluída",
        "Eroika: controles básicos em uso (estoque e pedidos)"
      ],
      falta: [
        "Migração das três empresas para o Cloud",
        "Ponto Forte: Produção",
        "Ponto Forte: Financeiro",
        "Ponto Forte: Tesouraria"
      ],
      grupo: [
        "Banks — Implantação no Delphi concluída · migrando para o Cloud",
        "Ponto Forte — Pendente (Cloud): Produção · Financeiro · Tesouraria",
        "Eroika — Usando apenas controles básicos (estoque e pedidos)"
      ],
      fases: [["done", ""], ["done", ""], ["now", ""], ["pend", ""], ["now", ""]],
      observacao: "Grupo com três CNPJs: a migração Cloud será entregue em bloco único. Ponto Forte concentra as pendências.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Manos",
      tipo: "Reimplantação",
      status: "andamento",
      progresso: 65,
      statusText: "Migrando o sistema para web (UseCloud) e repassando as solicitações de solução de erros.",
      feito: [
        "Todo o controle de cadastros, movimentos e relatórios do estoque repassado",
        "Migração do sistema para o UseCloud em andamento"
      ],
      falta: ["Conclusão da migração para o UseCloud", "Soluções de erros repassadas ao cliente"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["now", ""], ["na", ""], ["now", ""]],
      observacao: "Estoque repassado por completo; foco na virada para web.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Campos Verdes",
      tipo: "Nova implantação",
      status: "desenvolvimento",
      progresso: 30,
      statusText: "Focando em treinamentos detalhados e retornos, para dar tempo do desenvolvimento finalizar a criação dos documentos fiscais que faltam para serem emitidos pelo sistema por eles.",
      feito: [
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda"
      ],
      falta: [
        "Treinamentos detalhados",
        "Criação dos documentos fiscais faltantes (desenvolvimento)",
        "Emissão fiscal pelo próprio cliente"
      ],
      grupo: [],
      fases: [["done", ""], ["now", ""], ["pend", ""], ["na", ""], ["pend", ""]],
      observacao: "Implantação inicial. Estratégia: ganhar tempo com treinamentos enquanto o dev entrega os documentos fiscais.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Oficial",
      tipo: "Treinamento",
      status: "cliente",
      progresso: 50,
      statusText: "Marcando reunião remota para fazer o treinamento sobre os relatórios e aguardando retorno das solicitações de ajuste para podermos entregar.",
      feito: ["Treinamento completo sobre CRM"],
      falta: ["Relatórios", "Entrega das solicitações de ajuste do CRM"],
      grupo: [],
      fases: [["done", ""], ["na", ""], ["done", ""], ["pend", ""], ["na", ""]],
      observacao: "Carteira de pós-implantação: treinamento e ajustes de CRM.",
      atualizado: "2026-10-08"
    },

    {
      nome: "A1",
      tipo: "Nova implantação",
      status: "cliente",
      progresso: 75,
      statusText: "Aguardando a finalização do cadastro de produtos para podermos emitir pedidos e controlar a emissão de notas.",
      feito: [
        "Instalação do sistema nas máquinas",
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Tabela de preço",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes",
        "Publicação de produtos",
        "Agrupamento de produtos",
        "Cadastro de cores e duplicação de produtos por cor",
        "Inventário",
        "Movimento de estoque",
        "Posição de estoque",
        "Controle de caixa",
        "Emissão de pedidos (treinado, ainda não em uso)"
      ],
      falta: ["Finalização do cadastro de produtos", "Início da emissão de pedidos", "Controle da emissão de notas"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["now", ""], ["now", ""], ["pend", ""]],
      observacao: "17 itens entregues. Falta o cliente concluir o cadastro de produtos para destravar o comercial.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Fashion",
      tipo: "Nova implantação",
      status: "cliente",
      progresso: 80,
      statusText: "Aguardando validação da entrada por nota para podermos começar o controle de estoque e assim emitir pedidos e notas pelo sistema.",
      feito: [
        "Instalação do sistema nas máquinas",
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Tabela de preço",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes",
        "Publicação de produtos",
        "Agrupamento de produtos",
        "Cadastro de cores e duplicação de produtos por cor",
        "Inventário",
        "Movimento de estoque",
        "Posição de estoque",
        "Controle de caixa",
        "Emissão de pedidos (treinado, ainda não em uso)",
        "Emissão de pedidos pelo UseCommerce",
        "Entrada por nota diferenciada do PDV"
      ],
      falta: ["Validação da entrada por nota", "Início do controle de estoque", "Emissão de pedidos e notas pelo sistema"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["done", ""], ["now", ""], ["pend", ""]],
      observacao: "Carteira mais completa da lista (19 itens concluídos). Só falta validar a entrada por nota.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Dias Couro",
      tipo: "Nova implantação",
      status: "risco",
      progresso: 25,
      statusText: "Travado por falta de retorno e interesse do cliente pela implantação do sistema. De todos os treinamentos que foram feitos, nada foi cadastrado — mesmo cobrando retorno semanalmente e com visitas regulares. Analisar outra maneira de prosseguir.",
      feito: [
        "Instalação do sistema nas máquinas",
        "Cadastro de usuários",
        "Liberação de telas",
        "Cadastro de grupo, subgrupo e classe de produtos",
        "Cadastro de produtos de venda",
        "Tabela de preço",
        "Cadastro de clientes",
        "Cadastro de fornecedores",
        "Cadastro de representantes",
        "Publicação de produtos"
      ],
      falta: [
        "Cliente não realizou nenhum cadastro após os treinamentos",
        "Definir nova forma de conduzir a implantação (escalar / revisar cronograma)"
      ],
      grupo: [],
      fases: [["done", ""], ["pend", ""], ["pend", ""], ["na", ""], ["na", ""]],
      observacao: "CARTÃO VERMELHO: implantação parada por desinteresse do cliente. Precisa de decisão gerencial.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Estilo Único Lavanderia",
      tipo: "Reimplantação",
      status: "andamento",
      progresso: 50,
      statusText: "Voltou à ativa após a troca de funcionários. Treinamentos semanais para finalizar a implantação completa do PCP.",
      feito: ["Cadastros iniciais", "Planejamento de ficha para produção de lavagens"],
      falta: ["Treinamentos semanais", "Finalização da implantação completa do PCP"],
      grupo: [],
      fases: [["done", ""], ["done", ""], ["na", ""], ["now", ""], ["na", ""]],
      observacao: "Retomada após troca de equipe; ritmo semanal de treinamento.",
      atualizado: "2026-10-08"
    },

    {
      nome: "Confitex",
      tipo: "Treinamento",
      status: "cliente",
      progresso: 40,
      statusText: "Aguardando o cliente começar a usar ativamente o PDV para podermos receber feedback.",
      feito: ["Treinamento completo sobre PDV"],
      falta: ["Uso ativo do PDV pelo cliente", "Coleta de feedback e ajustes"],
      grupo: [],
      fases: [["done", ""], ["na", ""], ["now", ""], ["na", ""], ["na", ""]],
      observacao: "Pós-treinamento: bola com o cliente para colocar o PDV em operação.",
      atualizado: "2026-10-08"
    }

  ]
};
