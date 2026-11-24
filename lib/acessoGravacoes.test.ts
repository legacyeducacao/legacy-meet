import { describe, expect, it } from 'vitest';
import { PERMISSAO_VER_TODAS_GRAVACOES, podeVerGravacao } from './acessoGravacoes';
import { alternarCapacidade, lerCapacidades } from './kickoff/regras';

const com = { hostId: 'outro', coHostIds: [], sector: 'comercial' };
const exe = { hostId: 'outro', coHostIds: [], sector: 'executoria' };
const avulsa = { hostId: 'outro', coHostIds: [], sector: 'avulsa' };
const semSetor = { hostId: 'outro', coHostIds: [], sector: null };
const pessoa = (sector: string | null, extra: Partial<{ isAdmin: boolean; capacidades: string[] }> = {}) => ({
  id: 'eu',
  isAdmin: false,
  sector,
  ...extra,
});

describe('quem vê cada gravação', () => {
  it('Comercial vê todas do Comercial e nenhuma da Executoria', () => {
    expect(podeVerGravacao(pessoa('comercial'), com)).toBe(true);
    expect(podeVerGravacao(pessoa('comercial'), exe)).toBe(false);
  });

  it('Executoria vê todas da Executoria (de qualquer executor) e nenhuma do Comercial', () => {
    expect(podeVerGravacao(pessoa('executoria'), exe)).toBe(true);
    expect(podeVerGravacao(pessoa('executoria'), com)).toBe(false);
  });

  it('Acesso geral vê Comercial e Executoria', () => {
    expect(podeVerGravacao(pessoa('ambos'), com)).toBe(true);
    expect(podeVerGravacao(pessoa('ambos'), exe)).toBe(true);
  });

  it('avulsa e sem setor: só anfitriões, admin e a permissão', () => {
    expect(podeVerGravacao(pessoa('ambos'), avulsa)).toBe(false);
    expect(podeVerGravacao(pessoa('executoria'), semSetor)).toBe(false);
    expect(podeVerGravacao(pessoa('executoria'), { ...avulsa, coHostIds: ['eu'] })).toBe(true);
    expect(podeVerGravacao(pessoa(null), { ...avulsa, hostId: 'eu' })).toBe(true);
  });

  it('a própria reunião (dono ou anfitrião adicional) sempre, mesmo de outro setor', () => {
    expect(podeVerGravacao(pessoa('executoria'), { ...com, hostId: 'eu' })).toBe(true);
    expect(podeVerGravacao(pessoa('comercial'), { ...exe, coHostIds: ['eu'] })).toBe(true);
  });

  it('admin e quem tem "Ver todas as gravações" veem tudo', () => {
    for (const u of [pessoa('comercial', { isAdmin: true }), pessoa('comercial', { capacidades: [PERMISSAO_VER_TODAS_GRAVACOES] })]) {
      for (const g of [com, exe, avulsa, semSetor]) expect(podeVerGravacao(u, g)).toBe(true);
    }
  });

  it('a permissão convive com a do kickoff no perfil', () => {
    const caps = alternarCapacidade(['kickoff_impulsao.manage'], PERMISSAO_VER_TODAS_GRAVACOES, true);
    expect(lerCapacidades({ capacidades: caps })).toEqual(['kickoff_impulsao.manage', PERMISSAO_VER_TODAS_GRAVACOES]);
    expect(alternarCapacidade(caps, PERMISSAO_VER_TODAS_GRAVACOES, false)).toEqual(['kickoff_impulsao.manage']);
  });
});
