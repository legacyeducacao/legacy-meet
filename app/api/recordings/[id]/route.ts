import { NextResponse } from 'next/server';
import { canAccessRecording, deleteRecording, getManifest, getRoomOwners } from '@/lib/recordings';
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
  // Título cadastrado da reunião (agenda/ao iniciar) tem prioridade sobre o do manifesto.
  const roomName = id.split('__')[0];
  const owner = (await getRoomOwners([roomName])).get(roomName);
  return NextResponse.json({ ...manifest, title: owner?.title ?? manifest.title });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não encontrado', { status: 404 });
  // Excluir é restrito ao DONO ou admin — comercial vê todas as reuniões do
  // comercial, mas não pode apagar a de um colega.
  const roomName = id.split('__')[0];
  const owner = (await getRoomOwners([roomName])).get(roomName);
  const canDelete = user.isAdmin || (!!owner && owner.hostId === user.id);
  if (!canDelete) return new NextResponse('Não autorizado', { status: 403 });
  try {
    await deleteRecording(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro ao excluir', { status: 500 });
  }
}
