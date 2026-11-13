// Compatibilidade da migration 004 (gatilho em public.meetings, tabela compartilhada
// com o Legacy Plan). O banco de teste tem, além das migrations reais, os dois
// gatilhos que já existem em meetings em produção (definições copiadas de
// pg_get_functiondef em 12/11/2026) e RLS de atualização no estilo do Plan, para
// conferir que reuniões comuns do Meet e do Plan continuam iguais.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

/** Gatilhos que já existem em public.meetings em produção (cópia fiel das funções). */
const GATILHOS_DO_PLAN = `
  alter table public.meetings add column updated_at timestamptz not null default now(), add column recording_enabled boolean not null default false;
  alter table public.client_tenants add column access_blocked boolean not null default false;
  create function public.is_legacy_staff(uuid) returns boolean language sql stable as $$ select false $$;

  CREATE OR REPLACE FUNCTION public.set_meetings_updated_at()
   RETURNS trigger
   LANGUAGE plpgsql
   SET search_path TO 'public', 'pg_catalog'
  AS $function$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $function$;

  CREATE OR REPLACE FUNCTION public.guard_tenant_writable()
   RETURNS trigger
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public', 'pg_catalog'
  AS $function$
  DECLARE
    v_tenant_id UUID;
    v_blocked BOOLEAN;
  BEGIN
    IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    IF auth.uid() IS NOT NULL AND public.is_legacy_staff(auth.uid()) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
    IF v_tenant_id IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT access_blocked INTO v_blocked
    FROM public.client_tenants WHERE id = v_tenant_id;

    IF v_blocked THEN
      RAISE EXCEPTION 'tenant_access_blocked'
        USING HINT = 'Pagamento pendente. Acesso somente leitura ate regularizacao.';
    END IF;

    RETURN COALESCE(NEW, OLD);
  END;
  $function$;

  CREATE TRIGGER trg_guard_writable BEFORE INSERT OR DELETE OR UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION guard_tenant_writable();
  CREATE TRIGGER meetings_updated_at_trigger BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION set_meetings_updated_at();

  -- RLS de meetings no estilo do Plan: o anfitrião atualiza a própria reunião.
  alter table public.meetings enable row level security;
  create policy meetings_select on public.meetings for select to authenticated using (true);
  create policy meetings_update on public.meetings for update to authenticated using (host_id = auth.uid());
  create policy meetings_delete on public.meetings for delete to authenticated using (host_id = auth.uid());
  grant select, update, delete on public.meetings to authenticated;
  grant select on public.client_tenants to authenticated;
`;

const ORG = '0c000000-0000-4000-8000-000000000000';
const CLI = '0e000000-0000-4000-8000-000000000001';
const BLOQUEADA = '0e000000-0000-4000-8000-000000000002';
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const HOST_PLAN = '1b000000-0000-4000-8000-000000000002';
const M = {
  meet: '2a000000-0000-4000-8000-000000000001', // reunião comum do Meet (com setor)
  plan: '2a000000-0000-4000-8000-000000000002', // reunião do Planner do Plan (sem setor)
  planBloqueada: '2a000000-0000-4000-8000-000000000003',
  kVazia: '2a000000-0000-4000-8000-000000000004', // kickoff sem reservas
  kCheia: '2a000000-0000-4000-8000-000000000005', // kickoff com reserva ativa
  kCancelada: '2a000000-0000-4000-8000-000000000006', // kickoff só com reserva cancelada
  kDoHostPlan: '2a000000-0000-4000-8000-000000000007', // kickoff com reserva, anfitrião = usuário do Plan
};

let db: PGlite;
type Erro = { message: string; code?: string };
async function falha(sql: string, params: unknown[] = []): Promise<Erro> {
  try {
    await db.query(sql, params);
  } catch (e) {
    return { message: (e as Error).message, code: (e as { code?: string }).code };
  }
  throw new Error('era para falhar: ' + sql);
}
const linha = async (id: string) =>
  (
    await db.query<{ status: string; scheduled_start_at: string; title: string; room_name: string; tenant_id: string; updated_at: string; recording_enabled: boolean }>(
      'select status::text, scheduled_start_at::text, title, room_name, tenant_id, updated_at::text, recording_enabled from public.meetings where id = $1',
      [id],
    )
  ).rows[0];
const mover = (id: string) =>
  `update public.meetings set scheduled_start_at = scheduled_start_at + interval '1 day', scheduled_end_at = scheduled_end_at + interval '1 day' where id = '${id}'`;
