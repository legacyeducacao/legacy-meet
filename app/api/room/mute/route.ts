import { NextRequest, NextResponse } from 'next/server';
import { authorizeHostAction, roomService } from '@/lib/livekitAuth';

export const dynamic = 'force-dynamic';

// Anfitrião (ou co-anfitrião) muta o microfone de um participante.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    roomName?: string;
    identity?: string;
    trackSid?: string;
    muted?: boolean;
    hostKey?: string;
    participantToken?: string;
  };
  const { roomName, identity, trackSid } = body;
  if (!roomName || !identity || !trackSid) {
    return new NextResponse('roomName, identity e trackSid são obrigatórios', { status: 400 });
  }
  if (!(await authorizeHostAction(req, roomName, body))) {
    return new NextResponse('Não autorizado', { status: 401 });
  }
  try {
    await roomService().mutePublishedTrack(roomName, identity, trackSid, body.muted ?? true);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro', { status: 500 });
  }
}
