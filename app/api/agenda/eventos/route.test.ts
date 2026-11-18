import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { CurrentUser } from '@/lib/auth';
import type { CriarReunioesInput } from '@/lib/meetingsCore';

// Banco, Google Agenda e motor de conflitos falsos: nada toca o Supabase de verdade.
const state = vi.hoisted(() => ({
  user: null as CurrentUser | null,
  carteira: new Map<string, string | null>(), // client_tenants.id -> executor_id
  criadas: [] as CriarReunioesInput[],
  inserts: [] as Array<{ table: string; row: unknown }>,
  /** Executores pedidos a listarReunioes e quantas vezes as turmas foram lidas (GET). */
  executoresListados: [] as string[][],
  leiturasDeTurmas: 0,
  /** Kickoff: tabela ausente (migration pendente), falha ao marcar, reuniões desfeitas. */
  semTabelaKickoff: false,
  falhaMarcarKickoff: false,
  apagadas: [] as string[],
  /** Conflitos devolvidos pelo motor (padrão: nenhum). */
  conflitos: [] as unknown[],
  /** De quem foi a agenda conferida (executor e opções). */
  contextos: [] as Array<{ executorId: string; opts: unknown }>,
}));

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getCurrentUser: async () => state.user,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      if (table === 'client_tenants') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              // O Postgres compara uuid sem diferenciar maiúsculas; o fake imita.
              maybeSingle: async () => {
                const k = id.toLowerCase();
                return state.carteira.has(k)
                  ? { data: { id: k, executor_id: state.carteira.get(k) }, error: null }
                  : { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'agenda_kickoff_sessoes') {
        const erro = { code: 'PGRST205', message: "Could not find the table 'public.agenda_kickoff_sessoes'" };
        return {
          select: () => ({ limit: async () => ({ data: [], error: state.semTabelaKickoff ? erro : null }) }),
          insert(row: unknown) {
            state.inserts.push({ table, row });
            return Promise.resolve({ error: state.falhaMarcarKickoff ? { message: 'falhou' } : null });
          },
        };
      }
      if (table === 'meetings') {
        return { delete: () => ({ in: async (_c: string, ids: string[]) => (state.apagadas.push(...ids), { error: null }) }) };
      }
      return {
        insert(row: unknown) {
          state.inserts.push({ table, row });
          const id = table === 'agenda_series' ? 'serie-1' : table === 'agenda_jornadas' ? 'jornada-1' : 'x';
          return {
            select: () => ({ single: async () => ({ data: { id }, error: null }) }),
            then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
          };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  }),
}));

vi.mock('@/lib/meetingsCore', () => ({
  criarReunioes: async (i: CriarReunioesInput) => {
    state.criadas.push(i);
    return { ok: true, ids: i.ocorrencias.map((_, k) => `m${k}`), roomNames: i.ocorrencias.map((_, k) => `sala-${k}`) };
  },
}));

vi.mock('@/lib/meetingHosts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meetingHosts')>()),
  listTeamMembers: async () => [{ id: 'exec-z', name: 'Z', email: 'z@legacyeducacaocorp.com.br' }],
}));

vi.mock('@/lib/agenda/servidor', () => ({
  FUSO: 'America/Sao_Paulo',
  podeUsarAgendaNova: async (u: unknown) => !!u,
  carregarConfig: async () => ({ horizonteMeses: 6, expediente: [], regras: {}, niveis: {}, considerarFacultativos: false }),
  carregarFeriados: async () => [],
  contextoExecutor: async (executorId: string, _de: Date, _ate: Date, _cfg: unknown, opts: unknown) => {
    state.contextos.push({ executorId, opts });
    return {};
  },
  registrarSobreposicoes: async () => undefined,
  feriadosParaDTO: () => [],
  listarReunioes: async (_u: unknown, executores: string[]) => {
    state.executoresListados.push(executores);
    return [{ id: 'reuniao', link: 'https://meet.example/rooms/x' }];
  },
  listarBloqueios: async () => [],
  listarTurmas: async () => {
    state.leiturasDeTurmas++;
    return [{ id: 'aula', link: 'https://zoom.example/aula' }];
  },
}));

vi.mock('@/lib/comercial/closers', () => ({
  listarClosers: async () => [{ id: 'closer-1', name: 'Closer Um', email: 'closer1@legacyeducacaocorp.com.br' }],
}));

