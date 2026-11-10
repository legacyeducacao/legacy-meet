import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { listTeamMembers, normalizeCoHostIds } from '@/lib/meetingHosts';
import { parseGuestEmails } from '@/lib/guestEmails';
import { criarReunioes } from '@/lib/meetingsCore';
import {
  contagem,
  expandirSerie,
  utcToLocal,
  validarConflitos,
  type PoliticaFeriadoSerie,
} from '@/lib/agenda-engine';
import {
  carregarConfig,
  carregarFeriados,
  contextoExecutor,
  feriadosParaDTO,
  FUSO,
  listarBloqueios,
  listarReunioes,
  podeUsarAgendaNova,
  registrarSobreposicoes,
} from '@/lib/agenda/servidor';
import { decidirConflitos } from '@/lib/agenda/regras';

export const dynamic = 'force-dynamic';

const MAX_OCORRENCIAS = 200;
const pad = (n: number) => String(n).padStart(2, '0');

/** GET ?de=ISO&ate=ISO&executores=id,id : reuniões, bloqueios e feriados do período. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const de = new Date(req.nextUrl.searchParams.get('de') ?? '');
  const ate = new Date(req.nextUrl.searchParams.get('ate') ?? '');
  if (isNaN(de.getTime()) || isNaN(ate.getTime()) || ate <= de) return new NextResponse('Período inválido', { status: 400 });
  if (ate.getTime() - de.getTime() > 120 * 86_400_000) return new NextResponse('Período longo demais', { status: 400 });

  // Executor vê a própria agenda; admin (gestor) pode ver a de outros.
  const pedidos = (req.nextUrl.searchParams.get('executores') ?? '').split(',').filter(Boolean);
  const executores = user.isAdmin && pedidos.length ? [...new Set(pedidos)].slice(0, 30) : [user.id];

  try {
    const [reunioes, bloqueios, feriados] = await Promise.all([
      listarReunioes(user, executores, de, ate),
      listarBloqueios(user, executores, de, ate),
      carregarFeriados(de, ate),
    ]);
    return NextResponse.json({ eventos: [...reunioes, ...bloqueios], feriados: feriadosParaDTO(feriados, de, ate) });
  } catch (e) {
    console.error('agenda eventos GET', e);
    return new NextResponse('Erro ao carregar a agenda', { status: 500 });
  }
}

type CorpoCriar = {
  titulo?: string;
  setor?: 'executoria' | 'comercial';
  tenantId?: string;
  inicio?: string;
  fim?: string;
  /** RRULE sem DTSTART (ex.: FREQ=WEEKLY;BYDAY=TU;COUNT=12); vazio = reunião avulsa. */
  rrule?: string | null;
  politicaFeriado?: PoliticaFeriadoSerie;
  sequencia?: string[];
  defasagem?: number;
  gravar?: boolean;
  transcrever?: boolean;
  onboarding?: boolean;
  coHostIds?: string[];
  guestEmails?: string[] | string;
  /** Admin agendando para outro executor. */
  executorId?: string;
  justificativa?: string;
};

