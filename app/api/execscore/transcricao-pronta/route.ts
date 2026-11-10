import { after, NextRequest, NextResponse } from 'next/server';
import { dispatchMeeting, isEnabled, registerTranscriptReady, roomFromRecordingId } from '@/lib/execscore';
import { isWorkerCall } from '@/lib/execscoreAuth';
import { generateSummary, summaryEnabled } from '@/lib/meetingSummary';
import { registrarDuracao } from '@/lib/agenda/duracoes';

export const dynamic = 'force-dynamic';

/**
 * O worker chama ao gravar o manifesto de uma transcrição completa.
 * Responde na hora; depois da resposta rodam, em paralelo:
 * - o resumo da reunião (Executoria), guardado em resumos/<sala>.json;
 * - o registro e o envio ao ExecScore (chamada de IA que leva 1 a 3 minutos).
 */
export async function POST(req: NextRequest) {
  if (!isWorkerCall(req)) return new NextResponse('não autorizado', { status: 401 });

  const body = (await req.json().catch(() => null)) as { recordingId?: string } | null;
  const recordingId = body?.recordingId?.trim();
  if (!recordingId || !/^[\w-]+__[\w-]+$/.test(recordingId)) {
    return new NextResponse('recordingId inválido', { status: 400 });
  }
  const execscore = isEnabled();
  const resumo = summaryEnabled();
  if (!execscore && !resumo) {
    after(() => registrarDuracao(recordingId).then(() => undefined));
    return NextResponse.json({ ok: true, ignorada: 'integração desligada' });
  }

  after(async () => {
    // Duração real no banco (painel de horas da agenda). Não depende de integração.
    const tarefas: Promise<void>[] = [registrarDuracao(recordingId).then(() => undefined)];
    const room = roomFromRecordingId(recordingId);
    if (resumo && room) {
      tarefas.push(
        generateSummary(room)
          .then((r) => {
            if (r.status === 'ignorado') console.log(`resumo: ${room} ignorado (${r.motivo})`);
          })
          .catch((e) => console.error(`resumo: falha em ${room}:`, e)),
      );
    }
    if (execscore) {
      tarefas.push(
        (async () => {
          try {
            const r = await registerTranscriptReady(recordingId);
            if (r.status === 'registrada' && r.meetingId) await dispatchMeeting(r.meetingId);
            else console.log(`execscore: gravação ${recordingId} ignorada (${r.motivo})`);
          } catch (e) {
            // O varredor tenta de novo depois; aqui só registra.
            console.error(`execscore: transcrição pronta ${recordingId}:`, e);
          }
        })(),
      );
    }
    await Promise.all(tarefas);
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
