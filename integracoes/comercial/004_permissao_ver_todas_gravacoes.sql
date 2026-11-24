-- Permissão "Ver todas as gravações" (sem ser admin), ligada na tela de
-- usuários. Pedido do usuário em 24/11/2026.
alter table public.meet_user_profile drop constraint if exists meet_user_profile_capacidades_ck;
alter table public.meet_user_profile add constraint meet_user_profile_capacidades_ck
  check (capacidades <@ array['kickoff_impulsao.manage', 'gravacoes.ver_todas']::text[]);
