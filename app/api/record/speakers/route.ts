import { NextRequest, NextResponse } from 'next/server';
import { readJson, writeJson } from '@/lib/recordings';
import { isValidRoomName, verifyRoomToken } from '@/lib/livekitAuth';

export const dynamic = 'force-dynamic';

const MAX_EVENTS_PER_CALL = 500;
const MAX_EVENTS_STORED = 8000;
const MAX_NAME_LEN = 80;
const MAX_EVENT_MS = 10 * 60 * 1000; // intervalo contínuo máximo aceito
const RETENTION_MS = 48 * 60 * 60 * 1000; // sessões antigas na mesma sala expiram

interface SpeakerEvent {
  name: string;
  start: number;
  end: number;
}

/**
 * Linha do tempo de "quem estava falando em cada instante", enviada pelo
 * cliente do anfitrião (RoomEvent.ActiveSpeakersChanged do LiveKit). O worker
 * de transcrição cruza esses intervalos com a diarização e identifica cada
 * voz por MEDIÇÃO — sem depender do palpite do LLM. Timestamps chegam no
 * relógio do navegador; `sentAt` permite convertê-los ao relógio do servidor.
 */
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

    const body = (await req.json().catch(() => ({}))) as {
      sentAt?: unknown;
      events?: unknown;
    };
    const sentAt = Number(body.sentAt);
    // Defasagem entre o relógio do navegador e o do servidor (inclui a latência
    // da requisição — ruído de centenas de ms, irrelevante para a correlação).
    const skewMs = Number.isFinite(sentAt) ? Date.now() - sentAt : 0;

    const incoming: SpeakerEvent[] = (Array.isArray(body.events) ? body.events : [])
      .slice(0, MAX_EVENTS_PER_CALL)
      .flatMap((e) => {
        if (!e || typeof e !== 'object') return [];
        const { name, start, end } = e as Record<string, unknown>;
        if (typeof name !== 'string' || !name.trim()) return [];
        const s = Number(start);
        const f = Number(end);
        if (!Number.isFinite(s) || !Number.isFinite(f) || f <= s || f - s > MAX_EVENT_MS) return [];
        return [{ name: name.trim().slice(0, MAX_NAME_LEN), start: s + skewMs, end: f + skewMs }];
      });
    if (!incoming.length) return NextResponse.json({ ok: true });

    const key = `speakers/${roomName}.json`;
    const existing = (await readJson<{ events?: SpeakerEvent[] }>(key)) ?? {};
    const cutoff = Date.now() - RETENTION_MS;
    const events = [...(existing.events ?? []), ...incoming]
      .filter((e) => e.end >= cutoff)
      .slice(-MAX_EVENTS_STORED);
    await writeJson(key, { events, updatedAt: new Date().toISOString() });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('record/speakers:', e);
    return new NextResponse('erro ao registrar atividade de voz', { status: 500 });
  }
}
