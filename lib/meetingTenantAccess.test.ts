import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from './auth';
import { autorizarEmpresaDaReuniao, type BuscarCliente } from './meetingTenantAccess';

const EMPRESA_A = '11111111-1111-4111-8111-111111111111'; // carteira do executor X
const EMPRESA_B = '22222222-2222-4222-8222-222222222222'; // carteira do executor Y
const SEM_EXECUTOR = '33333333-3333-4333-8333-333333333333';
const INEXISTENTE = '44444444-4444-4444-8444-444444444444';
const COMERCIAL = '99999999-9999-4999-8999-999999999999';

const mk = (over: Partial<CurrentUser>): CurrentUser => ({
  id: 'u',
  email: 'u@legacyeducacaocorp.com.br',
  name: 'U',
  role: 'EXECUTOR',
  isStaff: true,
  isAdmin: false,
  sector: 'executoria',
  ...over,
});

const executorX = mk({ id: 'exec-x' });
const admin = mk({ id: 'adm', isAdmin: true, sector: 'ambos', role: 'MASTER' });
const comercial = mk({ id: 'com', sector: 'comercial', role: 'COLLABORATOR' });
// Conta de cliente do Plan (mesmo Auth): sem perfil no Meet e e-mail de fora.
const clienteDaEmpresaA = mk({ id: 'cli-a', isStaff: false, sector: null, role: 'CLIENT', email: 'dono@empresa-a.com' });
// Equipe Legacy só pelo domínio do e-mail, sem perfil e sem carteira.
const equipeSemCarteira = mk({ id: 'novo', sector: null, role: 'COLLABORATOR' });

const carteira: Record<string, string | null> = {
  [EMPRESA_A]: 'exec-x',
  [EMPRESA_B]: 'exec-y',
  [SEM_EXECUTOR]: null,
};

let buscar: ReturnType<typeof vi.fn<BuscarCliente>>;

beforeEach(() => {
  process.env.MEET_COMMERCIAL_TENANT_ID = COMERCIAL;
  buscar = vi.fn<BuscarCliente>(async (id) =>
    id.toLowerCase() in carteira ? { id: id.toLowerCase(), executorId: carteira[id.toLowerCase()] } : null,
  );
});
afterEach(() => {
  delete process.env.MEET_COMMERCIAL_TENANT_ID;
});

