import { NextRequest, NextResponse } from 'next/server';
import { metaKey, readJson, writeJson, type MeetingMeta } from '@/lib/recordings';
import { isValidRoomName, verifyRoomToken } from '@/lib/livekitAuth';
import { mergeParticipants } from '@/worker/lib/participants';

export const dynamic = 'force-dynamic';

const MAX_NAMES = 50;
const MAX_NAME_LEN = 80;

// Recebe os nomes dos participantes da reunião (enviados pelo cliente ao entrar
// e ao sair) e os mescla no meta sidecar, para o worker identificar os speakers.
// Exige o token do participante (prova que quem chama está na sala): antes
// qualquer um com o nome da sala lia a lista de presentes e injetava nomes.
export async function POST(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');
    if (!isValidRoomName(roomName)) {
      return new NextResponse('roomName ausente ou inválido', { status: 400 });
    }
    const token = req.nextUrl.searchParams.get('token') ?? undefined;
    if (!verifyRoomToken(token, roomName)) {
      return new NextResponse('Não autorizado', { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { names?: unknown };
    const names = (Array.isArray(body.names) ? body.names : [])
      .filter((n): n is string => typeof n === 'string' && !!n.trim())
      .map((n) => n.trim().slice(0, MAX_NAME_LEN))
      .slice(0, MAX_NAMES);

    const key = metaKey(roomName);
    const meta = (await readJson<MeetingMeta>(key)) ?? {};
    meta.participants = mergeParticipants(meta.participants ?? [], names);
    meta.participantsUpdatedAt = new Date().toISOString();
    await writeJson(key, meta);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('record/participants:', e);
    return new NextResponse('erro ao registrar participantes', { status: 500 });
  }
}
