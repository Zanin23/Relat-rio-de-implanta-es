/* =====================================================================
   SERVIDOR COMPARTILHADO — configuração
   ---------------------------------------------------------------------
   É este arquivo que faz a alteração de um valer para todos. Depois de
   criar o projeto no Supabase (veja README + supabase.sql), cole aqui a
   URL e a anon key e faça commit: todo mundo que abrir o link passa a ler
   e escrever no mesmo banco, em tempo real.

   Deixou os campos em branco? O app funciona do jeito antigo (salva só no
   navegador) e o rodapé avisa disso.

   A anon key é pública por design — a proteção dos dados vem das políticas
   de RLS criadas por supabase.sql. Ela não dá acesso a nada além do que as
   políticas permitem.
   ===================================================================== */
window.SYNC_CONFIG = {
  url: "",                     // ex.: "https://abcdefghijmnop.supabase.co"
  anonKey: "",                 // ex.: "eyJhbGciOiJIUzI1NiIs..." (longa, começa com eyJ)
  table: "documentos",        // nome da tabela criada pelo supabase.sql
  schema: "public"
};
