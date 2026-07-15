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
        // Nome exibido: título cadastrado na reunião (agenda/ao iniciar) tem prioridade
        // sobre o título do manifesto (que pode vir vazio). O card cai no nome da sala só
        // quando nenhum dos dois existe.
        title: owner?.title ?? r.title,
        hostId: owner?.hostId ?? null,
        hostName: owner?.hostName ?? null,
        metaHost: r.metaHost ?? null,
        sector: owner?.sector ?? null,
        // Excluir é do dono ou admin (comercial vê tudo mas não apaga de colega).
        canDelete: user.isAdmin || (!!owner?.hostId && owner.hostId === user.id),
      };
    });

    let scoped;
    if (user.isAdmin) {
      // Admin/MASTER vê tudo.
      scoped = enriched;
    } else if (user.sector === 'comercial') {
      // Comercial vê TODAS as reuniões do comercial (qualquer host), menos executoria.
      scoped = enriched.filter((r) => r.sector === 'comercial');
    } else {
      // Demais (executoria / ambos / sem setor): apenas as próprias.
      scoped = enriched.filter((r) => r.hostId !== null && r.hostId === user.id);
    }
    return NextResponse.json(scoped);
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'erro', { status: 500 });
  }
}
