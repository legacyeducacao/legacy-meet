import { NextRequest, NextResponse } from 'next/server';
import { metaKey, readJson, writeJson, type MeetingMeta } from '@/lib/recordings';
import { mergeParticipants } from '@/worker/lib/participants';

export const dynamic = 'force-dynamic';

// Recebe os nomes dos participantes da reunião (enviados pelo cliente ao sair)
// e os mescla no meta sidecar, para o worker identificar os speakers.
export async function POST(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');
    if (!roomName) {
      return new NextResponse('roomName ausente', { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { names?: string[] };
    const names = Array.isArray(body.names) ? body.names.filter((n) => !!n && n.trim()) : [];

    const key = metaKey(roomName);
    const meta = (await readJson<MeetingMeta>(key)) ?? {};
    meta.participants = mergeParticipants(meta.participants ?? [], names);
    await writeJson(key, meta);

    return NextResponse.json({ ok: true, participants: meta.participants });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : 'erro', { status: 500 });
  }
}