describe('autorizarEmpresaDaReuniao: Executoria', () => {
  it('executor cria para cliente da própria carteira', async () => {
    expect(await autorizarEmpresaDaReuniao(executorX, 'executoria', EMPRESA_A, buscar)).toEqual({ ok: true, tenantId: EMPRESA_A });
  });

  it('desde 25/11 todo executor agenda para cliente de outro executor e para cliente sem executor', async () => {
    expect(await autorizarEmpresaDaReuniao(executorX, 'executoria', EMPRESA_B, buscar)).toEqual({ ok: true, tenantId: EMPRESA_B });
    expect(await autorizarEmpresaDaReuniao(executorX, 'executoria', SEM_EXECUTOR, buscar)).toEqual({ ok: true, tenantId: SEM_EXECUTOR });
    expect(await autorizarEmpresaDaReuniao(admin, 'executoria', SEM_EXECUTOR, buscar)).toEqual({ ok: true, tenantId: SEM_EXECUTOR });
  });

  it('quem só tem o Comercial não agenda na Executoria (sem consultar o banco)', async () => {
    expect(await autorizarEmpresaDaReuniao(comercial, 'executoria', EMPRESA_A, buscar)).toMatchObject({ ok: false, status: 403 });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('admin cria para qualquer cliente existente', async () => {
    expect(await autorizarEmpresaDaReuniao(admin, 'executoria', EMPRESA_B, buscar)).toEqual({ ok: true, tenantId: EMPRESA_B });
  });

  it('cliente inexistente: 404, inclusive para admin', async () => {
    expect(await autorizarEmpresaDaReuniao(admin, 'executoria', INEXISTENTE, buscar)).toMatchObject({ ok: false, status: 404 });
  });

  it('cliente do Plan não cria reunião nem para a própria empresa, nem para outra (sem consultar o banco)', async () => {
    expect(await autorizarEmpresaDaReuniao(clienteDaEmpresaA, 'executoria', EMPRESA_B, buscar)).toMatchObject({ ok: false, status: 403 });
    expect(await autorizarEmpresaDaReuniao(clienteDaEmpresaA, 'executoria', EMPRESA_A, buscar)).toMatchObject({ ok: false, status: 403 });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('equipe sem setor definido pelo admin não agenda na Executoria', async () => {
    expect(await autorizarEmpresaDaReuniao(equipeSemCarteira, 'executoria', EMPRESA_A, buscar)).toMatchObject({ ok: false, status: 403 });
  });

  it('o id que segue é o do banco, não o texto do corpo', async () => {
    const r = await autorizarEmpresaDaReuniao(executorX, 'executoria', `  ${EMPRESA_A.toUpperCase()} `, buscar);
    expect(r).toEqual({ ok: true, tenantId: EMPRESA_A });
  });

  it('sem cliente: 400; id malformado: 404 sem consultar o banco', async () => {
    expect(await autorizarEmpresaDaReuniao(executorX, 'executoria', undefined, buscar)).toMatchObject({ ok: false, status: 400 });
    expect(await autorizarEmpresaDaReuniao(executorX, 'executoria', { id: EMPRESA_A }, buscar)).toMatchObject({ ok: false, status: 400 });
    expect(await autorizarEmpresaDaReuniao(executorX, 'executoria', "x' or 1=1", buscar)).toMatchObject({ ok: false, status: 404 });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('falha do banco: 500 (não libera)', async () => {
    const quebrado = vi.fn<BuscarCliente>(async () => {
      throw new Error('timeout');
    });
    expect(await autorizarEmpresaDaReuniao(admin, 'executoria', EMPRESA_A, quebrado)).toMatchObject({ ok: false, status: 500 });
  });
});

describe('autorizarEmpresaDaReuniao: Comercial', () => {
  it('usa sempre a empresa sentinela e ignora o tenantId do corpo', async () => {
    expect(await autorizarEmpresaDaReuniao(comercial, 'comercial', EMPRESA_B, buscar)).toEqual({ ok: true, tenantId: COMERCIAL });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('admin também cria no Comercial', async () => {
    expect(await autorizarEmpresaDaReuniao(admin, 'comercial', undefined, buscar)).toEqual({ ok: true, tenantId: COMERCIAL });
  });

  it('quem não tem acesso ao Comercial não cria', async () => {
    expect(await autorizarEmpresaDaReuniao(executorX, 'comercial', undefined, buscar)).toMatchObject({ ok: false, status: 403 });
    expect(await autorizarEmpresaDaReuniao(clienteDaEmpresaA, 'comercial', undefined, buscar)).toMatchObject({ ok: false, status: 403 });
  });

  it('sem a sentinela configurada: 400 (como antes)', async () => {
    delete process.env.MEET_COMMERCIAL_TENANT_ID;
    expect(await autorizarEmpresaDaReuniao(comercial, 'comercial', undefined, buscar)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('autorizarEmpresaDaReuniao: Avulsa (sem cliente)', () => {
  afterEach(() => {
    delete process.env.MEET_AVULSA_TENANT_ID;
  });

  it('toda a equipe cria, sempre na empresa interna (tenantId do corpo ignorado e banco não consultado)', async () => {
    for (const u of [executorX, comercial, equipeSemCarteira, admin]) {
      expect(await autorizarEmpresaDaReuniao(u, 'avulsa', EMPRESA_B, buscar)).toEqual({ ok: true, tenantId: COMERCIAL });
    }
    expect(buscar).not.toHaveBeenCalled();
  });

  it('usa MEET_AVULSA_TENANT_ID quando configurada', async () => {
    process.env.MEET_AVULSA_TENANT_ID = SEM_EXECUTOR;
    expect(await autorizarEmpresaDaReuniao(executorX, 'avulsa', undefined, buscar)).toEqual({ ok: true, tenantId: SEM_EXECUTOR });
  });

  it('cliente do Plan não cria reunião avulsa', async () => {
    expect((await autorizarEmpresaDaReuniao(clienteDaEmpresaA, 'avulsa', undefined, buscar)).ok).toBe(false);
  });
});
