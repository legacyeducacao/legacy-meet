import { NextResponse } from 'next/server';
import { canAccessRecording, deleteRecording, getManifest } from '@/lib/recordings';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!(await canAccessRecording(id, user))) {
    return new NextResponse('Não encontrado', { status: 404 });
  }
  const manifest = await getManifest(id);
  if (!manifest) {
    return new NextResponse('Gravação não encontrada', { status: 404 });
  }
  return NextResponse.json(manifest);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!(await canAccessRecording(id, user))) {
    return new NextResponse('Não encontrado', { status: 404 });
  }
  try {
    await deleteRecording(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro ao excluir', { status: 500 });
  }
}
