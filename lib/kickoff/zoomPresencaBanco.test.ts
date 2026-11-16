// Presença pelo Zoom (E3): migration 008 num Postgres em memória (PGlite), sobre as
// migrations reais (001 a 007), com a orquestração de verdade (sincronizarPresenca)
// e um Zoom FALSO que só responde às leituras de relatório. Nenhuma chamada externa.
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ZoomMeetingReport, ZoomPastInstance, ZoomReportParticipant } from '@/lib/zoom/api';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';
import { sincronizarPresenca, type ChamarBanco } from './zoomPresencaServidor';

const ORG = '0c000000-0000-4000-8000-000000000000';
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const EQUIPE = '1a000000-0000-4000-8000-000000000003';
const SALA = '81234567890';
const RESUMO = { tipo: 8, aprovacao: 0, inscricao: 1 };

let db: PGlite;
const um = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const semGatilhos = (sql: string) => db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = default;`);

class ErroPg extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const chamar: ChamarBanco = async (fn, args) => {
  const chaves = Object.keys(args);
  try {
    const r = await db.query<{ r: unknown }>(
      `select public.${fn}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`,
      chaves.map((k) => {
        const v = args[k];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      }),
    );
    return r.rows[0].r;
  } catch (e) {
    throw new ErroPg((e as { code?: string }).code ?? '', (e as Error).message);
  }
};

// --- Zoom falso (só leitura de relatórios) ----------------------------------
let zoom: {
  chamadas: string[];
  execucoes: Array<ZoomPastInstance & { fim: string | null; participantes: ZoomReportParticipant[] }>;
  listPastInstances(id: string): Promise<ZoomPastInstance[]>;
  getMeetingReport(uuid: string): Promise<ZoomMeetingReport>;
  listReportParticipants(uuid: string): Promise<ZoomReportParticipant[]>;
};
function novoZoom() {
  zoom = {
    chamadas: [],
    execucoes: [],
    async listPastInstances(id) {
      zoom.chamadas.push(`instancias ${id}`);
      return id === SALA ? zoom.execucoes.map(({ uuid, start_time }) => ({ uuid, start_time })) : [];
    },
    async getMeetingReport(uuid) {
      zoom.chamadas.push(`relatorio ${uuid}`);
      const e = zoom.execucoes.find((x) => x.uuid === uuid)!;
      return { start_time: e.start_time, end_time: e.fim ?? undefined, user_email: 'equipe@legacy.com' };
    },
    async listReportParticipants(uuid) {
      zoom.chamadas.push(`participantes ${uuid}`);
      return zoom.execucoes.find((x) => x.uuid === uuid)!.participantes;
    },
  };
}
const sincronizar = (sessao: string, usuario = GESTOR) => sincronizarPresenca(usuario, sessao, { zoom, chamar });

// --- Cenário ----------------------------------------------------------------
let n = 0;
const iso = (d: Date) => d.toISOString();
async function novaSessao(): Promise<string> {
  n += 1;
  const id = `2a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  await db.exec(`
    insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, status, room_name)
      values ('${id}', '${ORG}', '${GESTOR}', 'Kickoff', now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled', 'k${n}');
    insert into public.meet_meeting_sector (meeting_id, sector, onboarding) values ('${id}', 'executoria', true);
    insert into public.agenda_kickoff_sessoes (meeting_id, capacidade, aceita_reservas) values ('${id}', 5, true);
  `);
  return id;
}
async function novaEmpresa(nome: string): Promise<string> {
  n += 1;
  const id = `${(0xa0000000 + n).toString(16)}-0000-4000-8000-000000000001`;
  await db.query('insert into public.client_tenants (id, name) values ($1, $2)', [id, nome]);
  return id;
}
/** Só a reserva, sem inscrição Zoom (como uma reserva feita pela equipe sem "Gerar acesso Zoom"). */
async function soReservar(sessao: string, nome: string) {
  const empresa = await novaEmpresa(nome);
  const email = `contato${n}@empresa.com.br`;
  const reserva = (await um<{ r: { id: string } }>('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5) as r', [sessao, empresa, 'Maria', email, GESTOR])).r.id;
  return { empresa, reserva, email };
}
/** Reserva + inscrição Zoom pronta (como a E2 deixa), com o registrant_id dado. */
async function inscrever(sessao: string, nome: string, registrante: string) {
  const { empresa, reserva, email } = await soReservar(sessao, nome);
  const d = (await um<{ r: { inscricao: { id: string } } }>('select public.agenda_kickoff_zoom_inscricao_decidir($1, $2, $3) as r', [reserva, 'normal', GESTOR])).r;
  await db.query('select public.agenda_kickoff_zoom_inscricao_concluir($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    d.inscricao.id, 'pronta', registrante, `https://us02web.zoom.us/w/${SALA}?tk=SEGREDO`, 'Maria', `| ${nome}`, nome, true, null,
  ]);
  return { empresa, reserva, email };
}
/** Coloca a sessão no passado: começou há `minutosAtras` e durou 1 hora. */
async function sessaoNoPassado(sessao: string, minutosAtras: number) {
  await semGatilhos(
    `update public.meetings set scheduled_start_at = now() - interval '${minutosAtras} minutes', scheduled_end_at = now() - interval '${minutosAtras - 60} minutes' where id = '${sessao}'`,
  );
  const r = await um<{ i: Date; f: Date }>('select scheduled_start_at as i, scheduled_end_at as f from public.meetings where id = $1', [sessao]);
  return { inicio: new Date(r.i), fim: new Date(r.f) };
}
const mais = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const entrada = (registrant_id: string | undefined, de: Date, ate: Date, extra: Partial<ZoomReportParticipant> = {}): ZoomReportParticipant => ({
  registrant_id,
  join_time: iso(de),
  leave_time: iso(ate),
  status: 'in_meeting',
  ...extra,
});
type Reserva = { status: string; presenca: string | null; presenca_origem: string | null };
const reservaDe = (id: string) => um<Reserva>('select status, presenca, presenca_origem from public.agenda_kickoff_reservas where id = $1', [id]);
const historico = async (id: string) =>
  (await db.query<{ acao: string; dados: { origem?: string } | null }>('select acao, dados from public.agenda_kickoff_reservas_historico where reserva_id = $1 order by id', [id])).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BASE_DO_PLAN);
  await db.exec('alter table public.users add column avatar_url text');
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
    'integracoes/kickoff/007_kickoff_zoom_inscricoes.sql',
    'integracoes/kickoff/008_kickoff_zoom_presenca.sql',
  ]) {
    await db.exec(sqlDoRepo(m));
  }
  await db.exec(`
    insert into public.client_tenants (id, name) values ('${ORG}', 'Customer Success');
    insert into public.users (id, name, role) values ('${GESTOR}', 'Gestor', 'CUSTOMER_SUCCESS');
    insert into public.meet_user_profile (user_id, is_admin, sector, capacidades) values
      ('${GESTOR}', false, 'executoria', '{kickoff_impulsao.manage}'),
      ('${EQUIPE}', false, 'executoria', '{}');
  `);
  await db.query('select public.agenda_kickoff_zoom_sala_ativar($1, $2, $3, $4, $5, $6)', [SALA, 'Kickoff Impulsão', JSON.stringify(RESUMO), new Date().toISOString(), null, GESTOR]);
});

