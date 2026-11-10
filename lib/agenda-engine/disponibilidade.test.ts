import { describe, expect, it } from 'vitest';
import {
  EXPEDIENTE_PADRAO,
  horariosLivres,
  horasDisponiveis,
  reunioesAfetadas,
  temBloqueante,
  validarConflitos,
  type ContextoAgenda,
} from './disponibilidade';
import { instante } from './tempo';

const SP = 'America/Sao_Paulo';
const em = (data: string, hora: string) => instante(data, hora, SP);
const DIA = '2026-11-10'; // terça

const ctx: ContextoAgenda = {
  fuso: SP,
  expediente: EXPEDIENTE_PADRAO,
  bloqueios: [{ id: 'b1', inicio: em(DIA, '14:00'), fim: em(DIA, '16:00'), motivo: 'médico' }],
  eventos: [{ id: 'e1', inicio: em(DIA, '10:00'), fim: em(DIA, '11:00'), titulo: 'Kumon' }],
  regras: { bufferMin: 15, maxReunioesDia: 8, maxHorasDia: 6, maxHorasSemana: 30 },
};
const cand = (ref: string, h1: string, h2: string, extra = {}) => ({ ref, inicio: em(DIA, h1), fim: em(DIA, h2), ...extra });
const tipos = (cs: { tipo: string; nivel: string }[]) => cs.map((c) => `${c.tipo}:${c.nivel}`);

describe('validarConflitos', () => {
  it('bloqueio pessoal é bloqueante, sugere o próximo horário livre e não expõe o motivo', () => {
    const r = validarConflitos([cand('c1', '14:30', '15:30')], ctx);
    expect(tipos(r)).toEqual(['bloqueio:bloqueante']);
    expect(r[0].acaoSugerida).toBe('mover');
    expect(r[0].sugestao?.toISOString()).toBe(em(DIA, '16:00').toISOString());
    expect(JSON.stringify(r)).not.toContain('médico');
    expect(temBloqueante(r)).toBe(true);
  });

  it('menos de 15 min depois de outra reunião é aviso de buffer', () => {
    const r = validarConflitos([cand('c2', '11:10', '12:00')], ctx);
    expect(tipos(r)).toEqual(['buffer:aviso']);
    expect(r[0].acaoSugerida).toBe('manter');
    expect(temBloqueante(r)).toBe(false);
  });

  it('sobreposição é bloqueante', () => {
    expect(tipos(validarConflitos([cand('c', '10:30', '11:30')], ctx))).toContain('sobreposicao:bloqueante');
  });

  it('fora do expediente (19h e no almoço) é aviso', () => {
    expect(tipos(validarConflitos([cand('c', '19:00', '20:00')], ctx))).toEqual(['fora_expediente:aviso']);
    expect(tipos(validarConflitos([cand('c', '12:00', '13:00')], ctx))).toEqual(['fora_expediente:aviso']);
  });

  it('preparo antes de reunião de um produto', () => {
    const r = validarConflitos([cand('c', '11:20', '12:00', { preparoMin: 30 })], ctx);
    expect(tipos(r)).toEqual(['preparo:aviso']);
  });

  it('encontro de grupo em cima de bloqueio exige substituto (nunca fica sem responsável)', () => {
    const r = validarConflitos([cand('g', '14:00', '16:00', { grupo: true })], ctx);
    expect(r[0]).toMatchObject({ tipo: 'bloqueio', nivel: 'bloqueante', acaoSugerida: 'substituto' });
  });

  it('feriado avisa; o admin pode tornar bloqueante (aí a ação é pular)', () => {
    const fer = [{ data: '2026-11-20', nome: 'Consciência Negra', escopo: 'nacional' as const }];
    const c = { ref: 'f', inicio: em('2026-11-20', '09:00'), fim: em('2026-11-20', '10:00') };
    expect(tipos(validarConflitos([c], { ...ctx, feriados: fer }))).toEqual(['feriado:aviso']);
    const r = validarConflitos([c], { ...ctx, feriados: fer, regras: { ...ctx.regras, niveis: { feriado: 'bloqueante' } } });
    expect(r[0]).toMatchObject({ nivel: 'bloqueante', acaoSugerida: 'pular' });
  });

  it('limite diário de reuniões conta o que existe + as novas', () => {
    const dia = '2026-11-12';
    const eventos = Array.from({ length: 8 }, (_, i) => ({
      id: `x${i}`,
      inicio: new Date(em(dia, '08:00').getTime() + i * 45 * 60_000),
      fim: new Date(em(dia, '08:00').getTime() + (i * 45 + 30) * 60_000),
    }));
    const r = validarConflitos(
      [{ ref: 'n', inicio: em(dia, '16:00'), fim: em(dia, '16:30') }],
      { ...ctx, eventos, regras: { ...ctx.regras, maxHorasDia: null } },
    );
    expect(tipos(r)).toContain('limite_reunioes_dia:aviso');
  });

  it('valida a série inteira, inclusive ocorrências que batem entre si', () => {
    const r = validarConflitos([cand('s1', '08:00', '09:00'), cand('s2', '08:30', '09:30')], ctx);
    expect(r.filter((c) => c.tipo === 'sobreposicao').map((c) => c.ref).sort()).toEqual(['s1', 's2']);
  });

  it('mover uma reunião não conflita com ela mesma', () => {
    const r = validarConflitos([cand('e1-movida', '10:15', '11:15', { substituiEventoId: 'e1' })], ctx);
    expect(r).toEqual([]);
  });
});

describe('disponibilidade', () => {
  it('reuniões afetadas por um bloqueio novo', () => {
    expect(reunioesAfetadas({ inicio: em(DIA, '09:00'), fim: em(DIA, '10:30') }, ctx.eventos).map((e) => e.id)).toEqual(['e1']);
  });

  it('horários livres respeitam buffer, almoço, bloqueio e fim do expediente', () => {
    const livres = horariosLivres(ctx, em(DIA, '08:00'), em(DIA, '23:00'), 60, { limite: 50 }).map((d) => d.toISOString());
    const h = (x: string) => em(DIA, x).toISOString();
    expect(livres).toContain(h('08:45'));
    expect(livres).not.toContain(h('09:00')); // 09:00-10:00 encosta no buffer de 09:45
    expect(livres).toContain(h('13:00'));
    expect(livres).not.toContain(h('13:15')); // bate no bloqueio das 14h
    expect(livres).toContain(h('16:00'));
    expect(livres).toContain(h('17:00'));
    expect(livres).not.toContain(h('17:15'));
  });

  it('horas disponíveis: expediente - bloqueios - feriados', () => {
    expect(horasDisponiveis(ctx, '2026-11-09', '2026-11-13')).toBe(43);
    const fer = [{ data: '2026-11-13', nome: 'Recesso', escopo: 'legacy' as const }];
    expect(horasDisponiveis({ ...ctx, feriados: fer }, '2026-11-09', '2026-11-13')).toBe(34);
  });
});