/** Como o Plan escreve: papel authenticated, com o usuário no JWT e RLS ligado. */
async function comoPlan<T>(usuario: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${usuario}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec(sqlDoRepo('integracoes/agenda/001_agenda.sql'));
  await db.exec(sqlDoRepo('integracoes/agenda/003_agenda_cliente.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/001_kickoff_m1.sql'));
  await db.exec(GATILHOS_DO_PLAN);
  await db.exec(sqlDoRepo('integracoes/kickoff/003_kickoff_reservas.sql'));
  // Preparo como o servidor do Meet grava (service_role), que a trava de inadimplência libera.
  await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
  await db.exec(`
    insert into auth.users (id) values ('${GESTOR}'), ('${HOST_PLAN}');
    insert into public.client_tenants (id, name, access_blocked) values
      ('${ORG}', 'Customer Success', false), ('${CLI}', 'Cliente', false), ('${BLOQUEADA}', 'Inadimplente', true);
    insert into public.users (id, name, role) values ('${GESTOR}', 'Gestor', 'CUSTOMER_SUCCESS'), ('${HOST_PLAN}', 'Consultor', 'EXECUTOR');
    insert into public.meet_user_profile (user_id, is_admin, sector, capacidades) values ('${GESTOR}', false, 'executoria', '{kickoff_impulsao.manage}');
    insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, room_name) values
      ('${M.meet}', '${CLI}', '${GESTOR}', 'Comum do Meet', now() + interval '1 day', now() + interval '1 day 1 hour', 'r1'),
      ('${M.plan}', '${CLI}', '${HOST_PLAN}', 'Do Planner', now() + interval '1 day', now() + interval '1 day 1 hour', 'r2'),
      ('${M.planBloqueada}', '${BLOQUEADA}', '${HOST_PLAN}', 'Empresa bloqueada', now() + interval '1 day', now() + interval '1 day 1 hour', 'r3'),
      ('${M.kVazia}', '${ORG}', '${GESTOR}', 'Kickoff vazio', now() + interval '2 days', now() + interval '2 days 1 hour', 'r4'),
      ('${M.kCheia}', '${ORG}', '${GESTOR}', 'Kickoff com empresa', now() + interval '3 days', now() + interval '3 days 1 hour', 'r5'),
      ('${M.kCancelada}', '${ORG}', '${GESTOR}', 'Kickoff só cancelada', now() + interval '4 days', now() + interval '4 days 1 hour', 'r6'),
      ('${M.kDoHostPlan}', '${ORG}', '${HOST_PLAN}', 'Kickoff de outro anfitrião', now() + interval '5 days', now() + interval '5 days 1 hour', 'r7');
    insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values
      ('${M.meet}', 'executoria', false), ('${M.kVazia}', 'executoria', true), ('${M.kCheia}', 'executoria', true),
      ('${M.kCancelada}', 'executoria', true), ('${M.kDoHostPlan}', 'executoria', true);
    insert into public.agenda_kickoff_sessoes (meeting_id) values ('${M.kVazia}'), ('${M.kCheia}'), ('${M.kCancelada}'), ('${M.kDoHostPlan}');
  `);
  // Reservas pelo caminho normal, ANTES da 004 (como ficaria em produção).
  const reservar = (sessao: string, empresa: string) =>
    db.query("select public.agenda_kickoff_reservar($1, $2, 'Pessoa', 'p@x.com.br', null, $3) as r", [sessao, empresa, GESTOR]);
  await reservar(M.kCheia, CLI);
  const r = await db.query<{ r: { id: string } }>(
    "select public.agenda_kickoff_reservar($1, $2, 'Pessoa', 'p@x.com.br', null, $3) as r",
    [M.kCancelada, BLOQUEADA, GESTOR],
  );
  await db.query("select public.agenda_kickoff_cancelar_reserva($1, 'desistiu', $2)", [r.rows[0].r.id, GESTOR]);
  await db.exec(`insert into public.client_tenants (id, name) values ('0e000000-0000-4000-8000-000000000003', 'Outra')`);
  await reservar(M.kDoHostPlan, '0e000000-0000-4000-8000-000000000003');
  await db.exec(sqlDoRepo('integracoes/kickoff/004_kickoff_reuniao_protegida.sql'));
  await db.exec(`select set_config('request.jwt.claims', '{}', false)`); // daqui em diante, não é o service_role
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('reuniões comuns do Meet: sem mudança', () => {
  it('movem, renomeiam e cancelam normalmente (e o updated_at do Plan continua sendo gravado)', async () => {
    const antes = await linha(M.meet);
    await db.query(mover(M.meet));
    await db.query("update public.meetings set title = 'Renomeada', recording_enabled = true where id = $1", [M.meet]);
    await db.query("update public.meetings set status = 'canceled' where id = $1", [M.meet]);
    const depois = await linha(M.meet);
    expect(depois).toMatchObject({ status: 'canceled', title: 'Renomeada', recording_enabled: true });
    expect(depois.scheduled_start_at).not.toBe(antes.scheduled_start_at);
    expect(depois.updated_at >= antes.updated_at).toBe(true);
  });
});

describe('reuniões do Plan: sem mudança', () => {
  it('o anfitrião do Plan (authenticated, com RLS) move, cancela e apaga a própria reunião', async () => {
    await comoPlan(HOST_PLAN, async () => {
      await db.query(mover(M.plan));
      await db.query("update public.meetings set status = 'canceled' where id = $1", [M.plan]);
    });
    expect((await linha(M.plan)).status).toBe('canceled');
    await comoPlan(HOST_PLAN, () => db.query('delete from public.meetings where id = $1', [M.plan]));
    expect(await linha(M.plan)).toBeUndefined();
  });

  it('a trava de inadimplência do Plan continua valendo como antes', async () => {
    const e = await comoPlan(HOST_PLAN, () => falha(mover(M.planBloqueada)));
    expect(e.message).toBe('tenant_access_blocked');
  });
});

describe('sessões de kickoff', () => {
  it('sem reservas (ou só com canceladas): editáveis como antes, inclusive por SQL direto', async () => {
    for (const id of [M.kVazia, M.kCancelada]) {
      const antes = await linha(id);
      await db.query(mover(id));
      expect((await linha(id)).scheduled_start_at).not.toBe(antes.scheduled_start_at);
    }
    await db.query("update public.meetings set status = 'canceled' where id = $1", [M.kVazia]);
    expect((await linha(M.kVazia)).status).toBe('canceled');
  });

  it('com reserva: horário, estado e empresa não mudam, nem por SQL direto como dono do banco', async () => {
    const antes = await linha(M.kCheia);
    for (const sql of [
      mover(M.kCheia),
      `update public.meetings set scheduled_end_at = scheduled_end_at + interval '30 minutes' where id = '${M.kCheia}'`,
      `update public.meetings set status = 'canceled' where id = '${M.kCheia}'`,
      `update public.meetings set status = 'no_show' where id = '${M.kCheia}'`,
      `update public.meetings set tenant_id = '${CLI}' where id = '${M.kCheia}'`,
    ]) {
      const e = await falha(sql);
      expect(e.code).toBe('22023');
      expect(e.message).toMatch(/^Esta sessão de kickoff tem 1 empresa\(s\) inscrita\(s\)/);
    }
    expect((await falha('delete from public.meetings where id = $1', [M.kCheia])).code).toBe('23001');
    expect(await linha(M.kCheia)).toMatchObject({ status: 'scheduled', scheduled_start_at: antes.scheduled_start_at, tenant_id: ORG });
  });

  it('com reserva: campos que não são horário, estado nem empresa continuam livres', async () => {
    await db.query("update public.meetings set title = 'Kickoff de dezembro', room_name = 'r5b', recording_enabled = false where id = $1", [M.kCheia]);
    // "Atualizar" sem mudar horário/estado/empresa (o mesmo valor) também passa.
    await db.query('update public.meetings set scheduled_start_at = scheduled_start_at, status = status where id = $1', [M.kCheia]);
    expect(await linha(M.kCheia)).toMatchObject({ title: 'Kickoff de dezembro', room_name: 'r5b' });
  });

  it('pelo Plan (authenticated, sem acesso às tabelas do kickoff): a regra vale e a mensagem é clara', async () => {
    const e = await comoPlan(HOST_PLAN, () => falha(mover(M.kDoHostPlan)));
    expect(e.message).toMatch(/^Esta sessão de kickoff tem 1 empresa\(s\) inscrita\(s\)/);
    // E o resto continua liberado para ele.
    await comoPlan(HOST_PLAN, () => db.query("update public.meetings set title = 'Renomeado pelo Plan' where id = $1", [M.kDoHostPlan]));
    expect((await linha(M.kDoHostPlan)).title).toBe('Renomeado pelo Plan');
  });

  it('sessão histórica (reservas concluída, ausente e interrompida): manutenção de campos não críticos passa; data, estado e empresa não', async () => {
    const H = '2a000000-0000-4000-8000-000000000008';
    const emp = ['0e000000-0000-4000-8000-000000000011', '0e000000-0000-4000-8000-000000000012', '0e000000-0000-4000-8000-000000000013'];
    await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    await db.exec(`
      insert into public.client_tenants (id, name) values ${emp.map((e) => `('${e}', 'Histórica')`).join(', ')};
      insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, room_name)
        values ('${H}', '${ORG}', '${GESTOR}', 'Kickoff histórico', now() + interval '6 days', now() + interval '6 days 1 hour', 'r8');
      insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values ('${H}', 'executoria', true);
      insert into public.agenda_kickoff_sessoes (meeting_id) values ('${H}');
    `);
    const ids: string[] = [];
    for (const e of emp) {
      const r = await db.query<{ r: { id: string } }>("select public.agenda_kickoff_reservar($1, $2, 'Pessoa', 'p@x.com.br', null, $3) as r", [H, e, GESTOR]);
      ids.push(r.rows[0].r.id);
    }
    // O tempo passa (só para montar o cenário: gatilhos desligados nesta escrita).
    await db.exec(`
      set session_replication_role = replica;
      update public.meetings set scheduled_start_at = now() - interval '2 hours', scheduled_end_at = now() - interval '1 hour' where id = '${H}';
      set session_replication_role = default;
    `);
    await db.query("select public.agenda_kickoff_registrar_presenca($1, 'presente', $2)", [ids[0], GESTOR]);
    await db.query("select public.agenda_kickoff_concluir($1, null, $2)", [ids[0], GESTOR]);
    await db.query("select public.agenda_kickoff_registrar_presenca($1, 'ausente', $2)", [ids[1], GESTOR]);
    await db.query("select public.agenda_kickoff_registrar_presenca($1, 'presente', $2)", [ids[2], GESTOR]);
    await db.query("select public.agenda_kickoff_registrar_interrupcao($1, 'Caiu a conexão', $2)", [ids[2], GESTOR]);
    await db.exec(`select set_config('request.jwt.claims', '{}', false)`);

    const antes = await linha(H);
    // Manutenção legítima: título, sala, gravação.
    await db.query("update public.meetings set title = 'Kickoff histórico (corrigido)', room_name = 'r8b', recording_enabled = true where id = $1", [H]);
    expect(await linha(H)).toMatchObject({ title: 'Kickoff histórico (corrigido)', room_name: 'r8b', recording_enabled: true });
    // Nada que invalide a participação registrada: data, fim, estado, empresa; nem apagar.
    for (const sql of [
      mover(H),
      `update public.meetings set scheduled_end_at = scheduled_end_at + interval '1 hour' where id = '${H}'`,
      `update public.meetings set status = 'canceled' where id = '${H}'`,
      `update public.meetings set status = 'ended' where id = '${H}'`,
      `update public.meetings set tenant_id = '${CLI}' where id = '${H}'`,
    ]) {
      expect((await falha(sql)).message).toMatch(/^Esta sessão de kickoff tem 3 empresa\(s\) inscrita\(s\)/);
    }
    expect((await falha('delete from public.meetings where id = $1', [H])).code).toBe('23001');
    expect((await falha('select public.agenda_kickoff_cancelar_sessoes($1, true, null, null, $2)', [[H], GESTOR])).message).toMatch(
      /já tem presença ou conclusão registrada: não pode ser cancelada\.$/,
    );
    const depois = await linha(H);
    expect({ inicio: depois.scheduled_start_at, status: depois.status, tenant: depois.tenant_id }).toEqual({
      inicio: antes.scheduled_start_at,
      status: antes.status,
      tenant: antes.tenant_id,
    });
  });

  it('cancelar a sessão junto com as reservas (decisão explícita) continua funcionando', async () => {
    const r = await db.query<{ r: { sessoes: string[]; reservasCanceladas: number } }>(
      "select public.agenda_kickoff_cancelar_sessoes($1, true, 'Feriado', 'legacy', $2) as r",
      [[M.kCheia], GESTOR],
    );
    expect(r.rows[0].r).toEqual({ sessoes: [M.kCheia], reservasCanceladas: 1 });
    expect((await linha(M.kCheia)).status).toBe('canceled');
  });
});