beforeEach(() => novoZoom());

describe('sincronizar presença do Zoom', () => {
  it('associa a execução certa, registra "presente" (origem zoom) e não conclui nada', async () => {
    const sessao = await novaSessao();
    const padaria = await inscrever(sessao, 'Padaria', 'reg-padaria-1');
    const oficina = await inscrever(sessao, 'Oficina', 'reg-oficina-1');
    const { inicio, fim } = await sessaoNoPassado(sessao, 180);
    zoom.execucoes = [
      // Execução de outro dia: ignorada (nem o relatório é lido).
      { uuid: 'semana-passada', start_time: iso(mais(inicio, -7 * 24 * 60)), fim: iso(mais(fim, -7 * 24 * 60)), participantes: [] },
      {
        uuid: 'desta-sessao==',
        start_time: iso(mais(inicio, -10)),
        fim: iso(mais(fim, 5)),
        participantes: [
          entrada('reg-padaria-1', mais(inicio, 2), mais(inicio, 20)),
          entrada('reg-padaria-1', mais(inicio, 22), mais(inicio, 55)),
          entrada(undefined, mais(inicio, -10), mais(fim, 5), { user_email: 'equipe@legacy.com', name: 'Legacy Executoria' }),
        ],
      },
    ];

    const r = await sincronizar(sessao);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.execucoes).toHaveLength(1);
    expect(zoom.chamadas).not.toContain('participantes semana-passada');
    expect(r.dados.empresas).toEqual([expect.objectContaining({ reservaId: padaria.reserva, empresa: 'Padaria', resultado: 'registrada', evidencia: 'registrante', entradas: 2, duracaoMin: 51 })]);
    expect(r.dados.pendentes).toEqual(['Oficina']);
    expect(r.dados.naoIdentificados).toEqual([]);

    expect(await reservaDe(padaria.reserva)).toEqual({ status: 'ativa', presenca: 'presente', presenca_origem: 'zoom' });
    // Ausência nunca é marcada pela sincronização.
    expect(await reservaDe(oficina.reserva)).toEqual({ status: 'ativa', presenca: null, presenca_origem: null });
    expect((await historico(padaria.reserva)).slice(-1)[0]).toEqual({ acao: 'presenca_registrada', dados: { presenca: 'presente', origem: 'zoom' } });
    const assoc = await db.query('select zoom_uuid, relatorio from public.agenda_kickoff_zoom_execucoes where meeting_id = $1', [sessao]);
    expect(assoc.rows).toEqual([{ zoom_uuid: 'desta-sessao==', relatorio: 'ok' }]);
  });

  it('repetir não duplica nada e não muda o que já foi registrado', async () => {
    const sessao = await novaSessao();
    const padaria = await inscrever(sessao, 'Padaria', 'reg-padaria-2');
    const { inicio, fim } = await sessaoNoPassado(sessao, 1000);
    zoom.execucoes = [{ uuid: 'x2', start_time: iso(inicio), fim: iso(fim), participantes: [entrada('reg-padaria-2', mais(inicio, 1), mais(inicio, 40))] }];

    const primeira = await sincronizar(sessao);
    const segunda = await sincronizar(sessao);
    expect(primeira.ok && primeira.dados.empresas[0].resultado).toBe('registrada');
    expect(segunda.ok && segunda.dados.empresas[0].resultado).toBe('ja_registrada');
    const hist = await historico(padaria.reserva);
    expect(hist.filter((h) => h.acao === 'presenca_registrada')).toHaveLength(1);
    expect((await um<{ n: number }>('select count(*)::int as n from public.agenda_kickoff_zoom_execucoes where meeting_id = $1', [sessao])).n).toBe(1);
    expect((await um<{ n: number }>('select count(*)::int as n from public.agenda_kickoff_zoom_presencas where meeting_id = $1', [sessao])).n).toBe(1);
  });

  it('preserva correção manual, ausência registrada à mão e kickoff concluído', async () => {
    const sessao = await novaSessao();
    const corrigida = await inscrever(sessao, 'Corrigida', 'reg-c');
    const ausente = await inscrever(sessao, 'Ausente', 'reg-a');
    const concluida = await inscrever(sessao, 'Concluida', 'reg-k');
    const { inicio, fim } = await sessaoNoPassado(sessao, 2000);
    // Corrigida: presente -> correção manual para "sem registro".
    await db.query('select public.agenda_kickoff_registrar_presenca($1, $2, $3)', [corrigida.reserva, 'presente', GESTOR]);
    await db.query('select public.agenda_kickoff_corrigir_presenca($1, $2, $3, $4)', [corrigida.reserva, 'nenhuma', 'Era outra pessoa', GESTOR]);
    await db.query('select public.agenda_kickoff_registrar_presenca($1, $2, $3)', [ausente.reserva, 'ausente', GESTOR]);
    await db.query('select public.agenda_kickoff_registrar_presenca($1, $2, $3)', [concluida.reserva, 'presente', GESTOR]);
    await db.query('select public.agenda_kickoff_concluir($1, $2, $3)', [concluida.reserva, 'ok', GESTOR]);
    zoom.execucoes = [
      {
        uuid: 'x3',
        start_time: iso(inicio),
        fim: iso(fim),
        participantes: ['reg-c', 'reg-a', 'reg-k'].map((reg) => entrada(reg, mais(inicio, 5), mais(inicio, 50))),
      },
    ];

    const r = await sincronizar(sessao);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const por = Object.fromEntries(r.dados.empresas.map((e) => [e.empresa, e.resultado]));
    expect(por).toEqual({ Corrigida: 'preservada', Ausente: 'revisar', Concluida: 'ja_registrada' });
    expect(await reservaDe(corrigida.reserva)).toMatchObject({ status: 'ativa', presenca: null });
    expect(await reservaDe(ausente.reserva)).toMatchObject({ status: 'ausente', presenca: 'ausente', presenca_origem: 'manual' });
    expect(await reservaDe(concluida.reserva)).toMatchObject({ status: 'concluida', presenca: 'presente', presenca_origem: 'manual' });
  });

  it('sem falso positivo: empresa de outra sessão e entrada só no trecho comum de sessões vizinhas', async () => {
    const s1 = await novaSessao();
    const s2 = await novaSessao();
    const daS1 = await inscrever(s1, 'DaS1', 'reg-s1');
    const daS2 = await inscrever(s2, 'DaS2', 'reg-s2');
    const { inicio: i1, fim: f1 } = await sessaoNoPassado(s1, 3000); // S1: -3000 .. -2940 min
    await sessaoNoPassado(s2, 2940); // S2: logo depois de S1
    zoom.execucoes = [
      {
        uuid: 'tarde-longa',
        start_time: iso(mais(i1, -5)),
        fim: iso(mais(f1, 65)),
        participantes: [
          // DaS2 entrou durante S1 (só no trecho que é das duas janelas): não conta para S1.
          entrada('reg-s2', mais(f1, -25), mais(f1, 25)),
          // DaS1 entrou só no trecho comum: conferência, não presença automática.
          entrada('reg-s1', mais(f1, -20), mais(f1, 20)),
        ],
      },
    ];

    const r = await sincronizar(s1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.foraDaSessao).toEqual(['DaS2']);
    expect(r.dados.empresas).toEqual([expect.objectContaining({ empresa: 'DaS1', resultado: 'revisar' })]);
    expect(await reservaDe(daS1.reserva)).toMatchObject({ presenca: null });
    expect(await reservaDe(daS2.reserva)).toMatchObject({ presenca: null });
  });

  it('sem registrant_id: o e-mail da inscrição Zoom desta reserva registra; o e-mail só do cadastro vai para conferência', async () => {
    const sessao = await novaSessao();
    const comInscricao = await inscrever(sessao, 'ComInscricao', 'reg-e1');
    const soCadastro = await soReservar(sessao, 'SoCadastro');
    const { inicio, fim } = await sessaoNoPassado(sessao, 6000);
    zoom.execucoes = [
      {
        uuid: 'x7',
        start_time: iso(inicio),
        fim: iso(fim),
        participantes: [
          entrada(undefined, mais(inicio, 3), mais(inicio, 45), { user_email: comInscricao.email.toUpperCase() }),
          entrada(undefined, mais(inicio, 3), mais(inicio, 45), { user_email: soCadastro.email }),
        ],
      },
    ];

    const r = await sincronizar(sessao);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const por = Object.fromEntries(r.dados.empresas.map((e) => [e.empresa, [e.resultado, e.evidencia]]));
    expect(por).toEqual({ ComInscricao: ['registrada', 'email'], SoCadastro: ['revisar', 'email'] });
    expect(await reservaDe(comInscricao.reserva)).toMatchObject({ presenca: 'presente', presenca_origem: 'zoom' });
    expect(await reservaDe(soCadastro.reserva)).toMatchObject({ status: 'ativa', presenca: null });
  });

  it('relatório ainda indisponível: nada é registrado e a apuração fica incompleta', async () => {
    const sessao = await novaSessao();
    const p = await inscrever(sessao, 'Padaria', 'reg-p5');
    const { inicio } = await sessaoNoPassado(sessao, 4000);
    zoom.execucoes = [{ uuid: 'sem-relatorio', start_time: iso(inicio), fim: null, participantes: [entrada('reg-p5', mais(inicio, 1), mais(inicio, 40))] }];
    zoom.getMeetingReport = async () => {
      const { ZoomApiError } = await import('@/lib/zoom/api');
      throw new ZoomApiError(404, 3001, 'x');
    };
    const r = await sincronizar(sessao);
    expect(r.ok && r.dados.incompleta).toBe(true);
    expect(r.ok && r.dados.pendentes).toEqual(['Padaria']);
    expect(await reservaDe(p.reserva)).toMatchObject({ presenca: null });
  });

  it('quem não gerencia kickoffs não sincroniza; sessão que não começou é recusada', async () => {
    const sessao = await novaSessao();
    await inscrever(sessao, 'Padaria', 'reg-p6');
    const futura = await sincronizar(sessao);
    expect(futura).toMatchObject({ ok: false, status: 422 });
    await sessaoNoPassado(sessao, 5000);
    expect(await sincronizar(sessao, EQUIPE)).toMatchObject({ ok: false, status: 403 });
    expect(zoom.chamadas).toEqual([]);
  });
});
