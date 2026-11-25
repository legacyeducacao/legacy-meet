import { describe, expect, it } from 'vitest';
import { ehDaCarteira, filtroCarteira } from './carteira';

describe('carteira do executor', () => {
  it('executor principal e executor financeiro do cliente têm o cliente na carteira', () => {
    expect(ehDaCarteira({ executorId: 'exec', executorFinanceiroId: 'fin' }, 'exec')).toBe(true);
    expect(ehDaCarteira({ executorId: 'exec', executorFinanceiroId: 'fin' }, 'fin')).toBe(true);
  });

  it('quem não é nenhum dos dois não tem; cliente sem executor financeiro não libera ninguém a mais', () => {
    expect(ehDaCarteira({ executorId: 'exec', executorFinanceiroId: 'fin' }, 'outro')).toBe(false);
    expect(ehDaCarteira({ executorId: null, executorFinanceiroId: null }, 'outro')).toBe(false);
    expect(ehDaCarteira({ executorId: 'exec' }, 'fin')).toBe(false);
  });

  it('filtro da lista de clientes cobre as duas colunas', () => {
    expect(filtroCarteira('u1')).toBe('executor_id.eq.u1,executor_financeiro_id.eq.u1');
  });
});
