import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { verifyHostKey } from '@/lib/hostLink';

export const dynamic = 'force-dynamic';

function roomService() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
  const host = new URL(LIVEKIT_URL!);
  host.protocol = 'https:';
  return new RoomServiceClient(host.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// Admite um convidado: concede permissão de publicar/assinar (host autorizou).
export async function POST(req: NextRequest) {
  const { roomName, identity, hostKey } = (await req.json().catch(() => ({}))) as {
    roomName?: string;
    identity?: string;
    hostKey?: string;
  };
  if (!roomName || !identity) {
    return new NextResponse('roomName e identity são obrigatórios', { status: 400 });
  }
  // Host = equipe logada (cookie) ou link de anfitrião assinado (hostKey).
  const staffPass = process.env.STAFF_PASSWORD;
  const authorized =
    !staffPass ||
    req.cookies.get('staff_auth')?.value === staffPass ||
    verifyHostKey(roomName, hostKey);
  if (!authorized) {
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
