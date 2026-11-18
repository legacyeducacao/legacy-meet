import { beforeEach, describe, expect, it, vi } from 'vitest';

// Banco falso: registra cada escrita; nada toca o Supabase de verdade.
const state = vi.hoisted(() => ({
  usuario: null as { id: string; name: string; email: string } | null,
  futuras: 0,
  escritas: [] as Array<{ tabela: string; op: string; valor?: unknown }>,
  auth: [] as Array<{ id: string; attrs: Record<string, unknown> }>,
}));

vi.mock('@/lib/supabase/admin', () => {
  // Consulta encadeável: qualquer filtro devolve a mesma consulta.
  const consulta = (tabela: string) => {
    const q: any = {
      select: (_c?: string, opts?: { head?: boolean }) => {
        q.contar = !!opts?.head;
        return q;
      },
      eq: () => q,
      in: () => q,
      gte: () => q,
      maybeSingle: async () => ({ data: tabela === 'users' ? state.usuario : null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        resolve(q.contar ? { count: state.futuras, error: null } : { data: [], error: null }),
      upsert: async (valor: unknown) => (state.escritas.push({ tabela, op: 'upsert', valor }), { error: null }),
      update: (valor: unknown) => {
        state.escritas.push({ tabela, op: 'update', valor });
        return { eq: async () => ({ error: null }) };
      },
      delete: () => {
        state.escritas.push({ tabela, op: 'delete' });
        return q;
      },
    };
    return q;
  };
  return {
    createAdminSupabase: () => ({
      from: consulta,
      auth: {
        admin: {
          updateUserById: async (id: string, attrs: Record<string, unknown>) => (state.auth.push({ id, attrs }), { error: null }),
        },
      },
    }),
  };
});

import { emailDeRemovido, removerUsuario } from './remover';

beforeEach(() => {
  state.usuario = { id: 'u1', name: 'Raul Kammers', email: 'raul.kammers@legacyeducacaocorp.com.br' };
  state.futuras = 0;
  state.escritas = [];
  state.auth = [];
});

const nadaMudou = () => {
  expect(state.escritas).toHaveLength(0);
  expect(state.auth).toHaveLength(0);
};

describe('removerUsuario', () => {
  it('apaga o acesso em todos os projetos e mantém o nome', async () => {
    const r = await removerUsuario('u1', 'adm');
    expect(r).toEqual({ ok: true, nome: 'Raul Kammers' });
    expect(state.auth).toHaveLength(1);
    expect(state.auth[0].attrs).toMatchObject({ email: emailDeRemovido('u1'), email_confirm: true, ban_duration: '876000h' });
    expect(String(state.auth[0].attrs.password).length).toBeGreaterThan(30);
    const users = state.escritas.find((e) => e.tabela === 'users');
    expect(users?.valor).toMatchObject({ email: emailDeRemovido('u1'), phone: null, cpf_cnpj: null });
    expect(users?.valor).not.toHaveProperty('name');
    expect(state.escritas).toContainEqual({ tabela: 'meet_user_profile', op: 'delete' });
    const registro = state.escritas.find((e) => e.tabela === 'meet_usuarios_removidos');
    expect(registro?.valor).toMatchObject({ user_id: 'u1', nome: 'Raul Kammers', email_antigo: 'raul.kammers@legacyeducacaocorp.com.br', removido_por: 'adm' });
  });

  it('o admin não remove a si mesmo', async () => {
    expect(await removerUsuario('adm', 'adm')).toMatchObject({ ok: false, status: 400 });
    nadaMudou();
  });

  it('cliente do Plan (e-mail fora da equipe) não se remove por aqui', async () => {
    state.usuario = { id: 'u1', name: 'Cliente', email: 'dono@empresa.com' };
    expect(await removerUsuario('u1', 'adm')).toMatchObject({ ok: false, status: 400 });
    nadaMudou();
  });

  it('com reunião futura como dono: recusa e não mexe em nada', async () => {
    state.futuras = 3;
    const r = await removerUsuario('u1', 'adm');
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(r.ok ? '' : r.message).toContain('3 reuniões futuras');
    nadaMudou();
  });

  it('usuário inexistente: 404', async () => {
    state.usuario = null;
    expect(await removerUsuario('u9', 'adm')).toMatchObject({ ok: false, status: 404 });
    nadaMudou();
  });
});
