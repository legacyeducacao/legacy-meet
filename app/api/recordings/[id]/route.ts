import { NextResponse } from 'next/server';
import { getManifest } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const manifest = await getManifest(id);
  if (!manifest) {
    return new NextResponse('Gravação não encontrada', { status: 404 });
  }
  return NextResponse.json(manifest);
}
