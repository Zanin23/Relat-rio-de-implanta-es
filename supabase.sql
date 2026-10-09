/* =====================================================================
   SUPABASE — roda isto no SQL Editor do projeto, uma vez só.
   Cria a tabela compartilhada, libera leitura/escrita para quem tem o
   link (como pedido) e liga o tempo real.
   ---------------------------------------------------------------------
   Passo a passo no site do Supabase:
     1. New project  ->  nome "relatorio-implantacoes", região South America
        (São Paulo) e uma senha do banco que você vai guardar.
     2. SQL Editor  ->  New query  ->  cole este arquivo inteiro  ->  Run.
     3. Project Settings -> API  ->  copie  Project URL  e  anon public key
        e cole em sync-config.js (ou no botão ☁ do próprio site).
     4. Commit do sync-config.js + push  ->  a Vercel publica  ->  pronto.
   ===================================================================== */

-- ------------------------------------------------------------------
-- 1) a tabela única: uma linha por empresa + a linha "__meta__"
-- ------------------------------------------------------------------
create table if not exists public.documentos (
  id             text primary key,
  dados          jsonb not null default '{}'::jsonb,
  ordem          integer not null default 0,
  atualizado_em  timestamptz not null default now()
);

comment on table public.documentos is
  'Relatório de implantações: __meta__ = data do levantamento; demais linhas = uma empresa (dados = objeto como no dados.js).';

-- qualquer alteração de empresa empurra o "último update" para frente
create or replace function public.documentos_toca()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists documentos_toca_gatilho on public.documentos;
create trigger documentos_toca_gatilho
  before update on public.documentos
  for each row execute function public.documentos_toca();

-- ------------------------------------------------------------------
-- 2) RLS: aberta para quem tem o link (leitura e escrita anônimas).
--    Para fechar depois, troque "using (true)" por uma checagem de JWT
--    ou exclua as políticas de escrita e deixe só a de leitura.
-- ------------------------------------------------------------------
alter table public.documentos enable row level security;

drop policy if exists documentos_leitura on public.documentos;
create policy documentos_leitura on public.documentos
  for select using (true);

drop policy if exists documentos_insercao on public.documentos;
create policy documentos_insercao on public.documentos
  for insert with check (true);

drop policy if exists documentos_escrita on public.documentos;
create policy documentos_escrita on public.documentos
  for update using (true) with check (true);

drop policy if exists documentos_remocao on public.documentos;
create policy documentos_remocao on public.documentos
  for delete using (true);

-- ------------------------------------------------------------------
-- 3) tempo real: toda mudança na tabela é empurrada para as abas abertas
-- ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'documentos'
  ) then
    alter publication supabase_realtime add table public.documentos;
  end if;
end $$;

-- também pelo backend de realtime do Supabase (idempotente; se der erro, o
-- bloco acima já garantiu a publicação)
-- insert into _realtime.publications (name) values ('supabase_realtime');

-- ------------------------------------------------------------------
-- 4) opcional — conferir se está tudo no lugar
-- ------------------------------------------------------------------
-- select id, ordem, atualizado_em, left(dados::text, 60) from public.documentos order by ordem;
