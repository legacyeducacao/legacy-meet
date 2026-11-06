import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { canAccessRecording } from '@/lib/recordings';
import { roomFromRecordingId } from '@/lib/execscore';
import { generateSummary, getMeetingInfo, getSummary, summaryEnabled } from '@/lib/meetingSummary';

export const dynamic = 'force-dynamic';

async function resolve(id: string) {
  const user = await getCurrentUser();
  if (!(await canAccessRecording(id, user))) return null;
  return roomFromRecordingId(id);
}

/** Resumo da reunião desta gravação (null se ainda não existe). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = await resolve(id);
  if (!room) return new NextResponse('Não encontrado', { status: 404 });
  const [resumo, info] = await Promise.all([getSummary(room), getMeetingInfo({ roomName: room })]);
  return NextResponse.json({
    resumo,
    // Só a Executoria tem resumo; o botão "Gerar resumo" aparece só nela.
    podeGerar: summaryEnabled() && info?.sector === 'executoria',
  });
}

/** Gera ou refaz o resumo (leva de 20 s a 1 min). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const room = await resolve(id);
  if (!room) return new NextResponse('Não encontrado', { status: 404 });
  try {
    const r = await generateSummary(room);
    if (r.status === 'ignorado') return new NextResponse(`Resumo não gerado: ${r.motivo}`, { status: 400 });
    return NextResponse.json({ resumo: r.summary });
  } catch (e) {
    console.error(`resumo: falha ao gerar ${room}`, e);
    return new NextResponse('Não foi possível gerar o resumo agora. Tente de novo em alguns minutos.', {
      status: 502,
    });
  }
}
