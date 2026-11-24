import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getRoomOwners, listarNoShowSemGravacao, listRecordings } from '@/lib/recordings';
import { statusDasReunioes } from '@/lib/execscore';
import { podeVerGravacao } from '@/lib/acessoGravacoes';

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
        noShow: owner?.noShow ?? false,
        meetingId: owner?.meetingId ?? null,
        coHostIds: owner?.coHostIds ?? [],
        // Excluir é do dono ou admin (comercial vê tudo mas não apaga de colega).
        canDelete: user.isAdmin || (!!owner?.hostId && owner.hostId === user.id),
      };
    });

    // No-show sem gravação (o cliente não entrou): sem arquivo não haveria card.
    const noShows = (await listarNoShowSemGravacao(new Set(roomNames))).map((n) => ({
      id: `noshow:${n.meetingId}`,
      title: n.title ?? undefined,
      roomName: n.roomName,
      createdAt: n.createdAt,
      durationSeconds: 0,
      storage: 's3' as const,
      transcriptionStatus: 'none',
      utteranceCount: 0,
      semGravacao: true,
      hostId: n.hostId,
      hostName: n.hostName,
      metaHost: null,
      sector: n.sector,
      noShow: true,
      meetingId: n.meetingId,
      coHostIds: n.coHostIds,
      canDelete: false,
    }));
    const enrichedTodos = [...enriched, ...noShows].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

    // Admin e quem tem "Ver todas as gravações": todas. Comercial: todas do
    // Comercial; Executoria: todas da Executoria; Acesso geral: as duas. As
    // próprias (dono ou anfitrião adicional) sempre. Ver lib/acessoGravacoes.ts.
    const scoped = enrichedTodos.filter((r) => podeVerGravacao(user, r));
    // Situação do envio ao ExecScore (selo no card: enviada, na fila, erro...).
    const execscore = await statusDasReunioes(
      scoped.filter((r) => r.sector === 'executoria' && r.meetingId).map((r) => r.meetingId as string),
    ).catch(() => new Map<string, string>());
    return NextResponse.json(
      scoped.map(({ meetingId, ...r }) => ({ ...r, execscoreStatus: (meetingId && execscore.get(meetingId)) || null })),
    );
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'erro', { status: 500 });
  }
}
