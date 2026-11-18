import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { autorizarEmpresaDaReuniao } from '@/lib/meetingTenantAccess';
import { KICKOFF_TIPO } from '@/lib/kickoff/regras';
import { prepararKickoff, registrarSessoesKickoff } from '@/lib/kickoff/servidor';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { listTeamMembers, normalizeCoHostIds } from '@/lib/meetingHosts';
import { parseGuestEmails } from '@/lib/guestEmails';
import { criarReunioes } from '@/lib/meetingsCore';
import {
  contagem,
  expandirSerie,
  localYmd,
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
  listarTurmas,
  podeUsarAgendaNova,
  registrarSobreposicoes,
} from '@/lib/agenda/servidor';
import type { EventoDTO } from '@/lib/agenda/tipos';
import { decidirConflitos } from '@/lib/agenda/regras';
import { lerSetorReuniao, type SetorReuniao } from '@/lib/setorReuniao';
import { agendaParaCloser } from '@/lib/comercial/funcao';
import { listarClosers } from '@/lib/comercial/closers';

export const dynamic = 'force-dynamic';

const MAX_OCORRENCIAS = 200;
const pad = (n: number) => String(n).padStart(2, '0');

/** GET ?de=ISO&ate=ISO&executores=id,id : reuniões, bloqueios, turmas do Legado e feriados do período. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  // Só a equipe do Meet: o login é o mesmo do Plan, e a resposta traz links de reuniões e aulas.
  if (!user || !user.isStaff || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const de = new Date(req.nextUrl.searchParams.get('de') ?? '');
  const ate = new Date(req.nextUrl.searchParams.get('ate') ?? '');
  if (isNaN(de.getTime()) || isNaN(ate.getTime()) || ate <= de) return new NextResponse('Período inválido', { status: 400 });
  if (ate.getTime() - de.getTime() > 120 * 86_400_000) return new NextResponse('Período longo demais', { status: 400 });

  // Executor vê a própria agenda; admin (gestor) pode ver a de outros.
  const pedidos = (req.nextUrl.searchParams.get('executores') ?? '').split(',').filter(Boolean);
  const executores = user.isAdmin && pedidos.length ? [...new Set(pedidos)].slice(0, 30) : [user.id];

  try {
    const [reunioes, bloqueios, feriados, turmas] = await Promise.all([
      listarReunioes(user, executores, de, ate),
      listarBloqueios(user, executores, de, ate),
      carregarFeriados(de, ate),
      // Turmas do Legado (Legacy Plan): informação da empresa, só leitura. Se falhar, a agenda abre sem elas.
      listarTurmas(de, ate).catch((e) => {
        console.error('agenda eventos GET: turmas do Legado', e);
        return [] as EventoDTO[];
      }),
    ]);
    return NextResponse.json({
      eventos: [...reunioes, ...bloqueios, ...turmas],
      feriados: feriadosParaDTO(feriados, de, ate),
    });
  } catch (e) {
    console.error('agenda eventos GET', e);
    return new NextResponse('Erro ao carregar a agenda', { status: 500 });
  }
}

type CorpoCriar = {
  titulo?: string;
  setor?: SetorReuniao;
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
  /** SDR: Closer responsável (vira o dono da reunião; o SDR fica como anfitrião). */
  closerId?: string;
  justificativa?: string;
  /** Série 1 a 1 do Legado: registra a jornada (encontros previstos x realizados). */
  jornadaLegado?: boolean;
  templateId?: string;
  /** Sessão de kickoff do Impulsão (sem sala do Meet, sem Google Agenda). */
  tipo?: 'kickoff_impulsao';
  /** Kickoff: empresas por sessão (1 a 50; padrão 5). */
  capacidade?: number;
};