// Conflitos controlados pelo teste (padrão: nenhum). O foco aqui é a empresa e
// o kickoff; a detecção de sobreposição tem teste próprio (lib/kickoff/agenda.test.ts).
vi.mock('@/lib/agenda-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agenda-engine')>()),
  validarConflitos: () => state.conflitos,
}));

import { GET, POST } from './route';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111'; // carteira do executor X
const EMPRESA_B = '22222222-2222-4222-8222-222222222222'; // carteira do executor Y
const COMERCIAL = '99999999-9999-4999-8999-999999999999';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u', email: 'u@legacyeducacaocorp.com.br', name: 'U', role: 'EXECUTOR',
  isStaff: true, isAdmin: false, sector: 'executoria', ...over,
});
const executorX = mk({ id: 'exec-x' });
const admin = mk({ id: 'adm', isAdmin: true, sector: 'ambos', role: 'MASTER' });
const comercial = mk({ id: 'com', sector: 'comercial', role: 'COLLABORATOR' });
const equipeSemCarteira = mk({ id: 'novo', sector: null, role: 'COLLABORATOR' });
const clienteDaEmpresaA = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest('https://meet.example/api/agenda/eventos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        titulo: 'Reunião',
        inicio: '2026-12-01T13:00:00.000Z',
        fim: '2026-12-01T14:00:00.000Z',
        ...body,
      }),
    }),
  );
const nadaCriado = () => {
  expect(state.criadas).toHaveLength(0);
  expect(state.inserts).toHaveLength(0);
};

beforeEach(() => {
  process.env.MEET_COMMERCIAL_TENANT_ID = COMERCIAL;
  state.user = null;
  state.criadas = [];
  state.inserts = [];
  state.executoresListados = [];
  state.leiturasDeTurmas = 0;
  state.semTabelaKickoff = false;
  state.falhaMarcarKickoff = false;
  state.apagadas = [];
  state.conflitos = [];
  state.contextos = [];
  delete process.env.MEET_KICKOFF_TENANT_ID;
  state.carteira = new Map([
    [EMPRESA_A, 'exec-x'],
    [EMPRESA_B, 'exec-y'],
  ]);
});

describe('POST /api/agenda/eventos: autorização por empresa', () => {
  it('sem sessão: bloqueado (403, resposta que a rota já dava) e nada é criado', async () => {
    const res = await post({ setor: 'executoria', tenantId: EMPRESA_A });
    expect(res.status).toBe(403);
    nadaCriado();
  });

  it('executor cria evento para cliente da sua carteira', async () => {
    state.user = executorX;
    const res = await post({ setor: 'executoria', tenantId: EMPRESA_A });
    expect(res.status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ tenantId: EMPRESA_A, hostId: 'exec-x', sector: 'executoria' });
  });

  it('executor não cria evento para empresa de outra carteira', async () => {
    state.user = executorX;
    const res = await post({ setor: 'executoria', tenantId: EMPRESA_B, rrule: 'FREQ=WEEKLY;COUNT=4', jornadaLegado: true });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Só clientes da sua carteira');
    nadaCriado();
  });

  it('equipe sem carteira não usa tenantId arbitrário', async () => {
    state.user = equipeSemCarteira;
    expect((await post({ setor: 'executoria', tenantId: EMPRESA_A })).status).toBe(403);
    nadaCriado();
  });

  it('cliente do Plan não cria evento nem para outra empresa nem para a própria', async () => {
    state.user = clienteDaEmpresaA;
    expect((await post({ setor: 'executoria', tenantId: EMPRESA_B, guestEmails: ['alvo@empresa-b.com'] })).status).toBe(403);
    expect((await post({ setor: 'executoria', tenantId: EMPRESA_A })).status).toBe(403);
    nadaCriado();
  });

  it('Comercial: quem tem acesso cria, sempre na empresa sentinela (tenantId do corpo ignorado)', async () => {
    state.user = comercial;
    const res = await post({ setor: 'comercial', tenantId: EMPRESA_B });
    expect(res.status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ tenantId: COMERCIAL, sector: 'comercial', hostId: 'com' });
  });

  it('Comercial: executor só da Executoria e cliente do Plan não criam', async () => {
    state.user = executorX;
    expect((await post({ setor: 'comercial' })).status).toBe(403);
    state.user = clienteDaEmpresaA;
    expect((await post({ setor: 'comercial', tenantId: EMPRESA_A })).status).toBe(403);
    nadaCriado();
  });

  it('admin cria para qualquer cliente, inclusive agendando para outro executor', async () => {
    state.user = admin;
    expect((await post({ setor: 'executoria', tenantId: EMPRESA_B })).status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ tenantId: EMPRESA_B, hostId: 'adm' });
    expect((await post({ setor: 'executoria', tenantId: EMPRESA_B, executorId: 'exec-z' })).status).toBe(200);
    expect(state.criadas[1]).toMatchObject({ tenantId: EMPRESA_B, hostId: 'exec-z' });
  });

  it('série com jornada do Legado grava o id validado no banco, não o texto do corpo', async () => {
    state.user = executorX;
    const res = await post({
      setor: 'executoria',
      tenantId: `  ${EMPRESA_A.toUpperCase()} `,
      rrule: 'FREQ=WEEKLY;COUNT=2',
      jornadaLegado: true,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ocorrencias).toBe(2);
    expect(state.criadas[0].tenantId).toBe(EMPRESA_A);
    const linha = (t: string) => state.inserts.find((i) => i.table === t)?.row as Record<string, unknown>;
    expect(linha('agenda_series')).toMatchObject({ tenant_id: EMPRESA_A, executor_id: 'exec-x' });
    expect(linha('agenda_jornadas')).toMatchObject({ tenant_id: EMPRESA_A, encontros_previstos: 2 });
  });

  it('sem cliente: 400 com a mesma mensagem que o formulário já mostra', async () => {
    state.user = executorX;
    const res = await post({ setor: 'executoria' });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Selecione o cliente');
    nadaCriado();
  });
});

