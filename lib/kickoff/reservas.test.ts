// Reservas do kickoff (M2) num Postgres de verdade em memória (PGlite), sem rede e sem
// tocar no banco de produção: migrations reais da agenda, da M1 (001), das reservas
// (003) e da proteção da reunião (004). A concorrência com conexões simultâneas de
// verdade está em reservasConcorrencia.test.ts (precisa de um Postgres descartável).
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';

const ORG = '0c000000-0000-4000-8000-000000000000';
const EMP = Array.from({ length: 9 }, (_, i) => `0e000000-0000-4000-8000-00000000000${i + 1}`);
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const ADMIN = '1a000000-0000-4000-8000-000000000002';
const EQUIPE = '1a000000-0000-4000-8000-000000000003'; // da equipe, sem a permissão
const ESTRANHO = '1a000000-0000-4000-8000-000000000004'; // sem perfil no Meet
const S = {
  a: '2a000000-0000-4000-8000-000000000001',
  b: '2a000000-0000-4000-8000-000000000002',
  c: '2a000000-0000-4000-8000-000000000003',
  passada: '2a000000-0000-4000-8000-000000000004',
  cancelada: '2a000000-0000-4000-8000-000000000005',
  bloqueada: '2a000000-0000-4000-8000-000000000006',
  serie2: '2a000000-0000-4000-8000-000000000007',
};
const COMUM = '2c000000-0000-4000-8000-000000000001';

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

const reservar = (sessao: string, empresa: string, usuario = GESTOR, email: string | null = 'pessoa@empresa.com.br', telefone: string | null = '(11) 98888-7777') =>
  db.query<{ r: { id: string; meeting_id: string; status: string } }>(
    'select public.agenda_kickoff_reservar($1, $2, $3, $4, $5, $6) as r',
    [sessao, empresa, ' Pessoa Principal ', email, telefone, usuario],
  );
const reservaDe = async (empresa: string) =>
  um<{ id: string; meeting_id: string; status: string }>(
    `select id, meeting_id, status from public.agenda_kickoff_reservas where tenant_id = $1 order by criado_em desc limit 1`,
    [empresa],
  );
