// Acesso Zoom individual (Zoom E2): migration 007 num Postgres em memória (PGlite),
// sobre as migrations reais (001 a 006), com a orquestração de verdade
// (garantirInscricao) e um Zoom FALSO. Nenhuma chamada externa.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZoomApiError, type ZoomMeeting, type ZoomRegistrant, type ZoomRegistrantInput } from '@/lib/zoom/api';
import { BASE_DO_PLAN, sqlDoRepo } from './bancoDeTeste';
import { bancoDaInscricao, garantirInscricao, type ChamarBanco, type ModoDoPedido } from './zoomInscricao';

const ORG = '0c000000-0000-4000-8000-000000000000';
const GESTOR = '1a000000-0000-4000-8000-000000000001';
const EQUIPE = '1a000000-0000-4000-8000-000000000003';
const SALA_A = '81234567890';
const SALA_B = '81234567891';
const RESUMO = { tipo: 8, aprovacao: 0, inscricao: 1 };

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
const semGatilhos = (sql: string) => db.exec(`set session_replication_role = replica; ${sql}; set session_replication_role = default;`);

/** O servidor chama as funções do banco assim (aqui, direto no PGlite). */
const chamar: ChamarBanco = async (fn, args) => {
  const chaves = Object.keys(args);
  const r = await db.query<{ r: unknown }>(
    `select public.${fn}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`,
    chaves.map((k) => args[k]),
  );
  return r.rows[0].r;
};

// --- Zoom falso -------------------------------------------------------------
type Inscrito = Required<Pick<ZoomRegistrant, 'id' | 'email' | 'status' | 'join_url'>> & { first_name: string; last_name: string };
let zoom: {
  chamadas: string[];
  inscritos: Map<string, Inscrito>;
  reuniao: ZoomMeeting;
  falhaAoInscrever: unknown;
  falhaNaReuniao: unknown;
  falhaAoLer: unknown;
  getMeeting(id: string): Promise<ZoomMeeting>;
  addRegistrant(id: string, input: ZoomRegistrantInput): Promise<{ registrant_id: string; join_url: string }>;
  getRegistrant(id: string, registrantId: string): Promise<ZoomRegistrant>;
  findRegistrantByEmail(id: string, email: string): Promise<ZoomRegistrant | null>;
};
let serie = 0;
function novoZoom() {
  zoom = {
    chamadas: [],
    inscritos: new Map(),
    reuniao: { id: 1, type: 8, settings: { approval_type: 0, registration_type: 1, meeting_authentication: false } },
    falhaAoInscrever: null,
    falhaNaReuniao: null,
    falhaAoLer: null,
    async getMeeting(id) {
      zoom.chamadas.push(`getMeeting ${id}`);
      if (zoom.falhaNaReuniao) throw zoom.falhaNaReuniao;
      return zoom.reuniao;
    },
    async addRegistrant(id, input) {
      zoom.chamadas.push(`addRegistrant ${id}`);
      if (zoom.falhaAoInscrever) throw zoom.falhaAoInscrever;
      const chave = `${id}:${input.email.toLowerCase()}`;
      // Como o Zoom: e-mail já inscrito devolve a MESMA inscrição, sem mudar o nome.
      let r = zoom.inscritos.get(chave);
      if (!r) {
        serie += 1;
        r = {
          id: `reg-${serie}`,
          email: input.email,
          first_name: input.first_name,
          last_name: input.last_name ?? '',
          status: 'approved',
          join_url: `https://us02web.zoom.us/w/${id}?tk=SEGREDO-${serie}`,
        };
        zoom.inscritos.set(chave, r);
      }
      return { registrant_id: r.id, join_url: r.join_url };
    },
    async getRegistrant(id, registrantId) {
      zoom.chamadas.push(`getRegistrant ${id}`);
      if (zoom.falhaAoLer) throw zoom.falhaAoLer;
      const r = [...zoom.inscritos.entries()].find(([k, v]) => k.startsWith(`${id}:`) && v.id === registrantId)?.[1];
      if (!r) throw new ZoomApiError(404, 3001, 'x');
      return r;
    },
    async findRegistrantByEmail(id, email) {
      zoom.chamadas.push(`findRegistrantByEmail ${id}`);
      return zoom.inscritos.get(`${id}:${email.toLowerCase()}`) ?? null;
    },
  };
}

const garantir = (reserva: string, modo: ModoDoPedido = 'normal', usuario: string | null = null, agora?: () => number) =>
  garantirInscricao(reserva, { zoom, banco: bancoDaInscricao(chamar, usuario), agora }, modo);

// --- Cenário ----------------------------------------------------------------
let n = 0;
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
/** Empresa nova; o código no Zoom são os 8 primeiros hexadecimais do id. */
async function novaEmpresa(nome = 'Padaria Pão Bom'): Promise<{ id: string; codigo: string }> {
  n += 1;
  const codigo = (0xa0000000 + n).toString(16).toUpperCase();
  const id = `${codigo.toLowerCase()}-0000-4000-8000-000000000001`;
  await db.query('insert into public.client_tenants (id, name) values ($1, $2)', [id, nome]);
  return { id, codigo };
}
const reservar = async (sessao: string, empresa: string, nome = 'Maria Silva', email = `maria${++n}@empresa.com.br`) =>
  (await um<{ r: { id: string } }>('select public.agenda_kickoff_reservar($1, $2, $3, $4, null, $5) as r', [sessao, empresa, nome, email, GESTOR])).r.id;
