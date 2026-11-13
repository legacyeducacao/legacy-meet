// Sala Zoom dos kickoffs (Zoom E1) no banco: migration 006 num Postgres em memória
// (PGlite), sobre as migrations reais da agenda e do kickoff (001, 003, 004, 005).
// O Zoom não entra aqui: o banco só recebe o resultado da verificação.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

const ORG = '0c000000-0000-4000-8000-000000000000';
const EMPRESA = '0e000000-0000-4000-8000-000000000001';
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const ADMIN = '1a000000-0000-4000-8000-000000000002';
const EQUIPE = '1a000000-0000-4000-8000-000000000003';
const KICKOFF = '2a000000-0000-4000-8000-000000000001';
const COMUM = '2c000000-0000-4000-8000-000000000001';
const SALA_A = '81234567890';
const SALA_B = '81234567891';
const SALA_DO_PLAN = '81234567899';
const RESUMO = { tipo: 8, aprovacao: 0, inscricao: 1, ocorrenciasFuturas: 10 };

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
const um = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

const ATIVAR = 'select public.agenda_kickoff_zoom_sala_ativar($1, $2, $3, $4, $5, $6) as r';
type Ativada = { acao: string; sala_id: string; zoom_meeting_id: string; anterior: string | null };

/** Fotografia das tabelas que a E1 não pode tocar. */
const foto = async () =>
  (
    await um<{ m: string; r: string; s: string; t: string }>(`select
      (select md5(string_agg(t::text, '|' order by t::text)) from public.meetings t) as m,
      (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.agenda_kickoff_reservas t) as r,
      (select md5(string_agg(t::text, '|' order by t::text)) from public.agenda_kickoff_sessoes t) as s,
      (select md5(string_agg(t::text, '|' order by t::text)) from public.client_tenants t) as t`)
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec('alter table public.users add column avatar_url text');
  // Mínimo das tabelas de turmas do Plan que a 006 consulta (só leitura).
  await db.exec(`
    create table public.cohort_schedules (id uuid primary key default gen_random_uuid(), zoom_meeting_id text);
    create table public.cohort_sessions (id uuid primary key default gen_random_uuid(), zoom_meeting_id text);
    create table public.cohort_zoom_meeting_checks (id uuid primary key default gen_random_uuid(), zoom_meeting_id text);
  `);
  for (const m of [
    'integracoes/agenda/001_agenda.sql',
    'integracoes/agenda/003_agenda_cliente.sql',
    'integracoes/kickoff/001_kickoff_m1.sql',
    'integracoes/kickoff/003_kickoff_reservas.sql',
    'integracoes/kickoff/004_kickoff_reuniao_protegida.sql',
    'integracoes/kickoff/005_kickoff_convites.sql',
    'integracoes/kickoff/006_kickoff_zoom_sala.sql',
  ]) {
    await db.exec(sqlDoRepo(m));
  }
  await db.exec(`
    insert into public.client_tenants (id, name) values ('${ORG}', 'Customer Success'), ('${EMPRESA}', 'Padaria');
    insert into public.users (id, name, role) values ('${GESTOR}', 'Gestor', 'CUSTOMER_SUCCESS');
    insert into public.meet_user_profile (user_id, is_admin, sector, capacidades) values
      ('${GESTOR}', false, 'executoria', '{kickoff_impulsao.manage}'),
      ('${ADMIN}', true, 'executoria', '{}'),
      ('${EQUIPE}', false, 'executoria', '{}');
    insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, status, room_name) values
      ('${KICKOFF}', '${ORG}', '${GESTOR}', 'Kickoff', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled', 'k1'),
      ('${COMUM}', '${EMPRESA}', '${GESTOR}', 'Reunião comum', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'c1');
    insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values ('${KICKOFF}', 'executoria', true), ('${COMUM}', 'executoria', false);
    insert into public.agenda_kickoff_sessoes (meeting_id, capacidade, aceita_reservas) values ('${KICKOFF}', 5, true);
    -- Turma do Plan usando uma reunião (o Plan guarda só dígitos; aqui com espaços, de propósito).
    insert into public.cohort_sessions (zoom_meeting_id) values ('812 3456 7899');
  `);
  await db.query(
    `select public.agenda_kickoff_reservar($1, $2, 'Maria', 'maria@padaria.com.br', null, $3)`,
    [KICKOFF, EMPRESA, GESTOR],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const ativas = async () => (await db.query<{ zoom_meeting_id: string }>('select zoom_meeting_id from public.agenda_kickoff_zoom_salas where ativa')).rows.map((r) => r.zoom_meeting_id);
const historico = async () =>
  (
    await db.query<{ acao: string; zoom_meeting_id: string; motivo: string | null; usuario: string | null }>(
      `select h.acao, s.zoom_meeting_id, h.motivo, h.usuario from public.agenda_kickoff_zoom_salas_historico h
         join public.agenda_kickoff_zoom_salas s on s.id = h.sala_id order by h.id`,
    )
  ).rows;

describe('sala Zoom: ativar e trocar', () => {
  let antes: Awaited<ReturnType<typeof foto>>;
  beforeAll(async () => {
    antes = await foto();
  });

  it('quem não gerencia kickoffs não ativa (nem sem usuário)', async () => {
    expect((await falha(ATIVAR, [SALA_A, 't', '{}', new Date().toISOString(), null, EQUIPE])).code).toBe('42501');
    expect((await falha(ATIVAR, [SALA_A, 't', '{}', new Date().toISOString(), null, null])).code).toBe('42501');
    expect(await ativas()).toEqual([]);
  });

  it('Meeting ID fora do formato e verificação velha ou no futuro são recusados', async () => {
    for (const id of ['1234', 'abc12345678', '8123 4567 890', '']) {
      expect((await falha(ATIVAR, [id, 't', '{}', new Date().toISOString(), null, GESTOR])).code).toBe('22023');
    }
    const velha = await falha(ATIVAR, [SALA_A, 't', '{}', new Date(Date.now() - 3 * 3600_000).toISOString(), null, GESTOR]);
    expect(velha).toMatchObject({ code: '22023', message: expect.stringMatching(/últimas 2 horas/) });
    expect((await falha(ATIVAR, [SALA_A, 't', '{}', new Date(Date.now() + 3600_000).toISOString(), null, GESTOR])).code).toBe('22023');
    expect(await ativas()).toEqual([]);
  });

  it('sala de turma do Plan nunca é aceita (pela função e por escrita direta)', async () => {
    expect((await um<{ r: boolean }>('select public.agenda_kickoff_zoom_sala_usada_no_plan($1) as r', [SALA_DO_PLAN])).r).toBe(true);
    expect((await um<{ r: boolean }>('select public.agenda_kickoff_zoom_sala_usada_no_plan($1) as r', [SALA_A])).r).toBe(false);
    const e = await falha(ATIVAR, [SALA_DO_PLAN, 't', '{}', new Date().toISOString(), null, GESTOR]);
    expect(e).toMatchObject({ code: '22023', message: expect.stringMatching(/turma do Legacy Plan/) });
    const direto = await falha(
      `insert into public.agenda_kickoff_zoom_salas (zoom_meeting_id, verificacao_ok, verificada_em) values ($1, true, now())`,
      [SALA_DO_PLAN],
    );
    expect(direto.code).toBe('22023');
  });

  it('primeira ativação cria a sala ativa e registra no histórico', async () => {
    const r = await um<{ r: Ativada }>(ATIVAR, [SALA_A, ' Kickoff Impulsão ', JSON.stringify(RESUMO), new Date().toISOString(), null, GESTOR]);
    expect(r.r).toMatchObject({ acao: 'ativada', zoom_meeting_id: SALA_A, anterior: null });
    expect(await ativas()).toEqual([SALA_A]);
    const s = await um<{ topico: string; verificacao_ok: boolean; verificacao_resumo: unknown; ativada_por: string }>(
      'select topico, verificacao_ok, verificacao_resumo, ativada_por from public.agenda_kickoff_zoom_salas where zoom_meeting_id = $1',
      [SALA_A],
    );
    expect(s).toEqual({ topico: 'Kickoff Impulsão', verificacao_ok: true, verificacao_resumo: RESUMO, ativada_por: GESTOR });
    expect(await historico()).toEqual([{ acao: 'ativada', zoom_meeting_id: SALA_A, motivo: null, usuario: GESTOR }]);
  });

  it('ativar a própria sala ativa só registra a verificação (admin também pode)', async () => {
    const r = await um<{ r: Ativada }>(ATIVAR, [SALA_A, 'Kickoff', '{}', new Date().toISOString(), null, ADMIN]);
    expect(r.r).toMatchObject({ acao: 'verificada', anterior: null });
    expect(await ativas()).toEqual([SALA_A]);
    expect((await historico()).slice(-1)[0]).toMatchObject({ acao: 'verificada', usuario: ADMIN });
  });

  it('trocar exige motivo; a anterior fica desativada no histórico, com o motivo', async () => {
    const sem = await falha(ATIVAR, [SALA_B, 't', '{}', new Date().toISOString(), '  ', GESTOR]);
    expect(sem).toMatchObject({ code: '22023', message: 'Informe o motivo da troca de sala.' });
    expect(await ativas()).toEqual([SALA_A]);

    const r = await um<{ r: Ativada }>(ATIVAR, [SALA_B, 'Kickoff 2027', '{}', new Date().toISOString(), 'Última ocorrência chegando', GESTOR]);
    expect(r.r).toMatchObject({ acao: 'ativada', zoom_meeting_id: SALA_B, anterior: SALA_A });
    expect(await ativas()).toEqual([SALA_B]);
    const a = await um<{ ativa: boolean; desativada_por: string; motivo_desativacao: string }>(
      'select ativa, desativada_por, motivo_desativacao from public.agenda_kickoff_zoom_salas where zoom_meeting_id = $1',
      [SALA_A],
    );
    expect(a).toEqual({ ativa: false, desativada_por: GESTOR, motivo_desativacao: 'Última ocorrência chegando' });
    expect((await historico()).slice(-2)).toEqual([
      { acao: 'desativada', zoom_meeting_id: SALA_A, motivo: 'Última ocorrência chegando', usuario: GESTOR },
      { acao: 'ativada', zoom_meeting_id: SALA_B, motivo: 'Última ocorrência chegando', usuario: GESTOR },
    ]);
  });

  it('voltar para uma sala antiga reativa a MESMA linha (vínculos preservados)', async () => {
    const id = (await um<{ id: string }>('select id from public.agenda_kickoff_zoom_salas where zoom_meeting_id = $1', [SALA_A])).id;
    const r = await um<{ r: Ativada }>(ATIVAR, [SALA_A, null, '{}', new Date().toISOString(), 'Voltando', GESTOR]);
    expect(r.r).toMatchObject({ acao: 'reativada', sala_id: id, anterior: SALA_B });
    expect(await ativas()).toEqual([SALA_A]);
    expect((await um<{ n: number }>('select count(*)::int as n from public.agenda_kickoff_zoom_salas')).n).toBe(2);
    // Título anterior mantido quando o novo vem vazio.
    expect((await um<{ topico: string }>('select topico from public.agenda_kickoff_zoom_salas where id = $1', [id])).topico).toBe('Kickoff');
  });

  it('nunca duas ativas, nem por escrita direta; reativar direto também exige verificação recente', async () => {
    expect(
      (await falha(`insert into public.agenda_kickoff_zoom_salas (zoom_meeting_id, verificacao_ok, verificada_em) values ('81234567892', true, now())`)).code,
    ).toBe('23505');
    await db.query(`update public.agenda_kickoff_zoom_salas set ativa = false, desativada_em = now() where ativa`);
    await db.exec(`set session_replication_role = replica;
      update public.agenda_kickoff_zoom_salas set verificada_em = now() - interval '3 hours' where zoom_meeting_id = '${SALA_B}';
      set session_replication_role = default;`);
    expect((await falha(`update public.agenda_kickoff_zoom_salas set ativa = true, desativada_em = null where zoom_meeting_id = $1`, [SALA_B])).code).toBe('22023');
    // Volta ao estado normal pela função.
    await um(ATIVAR, [SALA_A, null, '{}', new Date().toISOString(), null, GESTOR]);
    expect(await ativas()).toEqual([SALA_A]);
  });

  it('Meeting ID não muda; sala e histórico não se apagam; histórico não muda', async () => {
    expect((await falha(`update public.agenda_kickoff_zoom_salas set zoom_meeting_id = '81234567893' where zoom_meeting_id = $1`, [SALA_A])).code).toBe('42501');
    expect((await falha('delete from public.agenda_kickoff_zoom_salas')).code).toBe('42501');
    expect((await falha('truncate public.agenda_kickoff_zoom_salas cascade')).code).toBe('42501');
    expect((await falha(`update public.agenda_kickoff_zoom_salas_historico set motivo = 'x'`)).code).toBe('42501');
    expect((await falha('delete from public.agenda_kickoff_zoom_salas_historico')).code).toBe('42501');
    expect((await falha('truncate public.agenda_kickoff_zoom_salas_historico')).code).toBe('42501');
  });

  it('nada disso toca em reuniões, sessões, reservas ou empresas', async () => {
    expect(await foto()).toEqual(antes);
  });
});

describe('sala Zoom: registrar verificação', () => {
  const REG = 'select public.agenda_kickoff_zoom_sala_registrar_verificacao($1, $2, $3, $4, $5, now(), $6) as r';
  const salaAtiva = async () => (await um<{ id: string }>('select id from public.agenda_kickoff_zoom_salas where ativa')).id;

  it('reprovada: a sala continua ativa, com os problemas guardados; a tela decide', async () => {
    const id = await salaAtiva();
    const problemas = [{ codigo: 'aprovacao_manual', titulo: 'A inscrição está com aprovação manual.', orientacao: '...' }];
    await um(REG, [id, false, JSON.stringify(problemas), null, null, GESTOR]);
    const s = await um<{ ativa: boolean; verificacao_ok: boolean; verificacao_problemas: unknown; topico: string }>(
      'select ativa, verificacao_ok, verificacao_problemas, topico from public.agenda_kickoff_zoom_salas where id = $1',
      [id],
    );
    expect(s).toEqual({ ativa: true, verificacao_ok: false, verificacao_problemas: problemas, topico: 'Kickoff' });
    expect((await historico()).slice(-1)[0]).toMatchObject({ acao: 'verificada', usuario: GESTOR });
    await um(REG, [id, true, '[]', 'Kickoff Impulsão', JSON.stringify(RESUMO), GESTOR]);
    expect((await um<{ ok: boolean }>('select verificacao_ok as ok from public.agenda_kickoff_zoom_salas where id = $1', [id])).ok).toBe(true);
  });

  it('sem permissão, sala inexistente ou resultado ausente: recusado', async () => {
    const id = await salaAtiva();
    expect((await falha(REG, [id, true, '[]', null, null, EQUIPE])).code).toBe('42501');
    expect((await falha(REG, ['9a000000-0000-4000-8000-000000000000', true, '[]', null, null, GESTOR])).code).toBe('P0002');
    expect((await falha(REG, [id, null, '[]', null, null, GESTOR])).code).toBe('22023');
    expect((await falha(REG, [id, true, '{"a":1}', null, null, GESTOR])).code).toBe('23514');
  });
});

describe('acesso', () => {
  it('anon e authenticated não leem as salas nem chamam as funções; service_role sim', async () => {
    for (const papel of ['anon', 'authenticated']) {
      await db.exec(`set role ${papel}`);
      try {
        expect((await falha('select * from public.agenda_kickoff_zoom_salas')).code).toBe('42501');
        expect((await falha('select * from public.agenda_kickoff_zoom_salas_historico')).code).toBe('42501');
        expect((await falha('select public.agenda_kickoff_zoom_sala_usada_no_plan($1)', [SALA_A])).code).toBe('42501');
        expect((await falha(ATIVAR, [SALA_B, 't', '{}', new Date().toISOString(), 'x', GESTOR])).code).toBe('42501');
        expect((await falha('select public.agenda_kickoff_zoom_sala_registrar_verificacao(null, true, null, null, null, now(), $1)', [GESTOR])).code).toBe('42501');
      } finally {
        await db.exec('reset role');
      }
    }
    await db.exec('set role service_role');
    try {
      expect((await db.query('select zoom_meeting_id from public.agenda_kickoff_zoom_salas where ativa')).rows).toHaveLength(1);
    } finally {
      await db.exec('reset role');
    }
  });
});
