import { NextRequest, NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';

export const dynamic = 'force-dynamic';

function roomService() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
  const host = new URL(LIVEKIT_URL!);
  host.protocol = 'https:';
  return new RoomServiceClient(host.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// Recusa um convidado: remove da sala.
export async function POST(req: NextRequest) {
  const staffPass = process.env.STAFF_PASSWORD;
  if (staffPass && req.cookies.get('staff_auth')?.value !== staffPass) {
    return new NextResponse('Não autorizado', { status: 401 });
  }
  const { roomName, identity } = (await req.json().catch(() => ({}))) as {
    roomName?: string;
    identity?: string;
  };
  if (!roomName || !identity) {
    return new NextResponse('roomName e identity são obrigatórios', { status: 400 });
  }
  try {
    await roomService().removeParticipant(roomName, identity);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro', { status: 500 });
  }
}