/** Sessão nova + empresa nova + reserva ativa. */
async function cenario(nome = 'Maria Silva', email?: string) {
  const sessao = await novaSessao();
  const empresa = await novaEmpresa();
  const reserva = await reservar(sessao, empresa.id, nome, email);
  return { sessao, empresa, reserva };
}
async function sessaoJaComecou(sessao: string) {
  await semGatilhos(`update public.meetings set scheduled_start_at = now() - interval '2 hours', scheduled_end_at = now() - interval '1 hour' where id = '${sessao}'`);
}
const ativarSala = (meetingId: string, motivo: string | null = null) =>
  db.query('select public.agenda_kickoff_zoom_sala_ativar($1, $2, $3, $4, $5, $6)', [meetingId, 'Kickoff Impulsão', JSON.stringify(RESUMO), new Date().toISOString(), motivo, GESTOR]);

type Inscricao = {
  id: string;
  zoom_meeting_id: string;
  email: string;
  tenant_id: string;
  codigo_empresa: string;
  status: string;
  join_url: string | null;
  zoom_registrant_id: string | null;
  zoom_nome: string | null;
  zoom_sobrenome: string | null;
  tentativas: number;
  ultimo_erro: string | null;
  ultima_reserva_id: string;
  substituida_em: string | null;
  acessos: number;
};
const inscricoes = async (email: string) =>
  (await db.query<Inscricao>('select * from public.agenda_kickoff_zoom_inscricoes where email = $1 order by criada_em', [email])).rows;
const emailDa = async (reserva: string) => (await um<{ e: string }>('select participante_email as e from public.agenda_kickoff_reservas where id = $1', [reserva])).e;
const inscricaoDa = async (reserva: string) => (await inscricoes(await emailDa(reserva)))[0];
const historico = async (inscricao: string) =>
  (await db.query<{ acao: string }>('select acao from public.agenda_kickoff_zoom_inscricoes_historico where inscricao_id = $1 order by id', [inscricao])).rows.map((h) => h.acao);
type Estado = { reserva_id: string; estado: string; erro: string | null; nome_no_zoom: string | null; nome_difere: boolean; sala_anterior: boolean; sala_com_problemas: boolean };
const estado = async (reserva: string) => (await um<{ r: Estado[] }>('select public.agenda_kickoff_zoom_acessos($1::uuid[]) as r', [[reserva]])).r[0];
const statusDaReserva = async (reserva: string) => (await um<{ s: string }>('select status as s from public.agenda_kickoff_reservas where id = $1', [reserva])).s;
type DoConvite = { status: string; reserva_id?: string; inicio?: string; fim?: string; acesso?: Estado };
const doConvite = async (codigo: string, origem: string, contar = false) =>
  (await um<{ r: DoConvite }>('select public.agenda_kickoff_zoom_reserva_do_convite($1, $2, $3) as r', [codigo, origem, contar])).r;
const convite = async (empresa: string) =>
  (await um<{ r: { codigo: string } }>('select public.agenda_kickoff_convite_gerar($1, null, $2) as r', [empresa, GESTOR])).r.codigo;

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
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(() => novoZoom());

describe('sem sala Zoom ativa', () => {
  it('a reserva vale, o acesso fica "sem_sala" e o Zoom não é chamado', async () => {
    const { reserva } = await cenario();
    expect(await garantir(reserva)).toEqual({ estado: 'sem_sala' });
    expect((await estado(reserva)).estado).toBe('sem_sala');
    expect(zoom.chamadas).toEqual([]);
    expect(await statusDaReserva(reserva)).toBe('ativa');
    expect(await inscricoes(await emailDa(reserva))).toEqual([]);
  });
});

