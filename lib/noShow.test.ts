import { describe, expect, it } from 'vitest';
import { planNoShow } from './noShow';

const NOW = Date.parse('2026-11-06T15:00:00Z');
const base = {
  status: 'scheduled',
  scheduled_start_at: '2026-11-06T14:00:00Z',
  scheduled_end_at: '2026-11-06T15:00:00Z',
  started_at: null,
  ended_at: null,
};

describe('planNoShow', () => {
  it('marca reunião em andamento (executor saindo da sala) e carimba o fim', () => {
    const r = planNoShow({ ...base, status: 'live', started_at: '2026-11-06T14:02:00Z' }, false, NOW);
    expect(r).toEqual({
      ok: true,
      status: 'no_show',
      update: { status: 'no_show', ended_at: new Date(NOW).toISOString() },
    });
  });

  it('reunião encerrada sem ended_at usa o fim agendado', () => {
    const r = planNoShow({ ...base, status: 'ended' }, false, NOW);
    expect(r.ok && r.update).toEqual({ status: 'no_show', ended_at: base.scheduled_end_at });
  });

  it('agendada antes do horário não vira no-show', () => {
    const r = planNoShow({ ...base, scheduled_start_at: '2026-11-06T16:00:00Z' }, false, NOW);
    expect(r).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it('já em no-show: nada a gravar', () => {
    expect(planNoShow({ ...base, status: 'no_show' }, false, NOW)).toEqual({ ok: true, update: {}, status: 'no_show' });
  });

  it('cancelada não vira no-show', () => {
    expect(planNoShow({ ...base, status: 'cancelled' }, false, NOW)).toMatchObject({ ok: false });
  });

  it('desfazer volta para encerrada se a reunião aconteceu', () => {
    const r = planNoShow({ ...base, status: 'no_show', started_at: '2026-11-06T14:02:00Z' }, true, NOW);
    expect(r).toEqual({ ok: true, update: { status: 'ended' }, status: 'ended' });
  });

  it('desfazer volta para agendada se nunca começou', () => {
    const r = planNoShow({ ...base, status: 'no_show' }, true, NOW);
    expect(r).toEqual({ ok: true, update: { status: 'scheduled' }, status: 'scheduled' });
  });

  it('desfazer o que não é no-show é erro', () => {
    expect(planNoShow({ ...base, status: 'ended' }, true, NOW)).toMatchObject({ ok: false, httpStatus: 400 });
  });
});