/** POST: cria reunião ou série (cada ocorrência vira uma reunião do Meet). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as CorpoCriar;

  const titulo = (b.titulo ?? '').trim();
  if (!titulo) return new NextResponse('Informe o título', { status: 400 });
  const setor = b.setor === 'comercial' ? 'comercial' : 'executoria';
  const tenantId = setor === 'comercial' ? process.env.MEET_COMMERCIAL_TENANT_ID! : b.tenantId;
  if (!tenantId) return new NextResponse('Selecione o cliente', { status: 400 });
  const inicio = new Date(b.inicio ?? '');
  const fim = new Date(b.fim ?? '');
  if (isNaN(inicio.getTime()) || isNaN(fim.getTime()) || fim <= inicio) {
    return new NextResponse('Horário inválido', { status: 400 });
  }
  const duracaoMin = Math.round((fim.getTime() - inicio.getTime()) / 60_000);
  if (duracaoMin > 12 * 60) return new NextResponse('Reunião longa demais (máximo 12 h)', { status: 400 });

  const executorId = user.isAdmin && b.executorId ? b.executorId : user.id;
  const cfg = await carregarConfig();

  // Ocorrências (avulsa = 1). Série sem fim vai até o horizonte da empresa.
  let ocorrencias = [{ inicio, fim, ordem: 0, rotulo: null as string | null, inicioOriginal: inicio }];
  const rrule = b.rrule?.trim() || null;
  let inicioLocal = '';
  if (rrule) {
    const l = utcToLocal(inicio, FUSO);
    inicioLocal = `${l.year}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
    const horizonte = new Date(inicio.getTime());
    horizonte.setUTCMonth(horizonte.getUTCMonth() + (contagem(rrule) ? 36 : cfg.horizonteMeses));
    try {
      const feriados = await carregarFeriados(inicio, horizonte, cfg);
      ocorrencias = expandirSerie(
        { rrule, inicioLocal, fuso: FUSO, duracaoMin, sequencia: b.sequencia ?? [], defasagem: b.defasagem ?? 0 },
        { de: new Date(inicio.getTime() - 60_000), ate: horizonte },
        { feriados, politicaFeriado: b.politicaFeriado ?? 'manter', maxOcorrencias: MAX_OCORRENCIAS * 2 },
      )
        .filter((o) => o.status === 'agendada')
        .slice(0, MAX_OCORRENCIAS);
    } catch (e) {
      return new NextResponse(e instanceof Error ? `Repetição inválida: ${e.message}` : 'Repetição inválida', { status: 400 });
    }
    if (!ocorrencias.length) return new NextResponse('A repetição não gera nenhuma reunião', { status: 400 });
  }

  // Conflitos de todas as ocorrências contra a agenda do executor.
  const ultimo = ocorrencias[ocorrencias.length - 1].fim;
  const ctx = await contextoExecutor(executorId, inicio, new Date(ultimo.getTime() + 86_400_000), cfg);
  const conflitos = validarConflitos(
    ocorrencias.map((o, k) => ({ ref: String(k), inicio: o.inicio, fim: o.fim })),
    ctx,
  );
  const decisao = decidirConflitos(conflitos, user.isAdmin, b.justificativa);
  if (!decisao.ok) return NextResponse.json(decisao.resposta, { status: 409 });

  const guests = parseGuestEmails(b.guestEmails);
  if (guests.invalid.length) return new NextResponse(`E-mail inválido: ${guests.invalid.join(', ')}`, { status: 400 });
  const team = await listTeamMembers();
  const coHostIds = normalizeCoHostIds(b.coHostIds, new Set(team.map((m) => m.id)), executorId);
  const host = team.find((m) => m.id === executorId);

  const r = await criarReunioes({
    hostId: executorId,
    hostEmail: executorId === user.id ? user.email : host?.email ?? null,
    sector: setor,
    tenantId,
    title: titulo,
    ocorrencias: ocorrencias.map((o) => ({ inicio: o.inicio, fim: o.fim })),
    record: b.gravar !== false,
    transcribe: b.transcrever !== false,
    onboarding: b.onboarding === true,
    coHostIds,
    team,
    guestEmails: guests.emails,
    recurrenceRule: rrule ? `rrule:${rrule}` : null,
  });
  if (!r.ok) return new NextResponse(r.message, { status: r.status });

  const admin = createAdminSupabase();
  let serieId: string | null = null;
  if (rrule) {
    const { data: serie, error } = await admin
      .from('agenda_series')
      .insert({
        executor_id: executorId,
        titulo,
        setor,
        tenant_id: tenantId,
        rrule,
        inicio_local: inicioLocal,
        fuso: FUSO,
        duracao_min: duracaoMin,
        sequencia: b.sequencia ?? [],
        defasagem: b.defasagem ?? 0,
        politica_feriado: b.politicaFeriado ?? 'manter',
        horizonte_meses: cfg.horizonteMeses,
        gravar: b.gravar !== false,
        transcrever: b.transcrever !== false,
        onboarding: b.onboarding === true,
        recurrence_parent_id: r.ids[0],
        criado_por: user.id,
      })
      .select('id')
      .single();
    if (error) console.error('agenda: falha ao registrar a série', error);
    serieId = serie?.id ?? null;
    if (serieId) {
      const { error: e2 } = await admin.from('agenda_ocorrencias').insert(
        ocorrencias.map((o, k) => ({
          serie_id: serieId,
          inicio_original: o.inicioOriginal.toISOString(),
          ordem: o.ordem,
          rotulo: o.rotulo,
          meeting_id: r.ids[k],
        })),
      );
      if (e2) console.error('agenda: falha ao registrar as ocorrências', e2);
    }
  }

  if (decisao.registrar.length) {
    await registrarSobreposicoes(decisao.registrar, user.id, b.justificativa!.trim(), (ref) => r.ids[Number(ref)] ?? null, serieId);
  }
  return NextResponse.json({ ids: r.ids, serieId, ocorrencias: r.ids.length });
}
