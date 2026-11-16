import { describe, expect, it } from 'vitest';
import { acoesDaReserva, erroDoBanco, pendenciasDaSessao, rotuloReserva, situacaoDaSessao, validarParticipante } from './reservasRegras';

describe('validarParticipante (mesmas regras do banco)', () => {
  it('normaliza nome, e-mail e telefone', () => {
    expect(validarParticipante({ nome: '  Ana  ', email: ' ANA@X.com.br ', telefone: '  ' })).toEqual({
      ok: true,
      participante: { nome: 'Ana', email: 'ana@x.com.br', telefone: null },
    });
  });

  it('e-mail é obrigatório; nome de 2 a 200; telefone de 8 a 15 dígitos', () => {
    expect(validarParticipante({ nome: 'Ana', email: '' })).toMatchObject({ ok: false, message: 'Informe o e-mail do participante principal.' });
    expect(validarParticipante({ nome: 'Ana', email: 'a@b' })).toMatchObject({ ok: false, message: 'E-mail do participante inválido.' });
    expect(validarParticipante({ nome: 'A', email: 'a@b.com' })).toMatchObject({ ok: false });
    expect(validarParticipante({ nome: 'x'.repeat(201), email: 'a@b.com' })).toMatchObject({ ok: false });
    expect(validarParticipante({ nome: 'Ana', email: 'a@b.com', telefone: '1234567' })).toMatchObject({ ok: false });
    expect(validarParticipante({ nome: 'Ana', email: 'a@b.com', telefone: 'abc12345678' })).toMatchObject({ ok: false });
    expect(validarParticipante({ nome: 'Ana', email: 'a@b.com', telefone: '+55 (11) 98888-7777' })).toMatchObject({ ok: true });
  });
});

describe('situacaoDaSessao', () => {
  const agora = Date.parse('2026-12-01T12:00:00Z');
  const base = { status: 'scheduled', inicio: '2026-12-02T12:00:00Z', capacidade: 5, aceitaReservas: true, ocupadas: 2 };
  it('na mesma ordem do banco: cancelada, encerrada, bloqueada, lotada, aberta', () => {
    expect(situacaoDaSessao(base, agora)).toBe('aberta');
    expect(situacaoDaSessao({ ...base, ocupadas: 5 }, agora)).toBe('lotada');
    expect(situacaoDaSessao({ ...base, ocupadas: 5, aceitaReservas: false }, agora)).toBe('bloqueada');
    expect(situacaoDaSessao({ ...base, inicio: '2026-12-01T11:00:00Z' }, agora)).toBe('encerrada');
    expect(situacaoDaSessao({ ...base, status: 'canceled', inicio: '2026-12-01T11:00:00Z' }, agora)).toBe('cancelada');
  });
});

describe('situação "em andamento" e ações por estado da reserva', () => {
  const agora = Date.parse('2026-12-01T12:30:00Z');
  const sessao = { inicio: '2026-12-01T12:00:00Z', fim: '2026-12-01T13:00:00Z' };
  it('sessão começou e não terminou: em andamento', () => {
    expect(situacaoDaSessao({ status: 'scheduled', ...sessao, capacidade: 5, aceitaReservas: true, ocupadas: 1 }, agora)).toBe('em_andamento');
  });
  it('presente só depois do início; ausente só depois do fim; concluir só com presença; reagendar só ausência', () => {
    const ativa = { status: 'ativa' as const, presenca: null };
    expect(acoesDaReserva(ativa, sessao, agora)).toMatchObject({ presente: true, ausente: false, concluir: false, remanejar: true, cancelar: true });
    expect(acoesDaReserva(ativa, sessao, Date.parse('2026-12-01T11:00:00Z'))).toMatchObject({ presente: false, ausente: false });
    expect(acoesDaReserva(ativa, sessao, Date.parse('2026-12-01T14:00:00Z'))).toMatchObject({ presente: true, ausente: true });
    expect(acoesDaReserva({ status: 'ativa', presenca: 'presente' }, sessao, agora)).toMatchObject({ concluir: true, remanejar: false, presente: false });
    expect(acoesDaReserva({ status: 'concluida', presenca: 'presente' }, sessao, agora)).toMatchObject({
      concluir: false,
      cancelar: false,
      remanejar: false,
      reagendar: false,
      participante: true,
    });
    expect(acoesDaReserva({ status: 'ausente', presenca: 'ausente' }, sessao, agora).reagendar).toBe(true);
    expect(acoesDaReserva({ status: 'ausente', presenca: 'ausente', reagendada: true }, sessao, agora).reagendar).toBe(false);
  });
  it('presença registrada não aparece como conclusão', () => {
    expect(rotuloReserva({ status: 'ativa', presenca: 'presente' })).toBe('Compareceu (conclusão pendente)');
    expect(rotuloReserva({ status: 'concluida', presenca: 'presente' })).toBe('Kickoff concluído');
    expect(rotuloReserva({ status: 'ativa', presenca: null })).toBe('Reservada');
  });
});

