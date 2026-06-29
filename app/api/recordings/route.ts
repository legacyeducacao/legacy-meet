import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getRoomOwners, listRecordings } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return new NextResponse('Não autorizado', { status: 401 });

    const all = await listRecordings();

    // Extrair roomName de cada id (formato: <roomName>__<stamp>)
    const roomNames = [...new Set(all.map((r) => r.id.split('__')[0]))];
    const owners = await getRoomOwners(roomNames);

    // Enriquecer itens com hostName e sector
    const enriched = all.map((r) => {
      const roomName = r.id.split('__')[0];
      const owner = owners.get(roomName) ?? null;
      return {
        ...r,
        hostId: owner?.hostId ?? null,
        hostName: owner?.hostName ?? r.metaHost ?? null,
        sector: owner?.sector ?? null,
      };
    });

    const isMaster = user.role === 'MASTER';

    const visible = isMaster
      ? enriched
      : enriched.filter((r) => r.hostId !== null && r.hostId === user.id);

    return NextResponse.json(visible);
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'erro', { status: 500 });
  }
}