describe('GET /api/agenda/eventos: quem pode ler a agenda', () => {
  const get = (qs = '') =>
    GET(new NextRequest(`https://meet.example/api/agenda/eventos?de=2026-12-01T00:00:00.000Z&ate=2026-12-08T00:00:00.000Z${qs}`));

  it('sem sessão: bloqueado e nada é lido', async () => {
    expect((await get()).status).toBe(403);
    expect(state.executoresListados).toHaveLength(0);
    expect(state.leiturasDeTurmas).toBe(0);
  });

  it('cliente do Plan não recebe eventos nem links de reuniões e aulas', async () => {
    state.user = clienteDaEmpresaA;
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('https://');
    expect(state.executoresListados).toHaveLength(0);
    expect(state.leiturasDeTurmas).toBe(0);
  });

  it('executor continua vendo a própria agenda; o filtro de outros executores segue só para admin', async () => {
    state.user = executorX;
    const res = await get('&executores=exec-y,exec-z');
    expect(res.status).toBe(200);
    expect((await res.json()).eventos.map((e: { id: string }) => e.id)).toEqual(['reuniao', 'aula']);
    expect(state.executoresListados).toEqual([['exec-x']]);
  });

  it('admin continua vendo a agenda de outros executores', async () => {
    state.user = admin;
    expect((await get('&executores=exec-y,exec-z')).status).toBe(200);
    expect(state.executoresListados).toEqual([['exec-y', 'exec-z']]);
  });

  it('equipe do Comercial também lê a agenda', async () => {
    state.user = comercial;
    expect((await get()).status).toBe(200);
    expect(state.executoresListados).toEqual([['com']]);
  });
});

