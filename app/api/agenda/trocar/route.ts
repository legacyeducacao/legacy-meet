import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { updateCalendarEvent } from '@/lib/calendar';
import { validarConflitos, type Conflito } from '@/lib/agenda-engine';
import { contextoExecutor, podeUsarAgendaNova, registrarSobreposicoes } from '@/lib/agenda/servidor';
import { decidirConflitos } from '@/lib/agenda/regras';
import { fimDe, resolverAlvos, type LinhaAlvo } from '@/lib/agenda/alvos';
import { trocarHorarios } from '@/lib/agenda/troca';

export const dynamic = 'force-dynamic';

type Corpo = { a?: string; b?: string; justificativa?: string };

/**
 * POST: troca o horário de duas reuniões (arrastar uma para cima da outra).
 * Vale só para estas duas ocorrências, mesmo que sejam de séries. Passa
 * pelas mesmas regras de conflito da remarcação e devolve os horários
 * anteriores para o "Desfazer".
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Corpo;
  if (!b.a || !b.b || b.a === b.b) return new NextResponse('Escolha duas reuniões diferentes', { status: 400 });

  const [ra, rb] = await Promise.all([resolverAlvos(user, b.a, 'esta'), resolverAlvos(user, b.b, 'esta')]);
  if (!ra.ok) return new NextResponse(ra.message, { status: ra.status });
  if (!rb.ok) return new NextResponse(rb.message, { status: rb.status });
  const A = ra.base;
  const B = rb.base;

  const faixa = (l: LinhaAlvo) => ({ inicio: new Date(l.scheduled_start_at).getTime(), fim: fimDe(l) });
  const t = trocarHorarios(faixa(A), faixa(B));
  const novos = [
    { l: A, ...t.a },
    { l: B, ...t.b },
  ];

  // Conflitos na agenda de cada anfitrião; as duas reuniões não contam no lugar antigo.
  const trocadas = new Set([A.id, B.id]);
  const conflitos: Conflito[] = [];
  for (const host of new Set(novos.map((n) => n.l.host_id))) {
    const doHost = novos.filter((n) => n.l.host_id === host);
    const min = Math.min(...doHost.map((n) => n.inicio));
    const max = Math.max(...doHost.map((n) => n.fim));
    const ctx = await contextoExecutor(host, new Date(min), new Date(max + 86_400_000));
    conflitos.push(
      ...validarConflitos(
        doHost.map((n) => ({ ref: n.l.id, inicio: new Date(n.inicio), fim: new Date(n.fim), substituiEventoId: n.l.id })),
        { ...ctx, eventos: ctx.eventos.filter((e) => !trocadas.has(e.id)) },
      ),
    );
  }
  const decisao = decidirConflitos(conflitos, user.isAdmin, b.justificativa);
  if (!decisao.ok) return NextResponse.json(decisao.resposta, { status: 409 });

  const admin = createAdminSupabase();
  const salvar = (id: string, ini: number, fim: number) =>
    admin
      .from('meetings')
      .update({ scheduled_start_at: new Date(ini).toISOString(), scheduled_end_at: new Date(fim).toISOString() })
      .eq('id', id)
      .eq('status', 'scheduled');

  const e1 = (await salvar(A.id, novos[0].inicio, novos[0].fim)).error;
  if (e1) return new NextResponse('Falha ao salvar: ' + e1.message, { status: 500 });
  const e2 = (await salvar(B.id, novos[1].inicio, novos[1].fim)).error;
  if (e2) {
    // Não deixa a troca pela metade.
    const antes = faixa(A);
    await salvar(A.id, antes.inicio, antes.fim);
    return new NextResponse('Falha ao salvar: ' + e2.message, { status: 500 });
  }

  const mudaram = novos.filter((n) => n.inicio !== new Date(n.l.scheduled_start_at).getTime());
  if (mudaram.length) {
    await admin.from('agenda_remarcacoes').insert(
      mudaram.map((n) => ({
        meeting_id: n.l.id,
        origem: 'executor',
        de_inicio: n.l.scheduled_start_at,
        para_inicio: new Date(n.inicio).toISOString(),
        usuario_id: user.id,
      })),
    );
    await admin.from('agenda_ocorrencias').update({ status: 'movida', excecao: true }).in('meeting_id', mudaram.map((n) => n.l.id));
  }
  if (decisao.registrar.length) await registrarSobreposicoes(decisao.registrar, user.id, b.justificativa!.trim(), (ref) => ref);

  // Google Agenda em segundo plano (avisa os convidados). Não fatal.
  after(async () => {
    const { data: secs } = await admin.from('meet_meeting_sector').select('meeting_id, calendar_event_id').in('meeting_id', [A.id, B.id]);
    for (const s of (secs ?? []) as Array<{ meeting_id: string; calendar_event_id: string | null }>) {
      const n = novos.find((x) => x.l.id === s.meeting_id);
      if (!s.calendar_event_id || !n) continue;
      try {
        await updateCalendarEvent(s.calendar_event_id, { startISO: new Date(n.inicio).toISOString(), endISO: new Date(n.fim).toISOString() });
      } catch (e) {
        console.error('[agenda] troca: falha ao atualizar o Google Agenda', e);
      }
    }
  });

  return NextResponse.json({
    anteriores: [A, B].map((l) => ({ id: l.id, inicio: l.scheduled_start_at, fim: new Date(fimDe(l)).toISOString(), titulo: l.title })),
    atualizados: novos.map((n) => ({ id: n.l.id, inicio: new Date(n.inicio).toISOString(), fim: new Date(n.fim).toISOString() })),
  });
}
