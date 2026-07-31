import { WebhookReceiver } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { metaKey, readJson, writeJson, type MeetingMeta } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

/**
 * Webhook do LiveKit (configurar em livekit.yaml → webhook.urls; ver
 * worker/README.md). A assinatura JWT do próprio LiveKit é validada — sem ela a
 * requisição é recusada.
 *
 * - participant_joined: registro CONFIÁVEL dos participantes no servidor (o
 *   POST do navegador é best-effort e se perde quando a aba fecha).
 * - egress_ended: escreve o marker ready/<id>.json que libera o worker de
 *   transcrição imediatamente (sem ele, o worker espera o MP4 "esfriar" por
 *   EGRESS_MIN_AGE_SECONDS antes de processar).
 */
export async function POST(req: NextRequest) {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return new NextResponse('LiveKit não configurado', { status: 500 });
  }

  let event;
  try {
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    event = await receiver.receive(await req.text(), req.headers.get('Authorization') ?? undefined);
  } catch {
    return new NextResponse('assinatura inválida', { status: 401 });
  }

  try {
    if (event.event === 'participant_joined') {
      const roomName = event.room?.name;
      const name = event.participant?.name?.trim();
      const identity = event.participant?.identity ?? '';
      // EG_ = bot do egress (gravador), não é um participante real.
      if (roomName && name && !identity.startsWith('EG_')) {
        const key = metaKey(roomName);
        const meta = (await readJson<MeetingMeta>(key)) ?? {};
        meta.participants = [...new Set([...(meta.participants ?? []), name])];
        await writeJson(key, meta);
      }
    } else if (event.event === 'egress_ended') {
      const filename = event.egressInfo?.fileResults?.[0]?.filename ?? '';
      const m = filename.match(/([^/\\]+)\.mp4$/i);
      if (m) {
        await writeJson(`ready/${m[1]}.json`, { at: new Date().toISOString(), source: 'webhook' });
      }
    }
  } catch (e) {
    // Erro de processamento não devolve 5xx: o LiveKit re-tenta webhooks
    // falhados e os handlers acima são idempotentes, mas logar basta.
    console.error('webhook livekit:', e);
  }
  return NextResponse.json({ ok: true });
}
