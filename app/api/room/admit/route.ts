import { NextRequest, NextResponse } from 'next/server';
import { authorizeHostAction, roomService } from '@/lib/livekitAuth';

export const dynamic = 'force-dynamic';

// Admite um convidado: concede permissão de publicar/assinar (host autorizou).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    roomName?: string;
    identity?: string;
    hostKey?: string;
    participantToken?: string;
  };
  const { roomName, identity } = body;
  if (!roomName || !identity) {
    return new NextResponse('roomName e identity são obrigatórios', { status: 400 });
  }
  if (!(await authorizeHostAction(req, roomName, body))) {
    return new NextResponse('Não autorizado', { status: 401 });
  }
  try {
    await roomService().updateParticipant(roomName, identity, {
      permission: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateMetadata: true,
      },
      attributes: { lobby: '' },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro', { status: 500 });
  }
}