describe('compareceu sem concluir, correção e pendências', () => {
  const agora = Date.parse('2026-12-01T15:00:00Z');
  const sessao = { inicio: '2026-12-01T12:00:00Z', fim: '2026-12-01T13:00:00Z' };
  it('depois de comparecer: não cancela; pode concluir, registrar que não concluiu ou corrigir', () => {
    expect(acoesDaReserva({ status: 'ativa', presenca: 'presente' }, sessao, agora)).toMatchObject({
      cancelar: false,
      concluir: true,
      interromper: true,
      corrigirPresenca: true,
      reagendar: false,
    });
  });
  it('interrompida e ausente reagendam (uma vez); ausente reagendada não se corrige; concluída não se corrige', () => {
    expect(acoesDaReserva({ status: 'interrompida', presenca: 'presente' }, sessao, agora)).toMatchObject({ reagendar: true, corrigirPresenca: false, cancelar: false });
    expect(acoesDaReserva({ status: 'ausente', presenca: 'ausente' }, sessao, agora)).toMatchObject({ reagendar: true, corrigirPresenca: true });
    expect(acoesDaReserva({ status: 'ausente', presenca: 'ausente', reagendada: true }, sessao, agora)).toMatchObject({
      reagendar: false,
      corrigirPresenca: false,
    });
    expect(acoesDaReserva({ status: 'concluida', presenca: 'presente' }, sessao, agora).corrigirPresenca).toBe(false);
    expect(acoesDaReserva({ status: 'ativa', presenca: null }, sessao, agora).corrigirPresenca).toBe(false);
    expect(rotuloReserva({ status: 'interrompida', presenca: 'presente' })).toBe('Participou, não concluiu');
  });
  it('sessão passada com reserva sem resultado aparece como pendente; nada é concluído pelo horário', () => {
    const passada = { status: 'scheduled', fim: sessao.fim };
    expect(pendenciasDaSessao({ ...passada, reservas: [{ status: 'ativa' }, { status: 'ativa' }, { status: 'concluida' }, { status: 'cancelada' }] }, agora)).toBe(2);
    expect(pendenciasDaSessao({ ...passada, reservas: [{ status: 'concluida' }, { status: 'ausente' }, { status: 'interrompida' }] }, agora)).toBe(0);
    // Ainda não terminou: não é pendência. Cancelada: também não.
    expect(pendenciasDaSessao({ ...passada, reservas: [{ status: 'ativa' }] }, Date.parse('2026-12-01T12:30:00Z'))).toBe(0);
    expect(pendenciasDaSessao({ status: 'canceled', fim: sessao.fim, reservas: [{ status: 'ativa' }] }, agora)).toBe(0);
  });
});

describe('erroDoBanco', () => {
  it('traduz os códigos das funções do banco para HTTP', () => {
    expect(erroDoBanco({ code: '42501', message: 'x' }).status).toBe(403);
    expect(erroDoBanco({ code: 'P0002', message: 'x' }).status).toBe(404);
    expect(erroDoBanco({ code: '23505', message: 'x' }).status).toBe(409);
    expect(erroDoBanco({ code: '23505', message: 'duplicate key value violates unique constraint "agenda_kickoff_reservas_empresa_key"' }).message).toBe(
      'Esta empresa já tem um kickoff marcado ou concluído.',
    );
    expect(erroDoBanco({ code: '22023', message: 'Sessão lotada: 5 de 5 empresas.' })).toEqual({ status: 422, message: 'Sessão lotada: 5 de 5 empresas.' });
    expect(erroDoBanco({ code: 'PGRST202', message: 'x' }).status).toBe(503);
    expect(erroDoBanco({ code: 'XX000', message: 'x' }).status).toBe(500);
  });
});
