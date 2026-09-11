import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { writeJson } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

const WEBHOOK_SECRET_HEADER = 'x-legacy-webhook-secret';
// Prefixo onde o worker procura o aviso de "transcrição pronta" (env DONE_PREFIX no worker).
const DONE_PREFIX = process.env.TRANSCRIPTION_DONE_PREFIX ?? 'asr-done/';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

interface WebhookBody {
  transcript_id?: string;
  status?: string;
}

/**
 * Webhook da AssemblyAI (configurado pelo worker em `webhook_url` ao criar a
 * transcrição). A AssemblyAI manda `{ transcript_id, status }` com status
 * `completed` ou `error` e exige 2xx em 10 s — por isso o handler só grava um
 * marker no MinIO (`asr-done/<transcript_id>.json`) e devolve. Quem busca o
 * resultado e finaliza é o worker, no próximo ciclo.
 *
 * Proteção: header `X-Legacy-Webhook-Secret` precisa bater com
 * ASSEMBLYAI_WEBHOOK_SECRET. Resposta 4xx = a AssemblyAI não retenta.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
  if (!secret) {
    return new NextResponse('ASSEMBLYAI_WEBHOOK_SECRET não configurado', { status: 503 });
  }
  if (!safeEqual(req.headers.get(WEBHOOK_SECRET_HEADER) ?? '', secret)) {
    return new NextResponse('não autorizado', { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as WebhookBody | null;
  const transcriptId = body?.transcript_id?.trim();
  const status = body?.status?.trim();
  if (!transcriptId || !/^[\w-]+$/.test(transcriptId) || !status) {
    return new NextResponse('corpo inválido', { status: 400 });
  }

  const recordingId = req.nextUrl.searchParams.get('recordingId');
  try {
    await writeJson(`${DONE_PREFIX}${transcriptId}.json`, {
      status,
      recordingId,
      at: new Date().toISOString(),
    });
  } catch (e) {
    // 5xx: a AssemblyAI retenta (até 10x a cada 10 s) — o marker é idempotente.
    console.error('webhook assemblyai: falha ao gravar marker', e);
    return new NextResponse('erro ao registrar', { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