/** POST: cria reunião ou série (cada ocorrência vira uma reunião do Meet). */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !(await podeUsarAgendaNova(user))) return new NextResponse('Não autorizado', { status: 403 });
  const b = ((await req.json().catch(() => null)) ?? {}) as CorpoCriar;

  const kickoff = b.tipo === KICKOFF_TIPO;
  const setor: SetorReuniao = kickoff ? 'executoria' : lerSetorReuniao(b.setor);
  let tenantId: string;
  let capacidade = 0;
  if (kickoff) {
    // Kickoff do Impulsão: permissão própria e empresa organizadora interna
    // (do ambiente, nunca do corpo). As empresas participantes vêm nas reservas.
    const k = await prepararKickoff(user, b.capacidade);
    if (!k.ok) return new NextResponse(k.message, { status: k.status });
    tenantId = k.tenantId;
    capacidade = k.capacidade;
  } else {
    // A empresa não vem só do corpo: equipe, setor e carteira são conferidos aqui.
    // Admin agendando para outro executor (executorId) continua liberado pela regra de admin.
    const acesso = await autorizarEmpresaDaReuniao(user, setor, b.tenantId);
    // 400 = sem cliente: mantém a mensagem que o formulário da agenda já mostra.
    if (!acesso.ok) return new NextResponse(acesso.status === 400 ? 'Selecione o cliente' : acesso.message, { status: acesso.status });
    tenantId = acesso.tenantId;
  }
  const titulo = (b.titulo ?? '').trim();
  if (!titulo) return new NextResponse('Informe o título', { status: 400 });
  const inicio = new Date(b.inicio ?? '');
  const fim = new Date(b.fim ?? '');
  if (isNaN(inicio.getTime()) || isNaN(fim.getTime()) || fim <= inicio) {
    return new NextResponse('Horário inválido', { status: 400 });
  }
  const duracaoMin = Math.round((fim.getTime() - inicio.getTime()) / 60_000);
  if (duracaoMin > 12 * 60) return new NextResponse('Reunião longa demais (máximo 12 h)', { status: 400 });

  let executorId = user.isAdmin && b.executorId ? b.executorId : user.id;
  // SDR agendando no Comercial: o Closer escolhido é o dono (agenda, números e
  // conflito na agenda dele) e o SDR entra como anfitrião adicional.
  const sdr = agendaParaCloser(user, setor, kickoff);
  if (sdr) {
    const closerId = (b.closerId ?? '').trim();
    if (!closerId) return new NextResponse('Escolha o Closer responsável', { status: 400 });
    if (!(await listarClosers()).some((c) => c.id === closerId)) return new NextResponse('Closer inválido', { status: 400 });
    executorId = closerId;
  }
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
  const ctx = await contextoExecutor(executorId, inicio, new Date(ultimo.getTime() + 86_400_000), cfg, { coAnfitriao: true });
  const conflitos = validarConflitos(
    ocorrencias.map((o, k) => ({ ref: String(k), inicio: o.inicio, fim: o.fim })),
    ctx,
  );
  const decisao = decidirConflitos(conflitos, user.isAdmin, b.justificativa);
  if (!decisao.ok) return NextResponse.json(decisao.resposta, { status: 409 });

  // Kickoff não convida ninguém pelo Google Agenda.
  const guests = kickoff ? { emails: [] as string[], invalid: [] as string[] } : parseGuestEmails(b.guestEmails);
  if (guests.invalid.length) return new NextResponse(`E-mail inválido: ${guests.invalid.join(', ')}`, { status: 400 });
  const team = await listTeamMembers();
  const coHostIds = normalizeCoHostIds(b.coHostIds, new Set(team.map((m) => m.id)), executorId);
  if (sdr && !coHostIds.includes(user.id)) coHostIds.unshift(user.id);
  const host = team.find((m) => m.id === executorId);

  const r = await criarReunioes({
    hostId: executorId,
    hostEmail: executorId === user.id ? user.email : host?.email ?? null,
    sector: setor,
    tenantId,
    title: titulo,
    ocorrencias: ocorrencias.map((o) => ({ inicio: o.inicio, fim: o.fim })),
    // Kickoff: sem gravação/transcrição do Meet (usa Zoom) e fora do ExecScore (onboarding).
    record: kickoff ? false : b.gravar !== false,
    transcribe: kickoff ? false : b.transcrever !== false,
    onboarding: kickoff ? true : b.onboarding === true,
    coHostIds,
    team,
    guestEmails: guests.emails,
    recurrenceRule: rrule ? `rrule:${rrule}` : null,
    googleAgenda: !kickoff,
  });
  if (!r.ok) return new NextResponse(r.message, { status: r.status });

  const admin = createAdminSupabase();
  if (kickoff) {
    const marcadas = await registrarSessoesKickoff(r.ids, capacidade, user.id);
    if (!marcadas.ok) {
      // Sem a marcação, seriam reuniões comuns da empresa organizadora: desfaz.
      await admin.from('meetings').delete().in('id', r.ids);
      return new NextResponse('Falha ao registrar a sessão de kickoff: ' + marcadas.message, { status: 500 });
    }
  }
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
        gravar: kickoff ? false : b.gravar !== false,
        transcrever: kickoff ? false : b.transcrever !== false,
        onboarding: kickoff ? true : b.onboarding === true,
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

  if (!kickoff && b.jornadaLegado && rrule && setor === 'executoria') {
    const primeira = localYmd(ocorrencias[0].inicio, FUSO);
    const ultima = localYmd(ocorrencias[ocorrencias.length - 1].inicio, FUSO);
    const { data: j, error: ej } = await admin
      .from('agenda_jornadas')
      .insert({
        tenant_id: tenantId,
        produto: 'legado',
        serie_id: serieId,
        executor_id: executorId,
        inicio: primeira,
        fim_previsto: ultima,
        encontros_previstos: ocorrencias.length,
        criado_por: user.id,
      })
      .select('id')
      .single();
    if (ej) console.error('agenda: falha ao registrar a jornada do Legado', ej);
    else
      await admin.from('agenda_jornada_encontros').insert(
        ocorrencias.map((o, k) => ({ jornada_id: j.id, numero: k + 1, data: localYmd(o.inicio, FUSO), meeting_id: r.ids[k] })),
      );
  }
  if (!kickoff && b.templateId && serieId) await admin.from('agenda_series').update({ template_id: b.templateId }).eq('id', serieId);
  return NextResponse.json({ ids: r.ids, serieId, ocorrencias: r.ids.length });
}
