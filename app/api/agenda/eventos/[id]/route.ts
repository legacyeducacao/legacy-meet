import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { updateCalendarEvent } from '@/lib/calendar';
import { dividirSerie, utcToLocal, validarConflitos } from '@/lib/agenda-engine';
import { contextoExecutor, FUSO, podeUsarAgendaNova, registrarSobreposicoes } from '@/lib/agenda/servidor';
import { decidirConflitos } from '@/lib/agenda/regras';
import { fimDe, resolverAlvos } from '@/lib/agenda/alvos';
import type { Escopo, Origem } from '@/lib/agenda/tipos';

export const dynamic = 'force-dynamic';

const pad = (n: number) => String(n).padStart(2, '0');
const localStr = (d: Date) => {
  const l = utcToLocal(d, FUSO);
  return `${l.year}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
};

type Corpo = {
  inicio?: string;
  fim?: string;
  titulo?: string;
  escopo?: Escopo;
  justificativa?: string;
  origem?: Origem;
};

/**
 * PATCH: move, redimensiona ou renomeia. Em série, o escopo decide:
 * "esta" (só esta), "seguintes" (divide a série aqui) ou "todas". O mesmo
 * deslocamento e a mesma duração valem para todas as reuniões atingidas.
 * Devolve os valores anteriores para o "Desfazer".
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Corpo;
  const escopo: Escopo = b.escopo === 'seguintes' || b.escopo === 'todas' ? b.escopo : 'esta';

  const r = await resolverAlvos(user, id, escopo);
  if (!r.ok) return new NextResponse(r.message, { status: r.status });
  const { base, alvos } = r;

  const iniBase = new Date(base.scheduled_start_at).getTime();
  const novoIni = b.inicio ? new Date(b.inicio).getTime() : iniBase;
  const novoFim = b.fim ? new Date(b.fim).getTime() : novoIni + (fimDe(base) - iniBase);
  if (isNaN(novoIni) || isNaN(novoFim) || novoFim <= novoIni) return new NextResponse('Horário inválido', { status: 400 });
  if (novoFim - novoIni > 12 * 3_600_000) return new NextResponse('Reunião longa demais (máximo 12 h)', { status: 400 });
  const delta = novoIni - iniBase;
  const duracao = novoFim - novoIni;
  const titulo = b.titulo?.trim();
  if (b.titulo !== undefined && !titulo) return new NextResponse('O título não pode ficar vazio', { status: 400 });
  const mudouHorario = delta !== 0 || duracao !== fimDe(base) - iniBase;

  const novos = alvos.map((a) => {
    const ini = new Date(a.scheduled_start_at).getTime() + delta;
    return { a, ini, fim: ini + duracao };
  });

  let registrar: Parameters<typeof registrarSobreposicoes>[0] = [];
  if (mudouHorario) {
    const min = Math.min(...novos.map((n) => n.ini));
    const max = Math.max(...novos.map((n) => n.fim));
    const contexto = await contextoExecutor(base.host_id, new Date(min), new Date(max + 86_400_000));
    // As próprias reuniões movidas não contam como ocupação no lugar antigo.
    const movidas = new Set(alvos.map((a) => a.id));
    const conflitos = validarConflitos(
      novos.map((n) => ({ ref: n.a.id, inicio: new Date(n.ini), fim: new Date(n.fim), substituiEventoId: n.a.id })),
      { ...contexto, eventos: contexto.eventos.filter((e) => !movidas.has(e.id)) },
    );
    const decisao = decidirConflitos(conflitos, user.isAdmin, b.justificativa);
    if (!decisao.ok) return NextResponse.json(decisao.resposta, { status: 409 });
    registrar = decisao.registrar;
  }

  const admin = createAdminSupabase();
  for (const n of novos) {
    const { error } = await admin
      .from('meetings')
      .update({
        scheduled_start_at: new Date(n.ini).toISOString(),
        scheduled_end_at: new Date(n.fim).toISOString(),
        ...(titulo ? { title: titulo } : {}),
      })
      .eq('id', n.a.id)
      .eq('status', 'scheduled');
    if (error) return new NextResponse('Falha ao salvar: ' + error.message, { status: 500 });
  }

  if (delta !== 0) {
    await admin.from('agenda_remarcacoes').insert(
      novos.map((n) => ({
        meeting_id: n.a.id,
        origem: b.origem ?? 'executor',
        de_inicio: n.a.scheduled_start_at,
        para_inicio: new Date(n.ini).toISOString(),
        usuario_id: user.id,
      })),
    );
  }
  if (registrar.length) await registrarSobreposicoes(registrar, user.id, b.justificativa!.trim(), (ref) => ref);

  await atualizarSerie(escopo, base, alvos.map((a) => a.id), delta, duracao, titulo);

  // Google Agenda em segundo plano (avisa os convidados). Não fatal.
  after(async () => {
    const { data: secs } = await admin
      .from('meet_meeting_sector')
      .select('meeting_id, calendar_event_id')
      .in('meeting_id', alvos.map((a) => a.id));
    const porId = new Map(novos.map((n) => [n.a.id, n]));
    for (const s of (secs ?? []) as Array<{ meeting_id: string; calendar_event_id: string | null }>) {
      const n = porId.get(s.meeting_id);
      if (!s.calendar_event_id || !n) continue;
      try {
        await updateCalendarEvent(s.calendar_event_id, {
          summary: titulo,
          startISO: new Date(n.ini).toISOString(),
          endISO: new Date(n.fim).toISOString(),
        });
      } catch (e) {
        console.error('[agenda] falha ao atualizar evento do Google Agenda', e);
      }
    }
  });

  return NextResponse.json({
    anteriores: alvos.map((a) => ({ id: a.id, inicio: a.scheduled_start_at, fim: new Date(fimDe(a)).toISOString(), titulo: a.title })),
    atualizados: novos.map((n) => ({ id: n.a.id, inicio: new Date(n.ini).toISOString(), fim: new Date(n.fim).toISOString(), titulo: titulo ?? n.a.title })),
  });
}

/** Mantém agenda_series/agenda_ocorrencias coerentes com a edição (quando a série nasceu na agenda nova). */
async function atualizarSerie(
  escopo: Escopo,
  base: { id: string; recurrence_parent_id: string | null; scheduled_start_at: string },
  ids: string[],
  delta: number,
  duracaoMs: number,
  titulo?: string,
) {
  const admin = createAdminSupabase();
  try {
    if (escopo === 'esta' || !base.recurrence_parent_id) {
      if (delta !== 0) {
        await admin.from('agenda_ocorrencias').update({ status: 'movida', excecao: true }).eq('meeting_id', base.id);
      }
      return;
    }
    const { data: serie } = await admin
      .from('agenda_series')
      .select('*')
      .eq('recurrence_parent_id', base.recurrence_parent_id)
      .is('encerrada_em', null)
      .maybeSingle();

    if (escopo === 'seguintes' && base.id !== base.recurrence_parent_id) {
      // A partir daqui é outra série: re-parenta as reuniões (a Agenda atual usa recurrence_parent_id).
      await admin.from('meetings').update({ recurrence_parent_id: base.id }).in('id', ids);
      if (serie) {
        const { data: oc } = await admin.from('agenda_ocorrencias').select('inicio_original').eq('meeting_id', base.id).maybeSingle();
        const corte = new Date((oc?.inicio_original as string | undefined) ?? base.scheduled_start_at);
        const def = { rrule: serie.rrule, inicioLocal: serie.inicio_local, fuso: serie.fuso, duracaoMin: serie.duracao_min, sequencia: serie.sequencia, defasagem: serie.defasagem };
        const { anterior, nova } = dividirSerie(def, corte);
        const { data: criada } = await admin
          .from('agenda_series')
          .insert({
            ...Object.fromEntries(Object.entries(serie).filter(([k]) => !['id', 'criado_em', 'atualizado_em'].includes(k))),
            rrule: nova.rrule,
            inicio_local: localStr(new Date(new Date(base.scheduled_start_at).getTime() + delta)),
            duracao_min: Math.round(duracaoMs / 60_000),
            defasagem: nova.defasagem ?? 0,
            ...(titulo ? { titulo } : {}),
            serie_anterior_id: serie.id,
            recurrence_parent_id: base.id,
          })
          .select('id')
          .single();
        if (anterior) await admin.from('agenda_series').update({ rrule: anterior.rrule, atualizado_em: new Date().toISOString() }).eq('id', serie.id);
        if (criada) await admin.from('agenda_ocorrencias').update({ serie_id: criada.id }).in('meeting_id', ids);
      }
      return;
    }

    if (serie) {
      const { data: primeira } = await admin.from('meetings').select('scheduled_start_at').eq('id', base.recurrence_parent_id).maybeSingle();
      const inicioSerie = primeira ? new Date(new Date(primeira.scheduled_start_at as string).getTime() + delta) : null;
      await admin
        .from('agenda_series')
        .update({
          ...(inicioSerie ? { inicio_local: localStr(inicioSerie) } : {}),
          duracao_min: Math.round(duracaoMs / 60_000),
          ...(titulo ? { titulo } : {}),
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', serie.id);
    }
  } catch (e) {
    console.error('agenda: falha ao atualizar a série', e);
  }
}
