import { describe, expect, it } from 'vitest';
import { agendaParaCloser, funcaoParaSetor, lerFuncaoComercial } from './funcao';
import { podeAlterarReuniao } from '@/lib/agenda/regras';

describe('função no Comercial', () => {
  it('lê só valores conhecidos do perfil (coluna ausente = sem função)', () => {
    expect(lerFuncaoComercial({ funcao_comercial: 'sdr' })).toBe('sdr');
    expect(lerFuncaoComercial({ funcao_comercial: 'closer' })).toBe('closer');
    expect(lerFuncaoComercial({ funcao_comercial: 'gerente' })).toBeNull();
    expect(lerFuncaoComercial({})).toBeNull();
    expect(lerFuncaoComercial(null)).toBeNull();
  });

  it('só quem tem acesso ao Comercial tem função', () => {
    expect(funcaoParaSetor('sdr', 'comercial')).toBe('sdr');
    expect(funcaoParaSetor('closer', 'ambos')).toBe('closer');
    expect(funcaoParaSetor('closer', 'executoria')).toBeNull();
    expect(funcaoParaSetor('sdr', null)).toBeNull();
    expect(funcaoParaSetor(null, 'comercial')).toBeNull();
  });

  it('SDR agendando no Comercial precisa do Closer; na Executoria e no kickoff, não', () => {
    const sdr = { funcaoComercial: 'sdr' as const };
    expect(agendaParaCloser(sdr, 'comercial')).toBe(true);
    expect(agendaParaCloser(sdr, 'executoria')).toBe(false);
    expect(agendaParaCloser(sdr, 'comercial', true)).toBe(false);
    expect(agendaParaCloser({ funcaoComercial: 'closer' }, 'comercial')).toBe(false);
    expect(agendaParaCloser({ funcaoComercial: null }, 'comercial')).toBe(false);
    expect(agendaParaCloser(null, 'comercial')).toBe(false);
  });
});

describe('podeAlterarReuniao', () => {
  const base = { userId: 'sdr', isAdmin: false, hostId: 'closer', setor: 'comercial', coHostIds: ['sdr'] };

  it('SDR que agendou para o Closer (anfitrião adicional no Comercial) remarca e cancela', () => {
    expect(podeAlterarReuniao(base)).toBe(true);
  });

  it('dono e admin continuam podendo', () => {
    expect(podeAlterarReuniao({ ...base, userId: 'closer', coHostIds: [] })).toBe(true);
    expect(podeAlterarReuniao({ ...base, userId: 'adm', isAdmin: true, coHostIds: [] })).toBe(true);
  });

  it('na Executoria o anfitrião adicional continua sem alterar (regra de antes)', () => {
    expect(podeAlterarReuniao({ ...base, setor: 'executoria' })).toBe(false);
  });

  it('quem não é anfitrião não altera', () => {
    expect(podeAlterarReuniao({ ...base, userId: 'outro' })).toBe(false);
  });
});
