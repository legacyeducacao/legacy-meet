-- Ponte Legacy Plan -> Hub (comunidade_ponte): reuniões sem as sessões de kickoff do Impulsão.
-- Projeto legacy-plan (eddfdgefrwjxfafkkzls).
--
-- STATUS: NÃO APLICADA. Aplicar só com autorização (procedimento em docs/kickoff/README.md,
-- seção "Integração comunidade_ponte").
--
-- Por quê: o Legacy Meet passou a ter Kickoffs Coletivos do Impulsão como eventos da
-- agenda (reuniões em public.meetings marcadas em public.agenda_kickoff_sessoes, tipo
-- 'kickoff_impulsao'). Eles têm reserva por empresa e participação pelo Zoom, com processo
-- próprio, e não podem ir para o Hub como reunião comum de Executoria: o Hub dispara
-- lembretes anti-no-show por WhatsApp e e-mail para os contatos da empresa da reunião.
--
-- O que muda: só o where de comunidade_ponte.reunioes(). Tudo o mais é a definição que
-- estava em produção em 12/11/2026 (copiada de pg_get_functiondef, sem outra mudança):
-- mesmas colunas, janela, filtro de setor, e-mails e ordem. enviar_reunioes() e o Hub não
-- mudam: o Hub trata cada envio como a lista completa da janela (o que não vem fica com
-- sumiu_em), então basta não mandar.
--
-- Depende de: integracoes/kickoff/001_kickoff_m1.sql (tabela agenda_kickoff_sessoes; aplicada
-- em 12/11/2026). create or replace mantém o dono (postgres) e as permissões.
-- Desfazer: 002_comunidade_ponte_sem_kickoff.reverter.sql (a definição anterior, intacta).

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
     where m.scheduled_start_at >= now() - p_de and m.scheduled_start_at < now() + p_ate
       -- Kickoff Impulsão (Legacy Meet): sessão coletiva com reserva e Zoom próprios, não é reunião comum de Executoria.
       and not exists (select 1 from public.agenda_kickoff_sessoes k
                        where k.meeting_id = m.id and k.tipo = 'kickoff_impulsao'));
end $function$;
