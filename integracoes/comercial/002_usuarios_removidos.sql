-- Usuários removidos pelo admin do Meet (quem saiu da empresa).
-- O login é apagado na prática (e-mail trocado, senha trocada, acesso
-- bloqueado em todos os projetos); o registro em public.users fica só com o
-- nome, para reuniões, gravações e NPS antigos continuarem mostrando quem foi.
create table if not exists public.meet_usuarios_removidos (
  user_id uuid primary key,
  nome text,
  email_antigo text not null,
  removido_por uuid,
  removido_em timestamptz not null default now()
);
alter table public.meet_usuarios_removidos enable row level security;
-- Sem políticas: só o service_role (servidor do Meet) lê e grava.