describe('POST /api/agenda/eventos: sessão de kickoff do Impulsão (M1)', () => {
  const ORG = '77777777-7777-4777-8777-777777777777'; // empresa organizadora interna
  const gestorKickoff = mk({ id: 'cs-1', role: 'CUSTOMER_SUCCESS', capacidades: ['kickoff_impulsao.manage'] });
  const kickoff = (body: Record<string, unknown> = {}) => post({ titulo: 'Kickoff Impulsão', tipo: 'kickoff_impulsao', ...body });
  const marcadas = () => state.inserts.filter((i) => i.table === 'agenda_kickoff_sessoes').flatMap((i) => i.row as Array<Record<string, unknown>>);

  beforeEach(() => {
    process.env.MEET_KICKOFF_TENANT_ID = ORG;
    state.carteira.set(ORG, null);
  });

  it('quem gerencia kickoffs cria a sessão na agenda: empresa organizadora, sem sala gravada, sem Google, fora do ExecScore', async () => {
    state.user = gestorKickoff;
    // tenantId e convidados do corpo são ignorados no kickoff.
    const res = await kickoff({ tenantId: EMPRESA_B, guestEmails: ['alguem@empresa-b.com'], gravar: true, transcrever: true });
    expect(res.status).toBe(200);
    expect(state.criadas).toHaveLength(1);
    expect(state.criadas[0]).toMatchObject({
      tenantId: ORG,
      hostId: 'cs-1',
      sector: 'executoria',
      onboarding: true,
      record: false,
      transcribe: false,
      googleAgenda: false,
      guestEmails: [],
    });
    expect(marcadas()).toEqual([{ meeting_id: 'm0', capacidade: 5, criado_por: 'cs-1' }]);
  });

  it('série semanal: uma sessão marcada por ocorrência, e a série guarda o mesmo perfil', async () => {
    state.user = gestorKickoff;
    const res = await kickoff({ rrule: 'FREQ=WEEKLY;COUNT=3', capacidade: 8 });
    expect(res.status).toBe(200);
    expect((await res.json()).ocorrencias).toBe(3);
    expect(marcadas().map((m) => [m.meeting_id, m.capacidade])).toEqual([
      ['m0', 8],
      ['m1', 8],
      ['m2', 8],
    ]);
    const serie = state.inserts.find((i) => i.table === 'agenda_series')?.row as Record<string, unknown>;
    expect(serie).toMatchObject({ tenant_id: ORG, onboarding: true, gravar: false, transcrever: false });
  });

  it('admin global também cria', async () => {
    state.user = admin;
    expect((await kickoff()).status).toBe(200);
  });

  it('equipe sem a permissão e cliente do Plan não criam kickoff', async () => {
    state.user = executorX;
    const res = await kickoff();
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Só quem gerencia os kickoffs do Impulsão cria sessões de kickoff');
    state.user = clienteDaEmpresaA;
    expect((await kickoff()).status).toBe(403);
    nadaCriado();
  });

  it('usa os conflitos da agenda: horário ocupado sem justificativa não cria', async () => {
    state.user = gestorKickoff;
    state.conflitos = [
      { ref: '0', inicio: new Date('2026-12-01T13:00:00.000Z'), tipo: 'sobreposicao', nivel: 'aviso', detalhe: 'Outra reunião', acaoSugerida: 'mover' },
    ];
    const res = await kickoff();
    expect(res.status).toBe(409);
    expect((await res.json()).conflitos[0].tipo).toBe('sobreposicao');
    nadaCriado();
  });

  it('capacidade fora de 1 a 50 é recusada', async () => {
    state.user = gestorKickoff;
    expect((await kickoff({ capacidade: 0 })).status).toBe(400);
    expect((await kickoff({ capacidade: 51 })).status).toBe(400);
    nadaCriado();
  });

  it('sem empresa organizadora configurada, ou configurada e inexistente, não cria', async () => {
    state.user = gestorKickoff;
    delete process.env.MEET_KICKOFF_TENANT_ID;
    expect((await kickoff()).status).toBe(409);
    process.env.MEET_KICKOFF_TENANT_ID = '88888888-8888-4888-8888-888888888888';
    expect((await kickoff()).status).toBe(409);
    nadaCriado();
  });

  it('antes da migration (estrutura pendente) não cria nada', async () => {
    state.user = gestorKickoff;
    state.semTabelaKickoff = true;
    const res = await kickoff();
    expect(res.status).toBe(503);
    nadaCriado();
  });

  it('se a marcação falhar, as reuniões criadas são desfeitas (não viram reuniões comuns)', async () => {
    state.user = gestorKickoff;
    state.falhaMarcarKickoff = true;
    const res = await kickoff({ rrule: 'FREQ=WEEKLY;COUNT=2' });
    expect(res.status).toBe(500);
    expect(state.apagadas).toEqual(['m0', 'm1']);
    expect(state.inserts.some((i) => i.table === 'agenda_series')).toBe(false);
  });

  it('reunião comum continua com Google Agenda e com as regras de antes', async () => {
    state.user = executorX;
    const res = await post({ setor: 'executoria', tenantId: EMPRESA_A });
    expect(res.status).toBe(200);
    expect(state.criadas[0].googleAgenda).toBe(true);
    expect(state.criadas[0].tenantId).toBe(EMPRESA_A);
    expect(marcadas()).toHaveLength(0);
  });
});