const ativas = async (sessao: string) =>
  Number((await um<{ n: number }>(`select count(*)::int n from public.agenda_kickoff_reservas where meeting_id = $1 and status = 'ativa'`, [sessao])).n);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec(sqlDoRepo('integracoes/agenda/001_agenda.sql'));
  await db.exec(sqlDoRepo('integracoes/agenda/003_agenda_cliente.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/001_kickoff_m1.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/003_kickoff_reservas.sql'));
  await db.exec(sqlDoRepo('integracoes/kickoff/004_kickoff_reuniao_protegida.sql'));
  await db.exec(`
    insert into auth.users (id) values ('${GESTOR}'), ('${ADMIN}'), ('${EQUIPE}'), ('${ESTRANHO}');
    insert into public.client_tenants (id, name) values ('${ORG}', 'Customer Success'),
      ${EMP.map((e, i) => `('${e}', 'Empresa ${i + 1}')`).join(', ')};
    insert into public.users (id, name, role) values ('${GESTOR}', 'Gestor', 'CUSTOMER_SUCCESS'), ('${ADMIN}', 'Admin', 'ADMIN'),
      ('${EQUIPE}', 'Equipe', 'EXECUTOR'), ('${ESTRANHO}', 'Cliente', 'CLIENT');
    insert into public.meet_user_profile (user_id, is_admin, sector, capacidades) values
      ('${GESTOR}', false, 'executoria', '{kickoff_impulsao.manage}'),
      ('${ADMIN}', true, 'ambos', '{}'),
      ('${EQUIPE}', false, 'executoria', '{}');
    insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, status, room_name) values
      ('${S.a}', '${ORG}', '${GESTOR}', 'Kickoff A', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled', 'k_a'),
      ('${S.b}', '${ORG}', '${GESTOR}', 'Kickoff B', now() + interval '9 days', now() + interval '9 days 1 hour', 'scheduled', 'k_b'),
      ('${S.c}', '${ORG}', '${GESTOR}', 'Kickoff C', now() + interval '16 days', now() + interval '16 days 1 hour', 'scheduled', 'k_c'),
      ('${S.passada}', '${ORG}', '${GESTOR}', 'Kickoff passado', now() - interval '1 day', now() - interval '23 hours', 'scheduled', 'k_p'),
      ('${S.cancelada}', '${ORG}', '${GESTOR}', 'Kickoff cancelado', now() + interval '3 days', now() + interval '3 days 1 hour', 'canceled', 'k_x'),
      ('${S.bloqueada}', '${ORG}', '${GESTOR}', 'Kickoff bloqueado', now() + interval '4 days', now() + interval '4 days 1 hour', 'scheduled', 'k_bl'),
      ('${S.serie2}', '${ORG}', '${GESTOR}', 'Kickoff série', now() + interval '23 days', now() + interval '23 days 1 hour', 'scheduled', 'k_s2'),
      ('${COMUM}', '${EMP[0]}', '${GESTOR}', 'Reunião comum', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'comum');
    insert into public.meet_meeting_sector (meeting_id, sector, onboarding) select id, 'executoria', id <> '${COMUM}' from public.meetings;
    insert into public.agenda_kickoff_sessoes (meeting_id, capacidade, aceita_reservas)
      select id, 5, id <> '${S.bloqueada}' from public.meetings where id <> '${COMUM}';
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('capacidade e uma reserva ativa por empresa', () => {
  it('cinco empresas reservam; a sexta é recusada', async () => {
    for (const e of EMP.slice(0, 5)) await reservar(S.a, e);
    expect(await ativas(S.a)).toBe(5);
    const r = await falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [S.a, EMP[5], 'Pessoa', 'p@x.com.br', GESTOR]);
    expect(r.message).toBe('Sessão lotada: 5 de 5 empresas.');
    expect(r.code).toBe('22023');
  });

  it('normaliza o participante (espaços, e-mail em minúsculas)', async () => {
    await reservar(S.b, EMP[5], GESTOR, '  Fulano@Empresa.COM.br ');
    const r = await um<{ participante_nome: string; participante_email: string }>(
      `select participante_nome, participante_email from public.agenda_kickoff_reservas where tenant_id = $1`,
      [EMP[5]],
    );
    expect(r).toEqual({ participante_nome: 'Pessoa Principal', participante_email: 'fulano@empresa.com.br' });
  });

  it('a mesma empresa não tem duas reservas ativas (nesta ou em outra sessão)', async () => {
    expect((await falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [S.a, EMP[0], 'Pessoa', 'p@x.com.br', GESTOR])).message).toBe(
      'Esta empresa já está inscrita nesta sessão.',
    );
    const outra = await falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [S.c, EMP[0], 'Pessoa', 'p@x.com.br', GESTOR]);
    expect(outra.message).toMatch(/^Esta empresa já tem kickoff marcado em \d{2}\/\d{2} às \d{2}:\d{2}\. Para trocar, remaneje/);
    expect(outra.code).toBe('23505');
  });

  it('escrita direta, fora das funções, também respeita as regras (gatilho e índice)', async () => {
    const ins = (sessao: string, empresa: string) =>
      falha(
        `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ($1, $2, 'Pessoa', 'p@x.com.br')`,
        [sessao, empresa],
      );
    expect((await ins(S.a, EMP[6])).message).toBe('Sessão lotada: 5 de 5 empresas.');
    expect((await ins(S.c, EMP[0])).code).toBe('23505'); // índice único parcial
    expect((await ins(S.c, ORG)).message).toBe('A empresa organizadora dos kickoffs não pode ser inscrita como participante.');
    expect(
      (
        await falha(
          `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email, status, cancelada_em) values ($1, $2, 'Pessoa', 'p@x.com.br', 'cancelada', now())`,
          [S.c, EMP[7]],
        )
      ).message,
    ).toBe('Reserva nova precisa estar ativa, sem presença nem conclusão.');
  });

  it('a empresa organizadora (Customer Success) não pode ser reservada', async () => {
    const r = await falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [S.c, ORG, 'Pessoa', 'p@x.com.br', GESTOR]);
    expect(r.message).toBe('A empresa organizadora dos kickoffs não pode ser inscrita como participante.');
  });

  it('sessões passadas, canceladas ou bloqueadas, e empresa inexistente, recusam', async () => {
    const tentar = (s: string, e = EMP[7]) =>
      falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [s, e, 'Pessoa', 'p@x.com.br', GESTOR]);
    expect((await tentar(S.passada)).message).toBe('Sessão indisponível: ela já começou ou já passou.');
    expect((await tentar(S.cancelada)).message).toBe('Sessão indisponível: ela foi cancelada.');
    expect((await tentar(S.bloqueada)).message).toBe('Sessão indisponível: ela está bloqueada para novas reservas.');
    expect((await tentar(COMUM)).message).toBe('Sessão de kickoff não encontrada.');
    expect((await tentar(S.c, '0f000000-0000-4000-8000-000000000000')).code).toBe('P0002');
  });
});

describe('participante principal: validado no banco', () => {
  it('e-mail é obrigatório e validado pela função', async () => {
    const f = (email: string | null, tel: string | null = null) =>
      falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, $5, $6)', [S.c, EMP[7], 'Pessoa', email, tel, GESTOR]);
    expect((await f(null)).message).toBe('Informe o e-mail do participante principal.');
    expect((await f('   ')).message).toBe('Informe o e-mail do participante principal.');
    expect((await f('sem-arroba')).message).toBe('E-mail do participante inválido.');
    expect((await f('a@b')).message).toBe('E-mail do participante inválido.');
    expect((await f('ok@empresa.com.br', '123')).message).toBe('Telefone/WhatsApp do participante inválido (8 a 15 dígitos).');
    expect(
      (await falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [S.c, EMP[7], 'P', 'ok@x.com.br', GESTOR])).message,
    ).toBe('Informe o nome do participante principal (2 a 200 caracteres).');
  });

  it('e-mail é obrigatório e validado pela própria tabela (escrita direta)', async () => {
    const ins = (email: string | null) =>
      falha(
        `insert into public.agenda_kickoff_reservas (meeting_id, tenant_id, participante_nome, participante_email) values ($1, $2, 'Pessoa', $3)`,
        [S.c, EMP[7], email],
      );
    expect((await ins(null)).code).toBe('23502'); // not null
    expect((await ins('invalido')).code).toBe('23514'); // check
    expect((await ins('Maiusculo@x.com.br')).code).toBe('23514'); // precisa vir normalizado
    expect(await ativas(S.c)).toBe(0);
  });
});

describe('cancelar e remanejar', () => {
  it('cancelar libera a vaga e a empresa', async () => {
    const r = await reservaDe(EMP[4]);
    await db.query('select public.agenda_kickoff_cancelar_reserva($1, $2, $3)', [r.id, 'Pediu para sair', GESTOR]);
    expect(await ativas(S.a)).toBe(4);
    await reservar(S.a, EMP[6]); // a vaga liberada
    expect(await ativas(S.a)).toBe(5);
    await reservar(S.c, EMP[4]); // a empresa pode reservar de novo
    expect((await falha('select public.agenda_kickoff_cancelar_reserva($1, null, $2)', [r.id, GESTOR])).message).toBe(
      'Esta reserva já está cancelada.',
    );
  });

  it('reserva cancelada não volta nem muda', async () => {
    const r = await um<{ id: string }>(`select id from public.agenda_kickoff_reservas where status = 'cancelada' limit 1`);
    expect((await falha(`update public.agenda_kickoff_reservas set status = 'ativa', cancelada_em = null where id = $1`, [r.id])).message).toBe(
      'Reserva cancelada não pode ser alterada.',
    );
  });

  it('remanejar mantém o id, muda a sessão e grava o histórico', async () => {
    const antes = await reservaDe(EMP[0]);
    const r = await um<{ r: { id: string; meeting_id: string } }>('select public.agenda_kickoff_remanejar($1, $2, $3, $4) as r', [
      antes.id,
      S.b,
      'Conflito de agenda',
      GESTOR,
    ]);
    expect(r.r.id).toBe(antes.id);
    expect(r.r.meeting_id).toBe(S.b);
    expect(await ativas(S.a)).toBe(4);
    expect(await ativas(S.b)).toBe(2);
    const h = await um<{ acao: string; sessao_de: string; sessao_para: string; motivo: string; usuario_id: string }>(
      `select acao, sessao_de, sessao_para, motivo, usuario_id from public.agenda_kickoff_reservas_historico where reserva_id = $1 and acao = 'remanejada'`,
      [antes.id],
    );
    expect(h).toEqual({ acao: 'remanejada', sessao_de: S.a, sessao_para: S.b, motivo: 'Conflito de agenda', usuario_id: GESTOR });
  });

  it('o destino passa pelas mesmas regras (lotada, passada, mesma sessão)', async () => {
    const r = await reservaDe(EMP[1]);
    await db.query('update public.agenda_kickoff_sessoes set capacidade = 2 where meeting_id = $1', [S.b]);
    expect((await falha('select public.agenda_kickoff_remanejar($1, $2, null, $3)', [r.id, S.b, GESTOR])).message).toBe(
      'Sessão lotada: 2 de 2 empresas.',
    );
    expect((await falha('select public.agenda_kickoff_remanejar($1, $2, null, $3)', [r.id, S.passada, GESTOR])).message).toBe(
      'Sessão indisponível: ela já começou ou já passou.',
    );
    expect((await falha('select public.agenda_kickoff_remanejar($1, $2, null, $3)', [r.id, S.a, GESTOR])).message).toBe(
      'A empresa já está nesta sessão.',
    );
    await db.query('update public.agenda_kickoff_sessoes set capacidade = 5 where meeting_id = $1', [S.b]);
    expect((await reservaDe(EMP[1])).meeting_id).toBe(S.a); // nada mudou
  });

  it('atualizar o participante grava antes e depois; sem mudança, não grava', async () => {
    const r = await reservaDe(EMP[2]);
    const conta = async () =>
      Number(
        (
          await um<{ n: number }>(
            `select count(*)::int n from public.agenda_kickoff_reservas_historico where reserva_id = $1 and acao = 'participante_alterado'`,
            [r.id],
          )
        ).n,
      );
    await db.query('select public.agenda_kickoff_atualizar_participante($1, $2, $3, $4, $5)', [r.id, 'Pessoa Principal', 'pessoa@empresa.com.br', '(11) 98888-7777', GESTOR]);
    expect(await conta()).toBe(0);
    await db.query('select public.agenda_kickoff_atualizar_participante($1, $2, $3, $4, $5)', [r.id, 'Outra Pessoa', 'OUTRA@empresa.com.br', null, GESTOR]);
    expect(await conta()).toBe(1);
    const h = await um<{ dados: { antes: Record<string, string | null>; depois: Record<string, string | null> } }>(
      `select dados from public.agenda_kickoff_reservas_historico where reserva_id = $1 and acao = 'participante_alterado'`,
      [r.id],
    );
    expect(h.dados.antes).toEqual({ nome: 'Pessoa Principal', email: 'pessoa@empresa.com.br', telefone: '(11) 98888-7777' });
    expect(h.dados.depois).toEqual({ nome: 'Outra Pessoa', email: 'outra@empresa.com.br', telefone: null });
  });

  it('o histórico conta a vida da reserva e não pode ser alterado; reserva não se apaga', async () => {
    const r = await reservaDe(EMP[0]);
    const acoes = (await db.query<{ acao: string }>(`select acao from public.agenda_kickoff_reservas_historico where reserva_id = $1 order by id`, [r.id])).rows.map(
      (x) => x.acao,
    );
    expect(acoes).toEqual(['criada', 'remanejada']);
    expect((await falha('update public.agenda_kickoff_reservas_historico set motivo = $1', ['x'])).code).toBe('42501');
    expect((await falha('delete from public.agenda_kickoff_reservas_historico')).code).toBe('42501');
    expect((await falha('truncate public.agenda_kickoff_reservas_historico cascade')).code).toBe('42501');
    expect((await falha('delete from public.agenda_kickoff_reservas where id = $1', [r.id])).message).toBe(
      'Reservas de kickoff não se apagam: cancele a reserva.',
    );
    expect((await falha(`update public.agenda_kickoff_reservas set tenant_id = $1 where id = $2`, [EMP[8], r.id])).code).toBe('42501');
  });
});

describe('capacidade da sessão', () => {
  it('não fica abaixo das empresas inscritas (função e escrita direta)', async () => {
    expect(await ativas(S.a)).toBe(4);
    expect((await falha('select public.agenda_kickoff_configurar_sessao($1, 3, null, $2)', [S.a, GESTOR])).message).toBe(
      'Esta sessão tem 4 empresa(s) inscrita(s): a capacidade não pode ficar abaixo disso.',
    );
    expect((await falha('update public.agenda_kickoff_sessoes set capacidade = 1 where meeting_id = $1', [S.a])).code).toBe('22023');
    await db.query('select public.agenda_kickoff_configurar_sessao($1, 4, null, $2)', [S.a, GESTOR]);
    expect((await falha('select public.agenda_kickoff_configurar_sessao($1, 51, null, $2)', [S.a, GESTOR])).message).toBe(
      'A capacidade deve ser de 1 a 50 empresas.',
    );
    await db.query('select public.agenda_kickoff_configurar_sessao($1, 5, null, $2)', [S.a, GESTOR]);
  });

  it('bloquear a sessão impede novas reservas e mantém as que existem', async () => {
    await db.query('select public.agenda_kickoff_configurar_sessao($1, null, false, $2)', [S.a, GESTOR]);
    expect((await falha('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [S.a, EMP[7], 'Pessoa', 'p@x.com.br', GESTOR])).message).toBe(
      'Sessão indisponível: ela está bloqueada para novas reservas.',
    );
    expect(await ativas(S.a)).toBe(4);
    await db.query('select public.agenda_kickoff_configurar_sessao($1, null, true, $2)', [S.a, GESTOR]);
  });
});

describe('autorização no banco', () => {
  it('quem não gerencia kickoffs não reserva, não cancela, não remaneja, não configura', async () => {
    const r = await reservaDe(EMP[2]);
    for (const usuario of [EQUIPE, ESTRANHO, null]) {
      const chamadas: Array<[string, unknown[]]> = [
        ['select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5)', [S.c, EMP[7], 'Pessoa', 'p@x.com.br', usuario]],
        ['select public.agenda_kickoff_cancelar_reserva($1, null, $2)', [r.id, usuario]],
        ['select public.agenda_kickoff_remanejar($1, $2, null, $3)', [r.id, S.c, usuario]],
        ['select public.agenda_kickoff_atualizar_participante($1, $2, $3, null, $4)', [r.id, 'Nome', 'n@x.com.br', usuario]],
        ['select public.agenda_kickoff_configurar_sessao($1, 10, null, $2)', [S.c, usuario]],
        ['select public.agenda_kickoff_cancelar_sessoes($1, true, null, null, $2)', [[S.c], usuario]],
        ['select public.agenda_kickoff_remarcar_sessoes($1, $2)', [JSON.stringify([{ id: S.c, inicio: '2030-01-01T10:00:00Z', fim: '2030-01-01T11:00:00Z' }]), usuario]],
      ];
      for (const [sql, params] of chamadas) expect((await falha(sql, params)).code).toBe('42501');
    }
    expect((await reservaDe(EMP[2])).status).toBe('ativa');
  });

  it('o admin do Meet gerencia mesmo sem a permissão no perfil', async () => {
    await reservar(S.c, EMP[7], ADMIN);
    expect(await ativas(S.c)).toBe(2);
  });

  it('anon e authenticated não leem as tabelas nem chamam as funções; service_role chama', async () => {
    for (const papel of ['anon', 'authenticated']) {
      await db.exec(`set role ${papel}`);
      try {
        expect((await falha('select * from public.agenda_kickoff_reservas')).code).toBe('42501');
        expect((await falha('select * from public.agenda_kickoff_reservas_historico')).code).toBe('42501');
        expect((await falha('select public.agenda_kickoff_cancelar_reserva(gen_random_uuid(), null, $1)', [GESTOR])).code).toBe('42501');
      } finally {
        await db.exec('reset role');
      }
    }
    await db.exec('set role service_role');
    try {
      const r = await reservaDe(EMP[7]).catch(() => null);
      expect(r).toBeTruthy();
      await db.query('select public.agenda_kickoff_atualizar_participante($1, $2, $3, null, $4)', [r!.id, 'Pelo Servidor', 'srv@x.com.br', GESTOR]);
    } finally {
      await db.exec('reset role');
    }
  });
});

describe('sessões com reservas e reuniões comuns', () => {
  it('reuniões comuns continuam mudando de horário e estado normalmente', async () => {
    await db.query(`update public.meetings set scheduled_start_at = scheduled_start_at + interval '1 hour', scheduled_end_at = scheduled_end_at + interval '1 hour' where id = $1`, [COMUM]);
    await db.query(`update public.meetings set status = 'canceled' where id = $1`, [COMUM]);
    expect((await um<{ status: string }>('select status::text from public.meetings where id = $1', [COMUM])).status).toBe('canceled');
  });

  it('sessão sem reservas muda de horário (pela função ou direto); com reserva, não', async () => {
    const vazia = S.serie2;
    await db.query('select public.agenda_kickoff_remarcar_sessoes($1, $2)', [
      JSON.stringify([{ id: vazia, inicio: '2030-01-10T13:00:00Z', fim: '2030-01-10T14:00:00Z', titulo: 'Kickoff movido' }]),
      GESTOR,
    ]);
    expect((await um<{ title: string }>('select title from public.meetings where id = $1', [vazia])).title).toBe('Kickoff movido');
    await db.query(`update public.meetings set scheduled_start_at = scheduled_start_at + interval '1 hour', scheduled_end_at = scheduled_end_at + interval '1 hour' where id = $1`, [vazia]);

    const r = await falha('select public.agenda_kickoff_remarcar_sessoes($1, $2)', [
      JSON.stringify([{ id: S.c, inicio: '2030-02-10T13:00:00Z', fim: '2030-02-10T14:00:00Z' }]),
      GESTOR,
    ]);
    expect(r.message).toMatch(/^A sessão de .+ tem 2 empresa\(s\) inscrita\(s\)\. Remaneje ou cancele as reservas antes de mudar o horário\.$/);
    // Só o título: pode.
    const c = await um<{ scheduled_start_at: string; scheduled_end_at: string }>('select scheduled_start_at, scheduled_end_at from public.meetings where id = $1', [S.c]);
    await db.query('select public.agenda_kickoff_remarcar_sessoes($1, $2)', [
      JSON.stringify([{ id: S.c, inicio: c.scheduled_start_at, fim: c.scheduled_end_at, titulo: 'Kickoff C renomeado' }]),
      GESTOR,
    ]);
    expect((await um<{ title: string }>('select title from public.meetings where id = $1', [S.c])).title).toBe('Kickoff C renomeado');
  });

  it('com reserva ativa, a reunião não muda nem se apaga por escrita direta (004 e chave estrangeira)', async () => {
    const msg = /^Esta sessão de kickoff tem 2 empresa\(s\) inscrita\(s\)/;
    expect((await falha(`update public.meetings set scheduled_start_at = scheduled_start_at + interval '1 day' where id = $1`, [S.c])).message).toMatch(msg);
    expect((await falha(`update public.meetings set status = 'canceled' where id = $1`, [S.c])).message).toMatch(msg);
    expect((await falha(`update public.meetings set tenant_id = $1 where id = $2`, [EMP[0], S.c])).message).toMatch(msg);
    expect((await falha('delete from public.meetings where id = $1', [S.c])).code).toBe('23001'); // restrict_violation
    // Título pela escrita direta não é barrado (não afeta a reserva).
    await db.query(`update public.meetings set title = 'Kickoff C' where id = $1`, [S.c]);
  });

  it('cancelar sessão com reservas: recusa sem decisão explícita; com ela, cancela tudo junto', async () => {
    expect((await falha('select public.agenda_kickoff_cancelar_sessoes($1, false, null, $2, $3)', [[S.c], 'legacy', GESTOR])).message).toMatch(
      /tem 2 empresa\(s\) inscrita\(s\)\. Remaneje ou cancele as reservas antes, ou cancele a sessão junto com as reservas/,
    );
    expect((await um<{ status: string }>('select status::text from public.meetings where id = $1', [S.c])).status).toBe('scheduled');

    const r = await um<{ r: { sessoes: string[]; reservasCanceladas: number } }>(
      'select public.agenda_kickoff_cancelar_sessoes($1, true, $2, $3, $4) as r',
      [[S.c], 'Feriado', 'legacy', GESTOR],
    );
    expect(r.r).toEqual({ sessoes: [S.c], reservasCanceladas: 2 });
    expect((await um<{ status: string }>('select status::text from public.meetings where id = $1', [S.c])).status).toBe('canceled');
    expect(await ativas(S.c)).toBe(0);
    const motivos = (
      await db.query<{ motivo: string }>(
        `select h.motivo from public.agenda_kickoff_reservas_historico h join public.agenda_kickoff_reservas r on r.id = h.reserva_id where r.meeting_id = $1 and h.acao = 'cancelada'`,
        [S.c],
      )
    ).rows.map((x) => x.motivo);
    expect(motivos).toEqual(['Sessão cancelada: Feriado', 'Sessão cancelada: Feriado']);
    expect(Number((await um<{ n: number }>('select count(*)::int n from public.agenda_cancelamentos where meeting_id = $1', [S.c])).n)).toBe(1);
    // As empresas ficam livres para outra sessão.
    await reservar(S.b, EMP[7]);
  });

  it('sessão sem reservas cancela normalmente (série inteira, pela função)', async () => {
    const r = await um<{ r: { sessoes: string[]; reservasCanceladas: number } }>(
      'select public.agenda_kickoff_cancelar_sessoes($1, false, null, $2, $3) as r',
      [[S.serie2, S.bloqueada], 'executor', GESTOR],
    );
    expect(r.r.sessoes.sort()).toEqual([S.bloqueada, S.serie2].sort());
    expect(r.r.reservasCanceladas).toBe(0);
  });
});
