import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  activePillars,
  dispatchMeeting,
  findExecutoriaMeeting,
  getIntegracao,
  tentativasEsgotadas,
  isEnabled,
  PILARES,
  sanitizeDisabled,
  savePillarChoice,
  type ExecutoriaMeeting,
} from '@/lib/execscore';
import { isValidRoomName } from '@/lib/livekitAuth';
import { applyNoShow } from '@/lib/noShow';

export const dynamic = 'force-dynamic';

type Ctx =
  | { ok: true; meeting: ExecutoriaMeeting; userId: string }
  | { ok: false; res: NextResponse };

/**
 * Só o executor responsável (anfitrião da reunião) ou um admin do Meet escolhe
 * os pilares. Reunião que não é da Executoria, ou cujo anfitrião não está no
 * ExecScore, responde elegivel=false (a tela de saída mostra só o "obrigado").
 */
async function resolve(room: string | null): Promise<Ctx> {
  if (!isValidRoomName(room)) {
    return { ok: false, res: new NextResponse('room inválido', { status: 400 }) };
  }
  const user = await getCurrentUser();
  if (!user?.isStaff) return { ok: false, res: NextResponse.json({ elegivel: false }) };
  if (!isEnabled()) return { ok: false, res: NextResponse.json({ elegivel: false }) };
  const meeting = await findExecutoriaMeeting({ roomName: room! });
  if (!meeting || (meeting.hostId !== user.id && !user.isAdmin)) {
    return { ok: false, res: NextResponse.json({ elegivel: false }) };
  }
  return { ok: true, meeting, userId: user.id };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolve(req.nextUrl.searchParams.get('room'));
    if (!ctx.ok) return ctx.res;
    const row = await getIntegracao(ctx.meeting.meetingId);
    return NextResponse.json({
      elegivel: true,
      meetingId: ctx.meeting.meetingId,
      executorName: ctx.meeting.executorName,
      titulo: ctx.meeting.title,
      cliente: ctx.meeting.clientName,
      onboarding: ctx.meeting.onboarding,
      noShow: ctx.meeting.noShow,
      pilares: PILARES,
      // null = ainda não escolheu (a tela começa com todos ligados)
      desabilitados: row?.pilares_desabilitados ?? null,
      status: row?.status ?? null,
      // Erro depois da última tentativa automática: a tela pede para reenviar.
      esgotado: tentativasEsgotadas(row),
      avaliacaoId: row?.evaluation_id ?? null,
    });
  } catch (e) {
    console.error('execscore pilares GET', e);
    return new NextResponse('erro ao carregar', { status: 500 });
  }
}

/**
 * Corpo: { room, noShow?, desabilitados? }.
 * - noShow true: marca no-show (cliente não veio) e a reunião sai do ExecScore.
 * - noShow false com a reunião em no-show: desfaz antes de salvar os pilares.
 * - Reunião de onboarding não tem pilares: só o no-show é registrado.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    room?: string;
    desabilitados?: unknown;
    noShow?: unknown;
  } | null;
  try {
    const ctx = await resolve(body?.room ?? null);
    if (!ctx.ok) {
      // Na escrita, não elegível é erro explícito (no GET é só "não mostra").
      return ctx.res.status === 200 ? new NextResponse('não autorizado', { status: 403 }) : ctx.res;
    }
    const meetingId = ctx.meeting.meetingId;

    if (typeof body?.noShow === 'boolean' && body.noShow !== ctx.meeting.noShow) {
      const r = await applyNoShow(meetingId, !body.noShow);
      if (!r.ok) return new NextResponse(r.message, { status: r.httpStatus });
    }
    if (body?.noShow === true) return NextResponse.json({ ok: true, noShow: true });
    if (ctx.meeting.onboarding) return NextResponse.json({ ok: true, onboarding: true });

    let desabilitados;
    try {
      desabilitados = sanitizeDisabled(body?.desabilitados);
    } catch (e) {
      return new NextResponse(e instanceof Error ? e.message : 'pilares inválidos', { status: 400 });
    }
    await savePillarChoice(ctx.meeting, desabilitados, ctx.userId);
    // Se a transcrição já estiver pronta, envia agora; senão o worker dispara depois.
    after(() => dispatchMeeting(meetingId).catch((e) => console.error('execscore dispatch', e)));
    return NextResponse.json({ ok: true, desabilitados, ativos: activePillars(desabilitados) });
  } catch (e) {
    console.error('execscore pilares POST', e);
    return new NextResponse('erro ao salvar', { status: 500 });
  }
}
