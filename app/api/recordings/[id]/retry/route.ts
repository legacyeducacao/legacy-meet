import { NextResponse } from 'next/server';
import { canAccessRecording, requeueTranscription } from '@/lib/recordings';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Reenvia uma gravação para transcrição (após falha). Só o dono ou admin.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!(await canAccessRecording(id, user))) {
    return new NextResponse('Não encontrado', { status: 404 });
  }
  try {
    await requeueTranscription(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro ao reenfileirar', { status: 500 });
  }
}
