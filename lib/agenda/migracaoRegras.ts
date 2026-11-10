/**
 * Tradução das regras de repetição antigas para RRULE (pura, testável).
 * Formatos encontrados em public.meetings.recurrence_rule:
 * - Agenda atual do Meet: "weekly;count=12", "biweekly;until=2026-12-31"...
 * - Legacy Plan (CRM): JSON {"freq":"weekly","interval":1,"byDays":["WE"],"endType":"count","count":12}
 * - Agenda nova: "rrule:FREQ=WEEKLY;BYDAY=TU;COUNT=12" (já é RRULE).
 */
import { localYmd, weekdayIso } from '@/lib/agenda-engine';

const DIA = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function rruleDeRegraAntiga(regra: string | null | undefined, primeiro: Date, total: number, fuso: string): { rrule: string; origem: string } {
  const dia = DIA[weekdayIso(localYmd(primeiro, fuso)) - 1];
  const r = (regra ?? '').trim();
  if (r.startsWith('rrule:')) return { rrule: r.slice(6), origem: 'agenda-nova' };

  if (r.startsWith('{')) {
    try {
      const j = JSON.parse(r) as { freq?: string; interval?: number; byDays?: string[]; endType?: string; count?: number; until?: string };
      const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[j.freq ?? ''] ?? 'WEEKLY';
      const partes = [`FREQ=${freq}`];
      if (j.interval && j.interval > 1) partes.push(`INTERVAL=${j.interval}`);
      if (freq === 'WEEKLY') partes.push(`BYDAY=${(j.byDays?.length ? j.byDays : [dia]).join(',')}`);
      if (j.endType === 'until' && j.until) partes.push(`UNTIL=${j.until.slice(0, 10).replace(/-/g, '')}T235959Z`);
      else partes.push(`COUNT=${j.count ?? total}`);
      return { rrule: partes.join(';'), origem: 'plan' };
    } catch {
      /* cai no padrão */
    }
  }

  const m = /^(daily|weekly|biweekly|monthly)(?:;(count|until)=([\w-]+))?/.exec(r);
  if (m) {
    const partes =
      m[1] === 'daily' ? ['FREQ=DAILY'] : m[1] === 'monthly' ? ['FREQ=MONTHLY'] : ['FREQ=WEEKLY', `BYDAY=${dia}`, ...(m[1] === 'biweekly' ? ['INTERVAL=2'] : [])];
    if (m[2] === 'until') partes.push(`UNTIL=${m[3].replace(/-/g, '')}T235959Z`);
    else partes.push(`COUNT=${m[2] === 'count' ? Number(m[3]) : total}`);
    return { rrule: partes.join(';'), origem: 'meet' };
  }

  // Sem regra legível: semanal no dia da primeira, com o total de reuniões.
  return { rrule: `FREQ=WEEKLY;BYDAY=${dia};COUNT=${total}`, origem: 'inferida' };
}

export const STATUS_OCORRENCIA: Record<string, string> = {
  canceled: 'cancelada',
  ended: 'realizada',
  no_show: 'no_show',
  scheduled: 'agendada',
  live: 'agendada',
};

export const PRESENCA: Record<string, 'presente' | 'faltou' | 'pendente'> = {
  ended: 'presente',
  no_show: 'faltou',
};
