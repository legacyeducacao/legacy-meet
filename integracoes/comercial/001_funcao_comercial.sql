-- Função no Comercial (SDR agenda, Closer conduz). Vazio = sem função.
-- Só vale para quem tem acesso ao Comercial (setor comercial ou ambos);
-- a tela de usuários limpa a função quando o setor vira Executoria.
alter table public.meet_user_profile
  add column if not exists funcao_comercial text
  constraint meet_user_profile_funcao_comercial_ck check (funcao_comercial in ('sdr', 'closer'));

comment on column public.meet_user_profile.funcao_comercial is
  'Comercial: sdr (agenda para um Closer) ou closer (conduz; a agenda dele é conferida). NULL = sem função.';
