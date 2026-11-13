-- Desfaz 002_comunidade_ponte_sem_kickoff.sql: volta comunidade_ponte.reunioes() para a
-- definição que estava em produção em 12/11/2026 (copiada de pg_get_functiondef, intacta;
-- hash do corpo normalizado 808d0f8d78c401993f3076834d8fba6d).
-- Só usar se a correção precisar ser revertida.

CREATE OR REPLACE FUNCTION comunidade_ponte.reunioes(p_de interval DEFAULT '1 day'::interval, p_ate interval DEFAULT '8 days'::interval)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return (
    select jsonb_build_object(
      'janela', jsonb_build_object('de', now() - p_de, 'ate', now() + p_ate),
      'reunioes', coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'empresa', m.tenant_id, 'titulo', m.title, 'inicio', m.scheduled_start_at, 'fim', m.scheduled_end_at,
        'status', m.status::text, 'comecou_em', m.started_at, 'terminou_em', m.ended_at, 'cancelada_em', m.cancelled_at,
        'criada_em', m.created_at, 'sala', m.room_name,
        'recorrente', m.recurrence_parent_id is not null or m.recurrence_rule is not null, 'atualizada_em', m.updated_at,
        'executor', jsonb_build_object('id', h.id, 'nome', h.name, 'email', lower(btrim(h.email)), 'papel', h.role::text),
        'produto', t.produto, 'responsavel', t.owner,
        'emails', coalesce((select jsonb_agg(distinct x.e order by x.e) from (
                     select lower(btrim(t.email)) as e
                     union all
                     select lower(btrim(u.email)) from public.users u where u.tenant_id = m.tenant_id and u.role::text = 'CLIENT') x
                   where x.e ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'), '[]'::jsonb)
      ) order by m.scheduled_start_at, m.id), '[]'::jsonb))
      from public.meetings m
      join public.meet_meeting_sector s on s.meeting_id = m.id and s.sector = 'executoria'
      left join public.users h on h.id = m.host_id
      left join public.client_tenants t on t.id = m.tenant_id
     where m.scheduled_start_at >= now() - p_de and m.scheduled_start_at < now() + p_ate);
end $function$;