describe('inscrição na sala ativa', () => {
  beforeAll(async () => {
    await ativarSala(SALA_A);
  });

  it('inscrição nova: "Nome | Empresa #CÓDIGO", ligada à empresa, à reserva e à sala; o link fica só no banco', async () => {
    const { reserva, empresa } = await cenario('Maria Silva');
    expect((await estado(reserva)).estado).toBe('pendente');
    const r = await garantir(reserva);
    expect(r).toMatchObject({ estado: 'pronto', reaproveitada: false });
    const i = await inscricaoDa(reserva);
    expect(i).toMatchObject({
      zoom_meeting_id: SALA_A,
      tenant_id: empresa.id,
      codigo_empresa: empresa.codigo,
      status: 'pronta',
      ultima_reserva_id: reserva,
      zoom_nome: 'Maria',
      zoom_sobrenome: `Silva | Padaria Pão Bom #${empresa.codigo}`,
      tentativas: 1,
    });
    expect(i.join_url).toMatch(/^https:\/\/us02web\.zoom\.us\//);
    expect(zoom.chamadas).toEqual([`getMeeting ${SALA_A}`, `addRegistrant ${SALA_A}`, `getRegistrant ${SALA_A}`]);
    expect(await historico(i.id)).toEqual(['solicitada', 'pronta']);
    // O estado para as telas nunca traz o link nem o id do registrante.
    const e = await estado(reserva);
    expect(e).toMatchObject({ estado: 'pronto', nome_difere: false, sala_anterior: false });
    expect(JSON.stringify(e)).not.toContain('SEGREDO');
    expect(JSON.stringify(e)).not.toContain(i.zoom_registrant_id);
  });

  it('inscrição já existente é reaproveitada sem chamar o Zoom (conferida há menos de 6 h)', async () => {
    const { reserva } = await cenario();
    const primeira = await garantir(reserva);
    zoom.chamadas = [];
    const segunda = await garantir(reserva);
    expect(segunda).toMatchObject({ estado: 'pronto', reaproveitada: true });
    expect(segunda).toMatchObject({ joinUrl: (primeira as { joinUrl: string }).joinUrl });
    expect(zoom.chamadas).toEqual([]);
    expect(await inscricoes(await emailDa(reserva))).toHaveLength(1);
  });

  it('pedidos simultâneos: só um fala com o Zoom; o outro recebe "preparando" e nada duplica', async () => {
    const { reserva } = await cenario();
    // O primeiro pedido reservou a inscrição (criando) e ainda está falando com o Zoom.
    const d1 = (await chamar('agenda_kickoff_zoom_inscricao_decidir', { p_reserva_id: reserva, p_modo: 'normal', p_usuario: null })) as { acao: string };
    expect(d1.acao).toBe('criar');
    expect(await garantir(reserva)).toEqual({ estado: 'preparando' });
    expect(await garantir(reserva, 'tentar_de_novo', GESTOR)).toEqual({ estado: 'preparando' });
    expect(zoom.chamadas).toEqual([]);
    expect((await estado(reserva)).estado).toBe('preparando');
    expect(await inscricoes(await emailDa(reserva))).toHaveLength(1);
    // Dois pedidos disparados juntos: uma inscrição só no Zoom.
    const outro = await cenario();
    const [a, b] = await Promise.all([garantir(outro.reserva), garantir(outro.reserva)]);
    expect([a.estado, b.estado].sort()).toEqual(['preparando', 'pronto']);
    expect(zoom.chamadas.filter((c) => c.startsWith('addRegistrant'))).toHaveLength(1);
    expect(await inscricoes(await emailDa(outro.reserva))).toHaveLength(1);
  });

  it('criação interrompida (servidor caiu) é retomada depois de 2 minutos', async () => {
    const { reserva } = await cenario();
    await chamar('agenda_kickoff_zoom_inscricao_decidir', { p_reserva_id: reserva, p_modo: 'normal', p_usuario: null });
    const i = await inscricaoDa(reserva);
    await db.query("update public.agenda_kickoff_zoom_inscricoes set reivindicada_em = now() - interval '3 minutes' where id = $1", [i.id]);
    expect(await estado(reserva)).toMatchObject({ estado: 'erro', erro: 'A última tentativa foi interrompida.' });
    expect(await garantir(reserva)).toMatchObject({ estado: 'pronto' });
    expect((await inscricaoDa(reserva)).tentativas).toBe(2);
  });

  it('falha temporária do Zoom: a reserva continua ativa, o erro fica guardado (sem texto do Zoom) e dá para recuperar', async () => {
    const { reserva } = await cenario();
    zoom.falhaAoInscrever = new ZoomApiError(503, null, 'detalhe interno do Zoom');
    const r = await garantir(reserva);
    expect(r).toEqual({ estado: 'erro', mensagem: 'O Zoom está com instabilidade. Tente de novo em instantes.' });
    expect(await statusDaReserva(reserva)).toBe('ativa');
    const i = await inscricaoDa(reserva);
    expect(i).toMatchObject({ status: 'erro', join_url: null, ultimo_erro: 'O Zoom está com instabilidade. Tente de novo em instantes.' });
    expect(await estado(reserva)).toMatchObject({ estado: 'erro', erro: 'O Zoom está com instabilidade. Tente de novo em instantes.' });

    // Logo em seguida, o pedido comum espera (15 s) sem martelar o Zoom...
    zoom.falhaAoInscrever = null;
    zoom.chamadas = [];
    expect(await garantir(reserva)).toMatchObject({ estado: 'erro' });
    expect(zoom.chamadas).toEqual([]);
    // ...a equipe pode tentar de novo na hora...
    expect(await garantir(reserva, 'tentar_de_novo', GESTOR)).toMatchObject({ estado: 'pronto' });
    expect(await historico(i.id)).toEqual(['solicitada', 'erro', 'solicitada', 'pronta']);
    expect(await inscricoes(await emailDa(reserva))).toHaveLength(1);
  });

  it('depois de 15 s o pedido comum (da empresa) tenta de novo sozinho', async () => {
    const { reserva } = await cenario();
    zoom.falhaNaReuniao = new ZoomApiError(0, null, 'Falha de rede ao falar com o Zoom.');
    expect(await garantir(reserva)).toEqual({ estado: 'erro', mensagem: 'Não foi possível falar com o Zoom agora.' });
    zoom.falhaNaReuniao = null;
    await db.query("update public.agenda_kickoff_zoom_inscricoes set ultima_tentativa_em = now() - interval '20 seconds' where email = $1", [await emailDa(reserva)]);
    expect(await garantir(reserva)).toMatchObject({ estado: 'pronto' });
  });

  it('erro de autenticação e de autorização do Zoom: mensagem para a equipe, reserva intacta, nada de segredo', async () => {
    const a = await cenario();
    zoom.falhaNaReuniao = new ZoomApiError(401, null, 'Falha ao obter token do Zoom (HTTP 401)', 'oauth');
    expect(await garantir(a.reserva)).toEqual({ estado: 'erro', mensagem: 'O Zoom recusou as credenciais do servidor. Confira a integração no quadro Sala Zoom.' });
    const b = await cenario();
    zoom.falhaNaReuniao = null;
    zoom.falhaAoInscrever = new ZoomApiError(403, 4711, 'Invalid access token, does not contain scopes: meeting:write:registrant:admin');
    const r = await garantir(b.reserva);
    expect(r).toEqual({ estado: 'erro', mensagem: 'A integração com o Zoom está sem permissão para inscrever. Confira as credenciais e os escopos do app.' });
    expect(JSON.stringify(await inscricaoDa(b.reserva))).not.toMatch(/scopes|access token/i);
    expect(await statusDaReserva(a.reserva)).toBe('ativa');
    expect(await statusDaReserva(b.reserva)).toBe('ativa');
  });

  it('sala que deixou de aceitar inscrição no Zoom (aprovação manual): não inscreve e explica', async () => {
    const { reserva } = await cenario();
    zoom.reuniao = { id: 1, type: 8, settings: { approval_type: 1, registration_type: 1 } };
    const r = await garantir(reserva);
    expect(r.estado).toBe('erro');
    expect((r as { mensagem: string }).mensagem).toContain('aprovação manual');
    expect(zoom.chamadas).toEqual([`getMeeting ${SALA_A}`]);
  });

  it('resposta ambígua do Zoom ao inscrever (409): procura a inscrição pelo e-mail e aproveita', async () => {
    const { reserva, empresa } = await cenario('Ana Lima', 'ana@ambigua.com.br');
    zoom.inscritos.set(`${SALA_A}:ana@ambigua.com.br`, {
      id: 'reg-antigo',
      email: 'ana@ambigua.com.br',
      first_name: 'Ana',
      last_name: `Lima | Padaria Pão Bom #${empresa.codigo}`,
      status: 'approved',
      join_url: `https://us02web.zoom.us/w/${SALA_A}?tk=SEGREDO-antigo`,
    });
    zoom.falhaAoInscrever = new ZoomApiError(409, 3027, 'x');
    expect(await garantir(reserva)).toMatchObject({ estado: 'pronto', reaproveitada: false });
    expect(zoom.chamadas).toContain(`findRegistrantByEmail ${SALA_A}`);
    expect((await inscricaoDa(reserva)).zoom_registrant_id).toBe('reg-antigo');
  });

  it('o mesmo e-mail em outra empresa: conflito sem chamar o Zoom; o link de uma nunca vai para a outra', async () => {
    const a = await cenario('Maria', 'compartilhado@contabilidade.com.br');
    expect(await garantir(a.reserva)).toMatchObject({ estado: 'pronto' });
    const b = await cenario('João', 'compartilhado@contabilidade.com.br');
    zoom.chamadas = [];
    const r = await garantir(b.reserva);
    expect(r.estado).toBe('conflito');
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
    expect(zoom.chamadas).toEqual([]);
    expect(await estado(b.reserva)).toMatchObject({ estado: 'conflito' });
    expect((await estado(b.reserva)).erro).toContain('outra empresa');
    // A equipe tentar de novo não muda: é preciso trocar o e-mail do participante.
    expect((await garantir(b.reserva, 'tentar_de_novo', GESTOR)).estado).toBe('conflito');
    // A inscrição continua sendo só da empresa A.
    const todas = await inscricoes('compartilhado@contabilidade.com.br');
    expect(todas).toHaveLength(1);
    expect(todas[0].tenant_id).toBe(a.empresa.id);
    expect((await estado(a.reserva)).estado).toBe('pronto');
  });

  it('o Zoom já tinha o e-mail com o código de OUTRA empresa (inscrição feita por fora): conflito, link não é guardado', async () => {
    const { reserva } = await cenario('Bia', 'bia@fora.com.br');
    zoom.inscritos.set(`${SALA_A}:bia@fora.com.br`, {
      id: 'reg-fora',
      email: 'bia@fora.com.br',
      first_name: 'Bia',
      last_name: 'Souza | Outra Empresa #DEADBEEF',
      status: 'approved',
      join_url: `https://us02web.zoom.us/w/${SALA_A}?tk=SEGREDO-de-outra`,
    });
    expect((await garantir(reserva)).estado).toBe('conflito');
    const i = await inscricaoDa(reserva);
    expect(i).toMatchObject({ status: 'conflito', join_url: null });
    expect(await historico(i.id)).toEqual(['solicitada', 'conflito']);
    // Pedido comum não insiste no Zoom; só a equipe reavalia.
    zoom.chamadas = [];
    expect((await garantir(reserva)).estado).toBe('conflito');
    expect(zoom.chamadas).toEqual([]);
  });

  it('link que não é do Zoom nunca é aceito como acesso', async () => {
    const { reserva } = await cenario('Caio', 'caio@link.com.br');
    zoom.inscritos.set(`${SALA_A}:caio@link.com.br`, { id: 'reg-x', email: 'caio@link.com.br', first_name: 'Caio', last_name: '', status: 'approved', join_url: 'https://zoom.us.exemplo.com/roubo' });
    expect((await garantir(reserva)).estado).toBe('erro');
    expect((await inscricaoDa(reserva)).join_url).toBeNull();
    // O banco também recusa gravar "pronta" sem link https.
    const d = (await chamar('agenda_kickoff_zoom_inscricao_decidir', { p_reserva_id: reserva, p_modo: 'tentar_de_novo', p_usuario: GESTOR })) as { inscricao: { id: string } };
    await chamar('agenda_kickoff_zoom_inscricao_concluir', {
      p_id: d.inscricao.id, p_status: 'pronta', p_zoom_registrant_id: 'reg-x', p_join_url: 'javascript:alert(1)',
      p_nome: null, p_sobrenome: null, p_organizacao: null, p_nome_confere: null, p_erro: null,
    });
    expect(await inscricaoDa(reserva)).toMatchObject({ status: 'erro', join_url: null });
  });

  it('inscrição que sumiu do Zoom é refeita na conferência (a cada 6 h); Zoom fora do ar não derruba o acesso guardado', async () => {
    const { reserva } = await cenario();
    const primeira = (await garantir(reserva)) as { joinUrl: string };
    const i = await inscricaoDa(reserva);
    const depois = () => Date.now() + 7 * 3_600_000;
    // Zoom fora do ar na conferência: entrega o link guardado.
    zoom.falhaAoLer = new ZoomApiError(0, null, 'rede');
    expect(await garantir(reserva, 'normal', null, depois)).toMatchObject({ estado: 'pronto', joinUrl: primeira.joinUrl, reaproveitada: true });
    // Sumiu no Zoom: cria outra inscrição.
    zoom.falhaAoLer = null;
    zoom.inscritos.clear();
    const nova = await garantir(reserva, 'normal', null, depois);
    expect(nova).toMatchObject({ estado: 'pronto', reaproveitada: false });
    expect((nova as { joinUrl: string }).joinUrl).not.toBe(primeira.joinUrl);
    expect(await historico(i.id)).toEqual(['solicitada', 'pronta', 'refeita', 'pronta']);
    expect(await inscricoes(await emailDa(reserva))).toHaveLength(1);
  });
});

describe('alteração do participante', () => {
  it('troca de e-mail: outra inscrição; a antiga fica no histórico como substituída e não é mais entregue para a reserva', async () => {
    const { reserva } = await cenario('Maria Silva', 'maria.antiga@troca.com.br');
    const antes = (await garantir(reserva)) as { joinUrl: string };
    await db.query("select public.agenda_kickoff_atualizar_participante($1, 'João Souza', 'joao.novo@troca.com.br', null, $2)", [reserva, GESTOR]);
    // A reserva continua válida; o acesso do e-mail novo ainda não existe.
    expect(await statusDaReserva(reserva)).toBe('ativa');
    expect(await estado(reserva)).toMatchObject({ estado: 'pendente', sala_anterior: false });
    const depois = await garantir(reserva, 'tentar_de_novo', GESTOR);
    expect(depois).toMatchObject({ estado: 'pronto', reaproveitada: false });
    expect((depois as { joinUrl: string }).joinUrl).not.toBe(antes.joinUrl);
    const [antiga] = await inscricoes('maria.antiga@troca.com.br');
    const [nova] = await inscricoes('joao.novo@troca.com.br');
    expect(antiga.substituida_em).not.toBeNull();
    expect(await historico(antiga.id)).toEqual(['solicitada', 'pronta', 'substituida']);
    expect(nova).toMatchObject({ status: 'pronta', zoom_nome: 'João', ultima_reserva_id: reserva });
    // Novos pedidos da reserva devolvem sempre o acesso do participante atual.
    expect(await garantir(reserva)).toMatchObject({ joinUrl: (depois as { joinUrl: string }).joinUrl });
  });

  it('correção só do nome: a mesma inscrição continua valendo e o painel avisa que o Zoom mantém o nome antigo', async () => {
    const { reserva } = await cenario('Maira Silva', 'maria@nome.com.br');
    await garantir(reserva);
    await db.query("select public.agenda_kickoff_atualizar_participante($1, 'Maria Silva', 'maria@nome.com.br', null, $2)", [reserva, GESTOR]);
    zoom.chamadas = [];
    expect(await garantir(reserva, 'tentar_de_novo', GESTOR)).toMatchObject({ estado: 'pronto', reaproveitada: true });
    expect(zoom.chamadas).toEqual([]);
    const e = await estado(reserva);
    expect(e).toMatchObject({ estado: 'pronto', nome_difere: true });
    expect(e.nome_no_zoom).toContain('Maira');
    expect(await inscricoes('maria@nome.com.br')).toHaveLength(1);
  });
});

describe('reserva que deixa de ser elegível', () => {
  it('cancelada: não gera inscrição, o acesso pronto deixa de ser entregue e o convite responde "sem_reserva"', async () => {
    const semAcesso = await cenario();
    await db.query("select public.agenda_kickoff_cancelar_reserva($1, 'desistiu', $2)", [semAcesso.reserva, GESTOR]);
    expect(await garantir(semAcesso.reserva)).toEqual({ estado: 'reserva_inativa' });
    expect(zoom.chamadas).toEqual([]);

    const comAcesso = await cenario();
    const codigo = await convite(comAcesso.empresa.id);
    await garantir(comAcesso.reserva);
    expect((await doConvite(codigo, 'ip:c1')).acesso?.estado).toBe('pronto');
    await db.query("select public.agenda_kickoff_cancelar_reserva($1, 'desistiu', $2)", [comAcesso.reserva, GESTOR]);
    zoom.chamadas = [];
    expect(await garantir(comAcesso.reserva)).toEqual({ estado: 'reserva_inativa' });
    expect(await garantir(comAcesso.reserva, 'tentar_de_novo', GESTOR)).toEqual({ estado: 'reserva_inativa' });
    expect(zoom.chamadas).toEqual([]);
    expect((await estado(comAcesso.reserva)).estado).toBe('inativo');
    expect(await doConvite(codigo, 'ip:c1')).toEqual({ status: 'sem_reserva' });
    // A inscrição fica guardada (histórico), mas ninguém mais a recebe.
    expect((await inscricaoDa(comAcesso.reserva)).status).toBe('pronta');
  });

  it('concluída, ausente e interrompida: sem acesso; o reagendamento reaproveita a inscrição da empresa', async () => {
    const c = await cenario();
    const codigoC = await convite(c.empresa.id);
    await garantir(c.reserva);
    await sessaoJaComecou(c.sessao);
    await db.query("select public.agenda_kickoff_registrar_presenca($1, 'presente', $2)", [c.reserva, GESTOR]);
    await db.query("select public.agenda_kickoff_concluir($1, 'ok', $2)", [c.reserva, GESTOR]);
    expect(await garantir(c.reserva)).toEqual({ estado: 'reserva_inativa' });
    expect(await doConvite(codigoC, 'ip:c2')).toEqual({ status: 'concluida' });

    // Ausência: sem acesso até reagendar; a reserva nova usa a MESMA inscrição (mesmo e-mail, mesma empresa).
    const a = await cenario('Rita', 'rita@ausente.com.br');
    const codigoA = await convite(a.empresa.id);
    const antes = (await garantir(a.reserva)) as { joinUrl: string };
    await sessaoJaComecou(a.sessao);
    await db.query("select public.agenda_kickoff_registrar_presenca($1, 'ausente', $2)", [a.reserva, GESTOR]);
    expect(await garantir(a.reserva)).toEqual({ estado: 'reserva_inativa' });
    expect(await doConvite(codigoA, 'ip:c2')).toEqual({ status: 'sem_reserva' });
    const nova = (await um<{ r: { id: string } }>("select public.agenda_kickoff_reagendar($1, $2, 'faltou', $3) as r", [a.reserva, await novaSessao(), GESTOR])).r.id;
    zoom.chamadas = [];
    expect(await garantir(nova)).toMatchObject({ estado: 'pronto', reaproveitada: true, joinUrl: antes.joinUrl });
    expect(zoom.chamadas).toEqual([]);
    expect(await inscricoes('rita@ausente.com.br')).toHaveLength(1);
    expect((await inscricaoDa(nova)).ultima_reserva_id).toBe(nova);
    expect((await doConvite(codigoA, 'ip:c2')).reserva_id).toBe(nova);

    // Interrompida (compareceu e não concluiu): também sem acesso.
    const i = await cenario();
    await garantir(i.reserva);
    await sessaoJaComecou(i.sessao);
    await db.query("select public.agenda_kickoff_registrar_presenca($1, 'presente', $2)", [i.reserva, GESTOR]);
    await db.query("select public.agenda_kickoff_registrar_interrupcao($1, 'queda de energia', $2)", [i.reserva, GESTOR]);
    expect(await garantir(i.reserva)).toEqual({ estado: 'reserva_inativa' });
  });

  it('remanejar mantém o acesso: a inscrição é da sala, não da sessão', async () => {
    const { reserva } = await cenario();
    const antes = (await garantir(reserva)) as { joinUrl: string };
    await db.query("select public.agenda_kickoff_remanejar($1, $2, 'pedido da empresa', $3)", [reserva, await novaSessao(), GESTOR]);
    zoom.chamadas = [];
    expect(await garantir(reserva)).toMatchObject({ estado: 'pronto', reaproveitada: true, joinUrl: antes.joinUrl });
    expect(zoom.chamadas).toEqual([]);
  });
});

describe('convite -> reserva (página pública e /impulsao/reuniao)', () => {
  it('convite válido devolve a reserva ativa, o horário da sessão e o estado, sem link nem dados da empresa', async () => {
    const { reserva, empresa } = await cenario();
    const codigo = await convite(empresa.id);
    const r = await doConvite(codigo, 'ip:v1');
    expect(r).toMatchObject({ status: 'ok', reserva_id: reserva, acesso: { estado: 'pendente' } });
    expect(Date.parse(r.fim as string) - Date.parse(r.inicio as string)).toBe(3_600_000);
    await garantir(reserva);
    const pronto = await doConvite(codigo, 'ip:v1');
    expect(pronto.acesso?.estado).toBe('pronto');
    expect(JSON.stringify(pronto)).not.toContain('SEGREDO');
    expect(JSON.stringify(pronto)).not.toContain(empresa.id);
  });

  it('empresa sem reserva: "sem_reserva"; o convite de uma empresa nunca devolve a reserva de outra', async () => {
    const a = await cenario();
    const semReserva = await novaEmpresa('Sem Reserva');
    expect(await doConvite(await convite(semReserva.id), 'ip:v2')).toEqual({ status: 'sem_reserva' });
    const b = await cenario();
    expect((await doConvite(await convite(b.empresa.id), 'ip:v2')).reserva_id).toBe(b.reserva);
    expect((await doConvite(await convite(a.empresa.id), 'ip:v2')).reserva_id).toBe(a.reserva);
  });

  it('convite revogado não dá acesso, mesmo com reserva ativa e inscrição pronta', async () => {
    const { reserva, empresa } = await cenario();
    const codigo = await convite(empresa.id);
    await garantir(reserva);
    await db.query("select public.agenda_kickoff_convite_revogar($1, 'vazou', $2)", [empresa.id, GESTOR]);
    expect(await doConvite(codigo, 'ip:v3', true)).toEqual({ status: 'convite_revogado' });
    // O convite novo (reemitido) volta a dar acesso à mesma reserva.
    expect((await doConvite(await convite(empresa.id), 'ip:v3', true)).reserva_id).toBe(reserva);
  });

  it('convite expirado COM reserva ativa continua valendo para a reunião; SEM reserva, não abre', async () => {
    const { reserva, empresa } = await cenario();
    const codigo = await convite(empresa.id);
    await semGatilhos(`update public.agenda_kickoff_convites set criado_em = now() - interval '100 days', expira_em = now() - interval '1 day' where codigo = '${codigo}'`);
    expect(await doConvite(codigo, 'ip:v4', true)).toMatchObject({ status: 'ok', reserva_id: reserva });
    await db.query("select public.agenda_kickoff_cancelar_reserva($1, 'desistiu', $2)", [reserva, GESTOR]);
    expect(await doConvite(codigo, 'ip:v4', true)).toEqual({ status: 'convite_expirado' });
  });

  it('limite de tentativas da M3: 10 códigos errados bloqueiam a origem, inclusive para código certo', async () => {
    const { empresa } = await cenario();
    const codigo = await convite(empresa.id);
    for (let i = 0; i < 10; i++) expect((await doConvite('zzzzzzzzzzzz', 'ip:martelo', true)).status).toBe('convite_invalido');
    expect(await doConvite(codigo, 'ip:martelo', true)).toEqual({ status: 'muitas_tentativas' });
    expect(await doConvite(codigo, 'ip:martelo', false)).toEqual({ status: 'muitas_tentativas' });
    // Outra origem continua entrando.
    expect((await doConvite(codigo, 'ip:outra', true)).status).toBe('ok');
  });

  it('no máximo 30 pedidos de acesso por convite em 15 minutos; só consultar não conta', async () => {
    const { empresa } = await cenario();
    const codigo = await convite(empresa.id);
    for (let i = 0; i < 40; i++) expect((await doConvite(codigo, 'ip:l1', false)).status).toBe('ok');
    for (let i = 0; i < 30; i++) expect((await doConvite(codigo, 'ip:l1', true)).status).toBe('ok');
    expect(await doConvite(codigo, 'ip:l1', true)).toEqual({ status: 'muitas_tentativas' });
    expect((await doConvite(codigo, 'ip:l1', false)).status).toBe('ok');
  });
});

describe('troca da sala Zoom', () => {
  it('a inscrição da sala anterior não vale na nova: cada reserva gera outra, quando pedida, e a antiga fica guardada', async () => {
    const { reserva } = await cenario('Maria', 'maria@troca-de-sala.com.br');
    const naA = (await garantir(reserva)) as { joinUrl: string };
    const outra = await cenario('Leo', 'leo@troca-de-sala.com.br');
    await garantir(outra.reserva);

    await ativarSala(SALA_B, 'sala nova');
    // Nada migra sozinho: as reservas ativas ficam "pendente", com o aviso da sala anterior.
    expect(await estado(reserva)).toMatchObject({ estado: 'pendente', sala_anterior: true });
    expect(await estado(outra.reserva)).toMatchObject({ estado: 'pendente', sala_anterior: true });
    expect(await inscricoes('maria@troca-de-sala.com.br')).toHaveLength(1);

    zoom.chamadas = [];
    const naB = await garantir(reserva, 'tentar_de_novo', GESTOR);
    expect(naB).toMatchObject({ estado: 'pronto', reaproveitada: false });
    expect((naB as { joinUrl: string }).joinUrl).not.toBe(naA.joinUrl);
    expect((naB as { joinUrl: string }).joinUrl).toContain(SALA_B);
    expect(zoom.chamadas).toEqual([`getMeeting ${SALA_B}`, `addRegistrant ${SALA_B}`, `getRegistrant ${SALA_B}`]);
    const todas = await inscricoes('maria@troca-de-sala.com.br');
    expect(todas.map((i) => [i.zoom_meeting_id, i.status])).toEqual([[SALA_A, 'pronta'], [SALA_B, 'pronta']]);
    // A outra reserva continua pendente até alguém pedir.
    expect((await estado(outra.reserva)).estado).toBe('pendente');

    // Voltar para a sala A reativa as inscrições que já existiam nela.
    await ativarSala(SALA_A, 'voltou');
    zoom.chamadas = [];
    expect(await garantir(outra.reserva)).toMatchObject({ estado: 'pronto', reaproveitada: true });
    expect(zoom.chamadas).toEqual([]);
  });

  it('sala ativa reprovada na última verificação: não cria inscrição nova, mas mantém as prontas', async () => {
    const pronta = await cenario();
    await garantir(pronta.reserva);
    const nova = await cenario();
    await db.query("update public.agenda_kickoff_zoom_salas set verificacao_ok = false where ativa");
    zoom.chamadas = [];
    expect(await garantir(nova.reserva)).toEqual({ estado: 'sala_com_problemas' });
    expect(await estado(nova.reserva)).toMatchObject({ estado: 'pendente', sala_com_problemas: true });
    expect(await garantir(pronta.reserva)).toMatchObject({ estado: 'pronto', reaproveitada: true });
    expect(zoom.chamadas).toEqual([]);
    await db.query("update public.agenda_kickoff_zoom_salas set verificacao_ok = true where ativa");
  });
});

describe('integridade, permissões e o que a E2 não pode tocar', () => {
  it('quem não gerencia kickoffs não pede acesso em nome da equipe', async () => {
    const { reserva } = await cenario();
    await expect(garantir(reserva, 'tentar_de_novo', EQUIPE)).rejects.toMatchObject({ code: '42501' });
    expect(zoom.chamadas).toEqual([]);
    expect(await inscricoes(await emailDa(reserva))).toEqual([]);
    expect((await falha("select public.agenda_kickoff_zoom_inscricao_decidir($1, 'qualquer', null)", [reserva])).code).toBe('22023');
  });

  it('inscrição e histórico não se apagam; a inscrição não troca de sala, e-mail nem empresa', async () => {
    const { reserva } = await cenario();
    await garantir(reserva);
    const i = await inscricaoDa(reserva);
    const outra = await novaEmpresa('Outra');
    expect((await falha('delete from public.agenda_kickoff_zoom_inscricoes where id = $1', [i.id])).code).toBe('42501');
    expect((await falha('truncate public.agenda_kickoff_zoom_inscricoes cascade')).code).toBe('42501');
    expect((await falha("update public.agenda_kickoff_zoom_inscricoes set email = 'x@y.com.br' where id = $1", [i.id])).code).toBe('42501');
    expect((await falha('update public.agenda_kickoff_zoom_inscricoes set tenant_id = $2 where id = $1', [i.id, outra.id])).code).toBe('42501');
    expect((await falha("update public.agenda_kickoff_zoom_inscricoes set zoom_meeting_id = '99999999999' where id = $1", [i.id])).code).toBe('42501');
    expect((await falha("update public.agenda_kickoff_zoom_inscricoes_historico set acao = 'erro' where inscricao_id = $1", [i.id])).code).toBe('42501');
    expect((await falha('delete from public.agenda_kickoff_zoom_inscricoes_historico where inscricao_id = $1', [i.id])).code).toBe('42501');
    // Reserva com inscrição não pode ser apagada por baixo (chave restrict), nem por quem ignora gatilhos de regra.
    expect((await falha('delete from public.agenda_kickoff_reservas where id = $1', [reserva])).code).toBeDefined();
  });

  it('anon e authenticated não leem as tabelas nem executam as funções; service_role executa', async () => {
    const funcoes = await db.query<{ f: string; anon: boolean; aut: boolean; pub: boolean; srv: boolean; definer: boolean; caminho: boolean }>(`
      select p.proname as f,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as aut,
             exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) as pub,
             has_function_privilege('service_role', p.oid, 'execute') as srv,
             p.prosecdef as definer,
             p.proconfig @> array['search_path=""'] as caminho
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and (p.proname like 'agenda\\_kickoff\\_zoom\\_inscric%' or p.proname like '\\_agenda\\_kickoff\\_zoom\\_inscric%'
             or p.proname in ('_agenda_kickoff_zoom_estado', 'agenda_kickoff_zoom_acessos', 'agenda_kickoff_zoom_reserva_do_convite'))`);
    expect(funcoes.rows).toHaveLength(8);
    for (const f of funcoes.rows) expect(f).toMatchObject({ anon: false, aut: false, pub: false, srv: true, definer: true, caminho: true });
    for (const papel of ['anon', 'authenticated']) {
      for (const tabela of ['agenda_kickoff_zoom_inscricoes', 'agenda_kickoff_zoom_inscricoes_historico']) {
        const p = await um<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
          `select has_table_privilege($1, $2, 'select') as s, has_table_privilege($1, $2, 'insert') as i, has_table_privilege($1, $2, 'update') as u, has_table_privilege($1, $2, 'delete') as d`,
          [papel, `public.${tabela}`],
        );
        expect(p).toEqual({ s: false, i: false, u: false, d: false });
      }
    }
    const rls = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid in ('public.agenda_kickoff_zoom_inscricoes'::regclass, 'public.agenda_kickoff_zoom_inscricoes_historico'::regclass)",
    );
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
    expect((await um<{ n: number }>("select count(*)::int as n from pg_policies where tablename like 'agenda_kickoff_zoom_inscricoes%'")).n).toBe(0);
  });

  it('gerar, falhar, reaproveitar e trocar de sala não alteram reuniões, sessões, reservas, empresas nem convites', async () => {
    const { reserva, empresa } = await cenario();
    await convite(empresa.id);
    const comum = '2c000000-0000-4000-8000-000000000001';
    await db.exec(`insert into public.meetings (id, tenant_id, host_id, title, scheduled_start_at, scheduled_end_at, status, room_name)
      values ('${comum}', '${empresa.id}', '${GESTOR}', 'Reunião comum', now() + interval '1 day', now() + interval '1 day 1 hour', 'scheduled', 'comum-1')`);
    const foto = () =>
      um<Record<string, string>>(`select
        (select md5(string_agg(t::text, '|' order by t::text)) from public.meetings t) as reunioes,
        (select md5(string_agg(t::text, '|' order by t::text)) from public.agenda_kickoff_sessoes t) as sessoes,
        (select md5(string_agg(t::text, '|' order by t::text)) from public.agenda_kickoff_reservas t) as reservas,
        (select md5(string_agg(t::text, '|' order by t::text)) from public.agenda_kickoff_reservas_historico t) as historico,
        (select md5(string_agg(t::text, '|' order by t::text)) from public.client_tenants t) as empresas,
        (select md5(string_agg(t::text, '|' order by t::text)) from public.agenda_kickoff_convites t) as convites`);
    const antes = await foto();
    zoom.falhaAoInscrever = new ZoomApiError(500, null, 'x');
    await garantir(reserva);
    zoom.falhaAoInscrever = null;
    await garantir(reserva, 'tentar_de_novo', GESTOR);
    await garantir(reserva);
    await ativarSala(SALA_B, 'troca');
    await garantir(reserva, 'tentar_de_novo', GESTOR);
    await chamar('agenda_kickoff_zoom_inscricao_entregue', { p_id: (await inscricoes(await emailDa(reserva)))[1].id });
    expect(await foto()).toEqual(antes);
    expect((await inscricoes(await emailDa(reserva)))[1].acessos).toBe(1);
  });
});
