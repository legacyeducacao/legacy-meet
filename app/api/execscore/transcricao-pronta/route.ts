import { after, NextRequest, NextResponse } from 'next/server';
import { dispatchMeeting, isEnabled, registerTranscriptReady } from '@/lib/execscore';
import { isWorkerCall } from '@/lib/execscoreAuth';

export const dynamic = 'force-dynamic';

/**
 * O worker chama ao gravar o manifesto de uma transcrição completa.
 * Responde na hora; o registro e o envio ao ExecScore (chamada de IA que leva
 * 1 a 3 minutos) rodam depois da resposta, sem segurar o worker.
 */
export async function POST(req: NextRequest) {
  if (!isWorkerCall(req)) return new NextResponse('não autorizado', { status: 401 });
  if (!isEnabled()) return NextResponse.json({ ok: true, ignorada: 'integração desligada' });

  const body = (await req.json().catch(() => null)) as { recordingId?: string } | null;
  const recordingId = body?.recordingId?.trim();
  if (!recordingId || !/^[\w-]+__[\w-]+$/.test(recordingId)) {
    return new NextResponse('recordingId inválido', { status: 400 });
  }

  after(async () => {
    try {
      const r = await registerTranscriptReady(recordingId);
      if (r.status === 'registrada' && r.meetingId) await dispatchMeeting(r.meetingId);
      else console.log(`execscore: gravação ${recordingId} ignorada (${r.motivo})`);
    } catch (e) {
      // O varredor tenta de novo depois; aqui só registra.
      console.error(`execscore: transcrição pronta ${recordingId}:`, e);
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
