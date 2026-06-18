import { NextRequest, NextResponse } from 'next/server';
import { authorizeHostAction, roomService } from '@/lib/livekitAuth';

export const dynamic = 'force-dynamic';

// Promove um participante a co-anfitrião (atributo cohost='true' + garante
// permissão de publicar). Só o anfitrião principal pode promover (allowCohost:false).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    roomName?: string;
    identity?: string;
    demote?: boolean;
    hostKey?: string;
    participantToken?: string;
  };
  const { roomName, identity } = body;
  if (!roomName || !identity) {
    return new NextResponse('roomName e identity são obrigatórios', { status: 400 });
  }
  if (!(await authorizeHostAction(req, roomName, body, { allowCohost: false }))) {
    return new NextResponse('Não autorizado', { status: 401 });
  }
  try {
    await roomService().updateParticipant(roomName, identity, {
      attributes: { cohost: body.demote ? '' : 'true' },
      permission: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateMetadata: true,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro', { status: 500 });
  }
}
