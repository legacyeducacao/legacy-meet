// Migration da M1 (integracoes/kickoff/001_kickoff_m1.sql) num Postgres de
// verdade em memória (PGlite), sem rede e sem tocar no banco de produção.
// Monta o mínimo das tabelas do Plan, aplica as migrations reais da agenda
// (001 e 003) e depois a do kickoff.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo as sql } from './bancoDeTeste';

const ORG = '11111111-1111-4111-8111-111111111111'; // empresa organizadora interna
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const LOGIN_DA_ORG = '33333333-3333-4333-8333-333333333333'; // login CLIENT/COLLABORATOR da organizadora
const ANFITRIAO = '44444444-4444-4444-8444-444444444444';
const COMUM = '55555555-5555-4555-8555-555555555555';
const KICKOFF = '66666666-6666-4666-8666-666666666666';

let db: PGlite;

const erroDe = async (q: string) => {
  try {
    await db.exec(q);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec(sql('integracoes/agenda/001_agenda.sql'));
  await db.exec(sql('integracoes/agenda/003_agenda_cliente.sql'));
  await db.exec(`
    insert into auth.users (id) values ('${ANFITRIAO}'), ('${LOGIN_DA_ORG}');
    insert into public.client_tenants (id, name) values ('${ORG}', 'Organizadora'), ('${CLIENTE}', 'Cliente');
    insert into public.users (id, name, role, tenant_id) values
      ('${ANFITRIAO}', 'Anfitrião', 'CUSTOMER_SUCCESS', null),
      ('${LOGIN_DA_ORG}', 'Colaborador interno', 'COLLABORATOR', '${ORG}');
    insert into public.meet_user_profile (user_id, is_admin, sector) values ('${ANFITRIAO}', false, 'executoria');
    insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, room_name) values
      ('${COMUM}', '${ORG}', '${ANFITRIAO}', 'Reunião comum', now() + interval '1 day', now() + interval '1 day 1 hour', 'meet_comum'),
      ('${KICKOFF}', '${ORG}', '${ANFITRIAO}', 'Kickoff Impulsão', now() + interval '2 days', now() + interval '2 days 1 hour', 'meet_kickoff');
    insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values
      ('${COMUM}', 'executoria', false), ('${KICKOFF}', 'executoria', true);
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** Reuniões que um login vê pela agenda do cliente, como a sessão do Plan veria. */
async function agendaDoCliente(login: string): Promise<string[]> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${login}', false);`);
  try {
    const r = await db.query<{ reuniao_id: string }>('select reuniao_id from public.agenda_do_cliente()');
    return r.rows.map((x) => x.reuniao_id).sort();
  } finally {
    await db.exec('reset role;');
  }
}

describe('migration 001_kickoff_m1', () => {
  it('antes dela, o login da organizadora veria a sessão de kickoff na agenda do cliente', async () => {
    expect(await agendaDoCliente(LOGIN_DA_ORG)).toEqual([COMUM, KICKOFF].sort());
  });

  it('aplica sobre a agenda atual e pode rodar de novo sem erro', async () => {
    await db.exec(sql('integracoes/kickoff/001_kickoff_m1.sql'));
    await db.exec(sql('integracoes/kickoff/001_kickoff_m1.sql'));
    await db.exec(`insert into public.agenda_kickoff_sessoes (meeting_id) values ('${KICKOFF}')`);
  });

  it('depois dela, a agenda do cliente esconde a sessão de kickoff e mantém a reunião comum', async () => {
    expect(await agendaDoCliente(LOGIN_DA_ORG)).toEqual([COMUM]);
  });

  it('perfil: capacidades começa vazio, aceita a permissão do kickoff e recusa valor desconhecido', async () => {
    const r = await db.query<{ capacidades: string[] }>(`select capacidades from public.meet_user_profile where user_id = '${ANFITRIAO}'`);
    expect(r.rows[0].capacidades).toEqual([]);
    expect(await erroDe(`update public.meet_user_profile set capacidades = '{kickoff_impulsao.manage}' where user_id = '${ANFITRIAO}'`)).toBeNull();
    expect(await erroDe(`update public.meet_user_profile set capacidades = '{qualquer.coisa}' where user_id = '${ANFITRIAO}'`)).toMatch(/capacidades_ck/);
  });

  it('sessão: valores padrão, capacidade de 1 a 50, tipo fixo e uma linha por reunião', async () => {
    const r = await db.query<{ tipo: string; capacidade: number; aceita_reservas: boolean }>(
      `select tipo, capacidade, aceita_reservas from public.agenda_kickoff_sessoes where meeting_id = '${KICKOFF}'`,
    );
    expect(r.rows[0]).toEqual({ tipo: 'kickoff_impulsao', capacidade: 5, aceita_reservas: true });
    expect(await erroDe(`update public.agenda_kickoff_sessoes set capacidade = 0 where meeting_id = '${KICKOFF}'`)).toMatch(/check/);
    expect(await erroDe(`update public.agenda_kickoff_sessoes set capacidade = 51 where meeting_id = '${KICKOFF}'`)).toMatch(/check/);
    expect(await erroDe(`update public.agenda_kickoff_sessoes set tipo = 'outro' where meeting_id = '${KICKOFF}'`)).toMatch(/check/);
    expect(await erroDe(`insert into public.agenda_kickoff_sessoes (meeting_id) values ('${KICKOFF}')`)).toMatch(/duplicate key/);
    expect(await erroDe(`insert into public.agenda_kickoff_sessoes (meeting_id) values (gen_random_uuid())`)).toMatch(/foreign key/);
  });

  it('só o servidor (service_role) lê a tabela; anon e authenticated não', async () => {
    for (const papel of ['anon', 'authenticated']) {
      const erro = await erroDe(`set role ${papel}; select * from public.agenda_kickoff_sessoes;`);
      await db.exec('reset role;');
      expect(erro).toMatch(/permission denied/);
    }
    await db.exec('set role service_role;');
    const r = await db.query('select meeting_id from public.agenda_kickoff_sessoes');
    await db.exec('reset role;');
    expect(r.rows).toHaveLength(1);
  });

  it('apagar a reunião (Desfazer da criação) leva a marcação junto', async () => {
    await db.exec(`delete from public.meetings where id = '${KICKOFF}'`);
    const r = await db.query(`select 1 from public.agenda_kickoff_sessoes where meeting_id = '${KICKOFF}'`);
    expect(r.rows).toHaveLength(0);
  });
});