describe('POST /api/agenda/eventos: SDR agenda para o Closer', () => {
  const sdr = mk({ id: 'sdr-1', sector: 'comercial', role: 'COLLABORATOR', funcaoComercial: 'sdr' });
  const closer = mk({ id: 'closer-1', sector: 'comercial', role: 'COLLABORATOR', funcaoComercial: 'closer' });

  it('o Closer escolhido vira o dono, o SDR fica como anfitrião e a agenda conferida é a do Closer', async () => {
    state.user = sdr;
    const res = await post({ setor: 'comercial', closerId: 'closer-1', coHostIds: ['exec-z', 'closer-1'] });
    expect(res.status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ hostId: 'closer-1', tenantId: COMERCIAL, sector: 'comercial' });
    expect(state.criadas[0].coHostIds).toEqual(['sdr-1', 'exec-z']);
    expect(state.contextos).toEqual([{ executorId: 'closer-1', opts: { coAnfitriao: true } }]);
  });

  it('SDR sem Closer, ou com alguém que não é Closer, não cria', async () => {
    state.user = sdr;
    const sem = await post({ setor: 'comercial' });
    expect(sem.status).toBe(400);
    expect(await sem.text()).toBe('Escolha o Closer responsável');
    expect((await post({ setor: 'comercial', closerId: 'exec-z' })).status).toBe(400);
    nadaCriado();
  });

  it('Closer ocupado no horário: não cria, mesmo com justificativa (só admin passa por cima)', async () => {
    state.user = sdr;
    state.conflitos = [
      { ref: '0', inicio: new Date('2026-12-01T13:00:00.000Z'), tipo: 'sobreposicao', nivel: 'bloqueante', detalhe: 'Sessão Estratégica', acaoSugerida: 'mover' },
    ];
    const res = await post({ setor: 'comercial', closerId: 'closer-1', justificativa: 'quero marcar' });
    expect(res.status).toBe(409);
    expect((await res.json()).podeSobreporBloqueante).toBe(false);
    nadaCriado();
  });

  it('o Closer agendando a própria reunião continua dono, e a agenda dele conta as reuniões como anfitrião adicional', async () => {
    state.user = closer;
    expect((await post({ setor: 'comercial' })).status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ hostId: 'closer-1' });
    expect(state.contextos[0]).toEqual({ executorId: 'closer-1', opts: { coAnfitriao: true } });
  });

  it('SDR com acesso geral agendando na Executoria segue a regra de sempre (sem Closer)', async () => {
    state.user = mk({ id: 'exec-x', sector: 'ambos', funcaoComercial: 'sdr' });
    expect((await post({ setor: 'executoria', tenantId: EMPRESA_A })).status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ hostId: 'exec-x' });
  });
});

describe('POST /api/agenda/eventos: reunião avulsa', () => {
  it('qualquer pessoa da equipe cria sem cliente, na empresa interna, com Google Agenda', async () => {
    for (const u of [executorX, comercial]) {
      state.user = u;
      state.criadas = [];
      const res = await post({ setor: 'avulsa', tenantId: EMPRESA_B, guestEmails: 'parceiro@empresa.com' });
      expect(res.status).toBe(200);
      expect(state.criadas[0]).toMatchObject({ sector: 'avulsa', tenantId: COMERCIAL, hostId: u.id, googleAgenda: true, onboarding: false });
      expect(state.criadas[0].guestEmails).toEqual(['parceiro@empresa.com']);
    }
  });

  it('SDR na avulsa não precisa de Closer', async () => {
    state.user = mk({ id: 'sdr-1', sector: 'comercial', funcaoComercial: 'sdr' });
    expect((await post({ setor: 'avulsa' })).status).toBe(200);
    expect(state.criadas[0]).toMatchObject({ hostId: 'sdr-1', sector: 'avulsa' });
  });

  it('cliente do Plan não cria avulsa', async () => {
    state.user = clienteDaEmpresaA;
    expect((await post({ setor: 'avulsa' })).status).toBe(403);
    nadaCriado();
  });
});
