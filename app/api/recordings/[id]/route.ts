import { NextResponse } from 'next/server';
import { deleteRecording, getManifest } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const manifest = await getManifest(id);
  if (!manifest) {
    return new NextResponse('Gravação não encontrada', { status: 404 });
  }
  return NextResponse.json(manifest);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteRecording(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro ao excluir', { status: 500 });
  }
}
