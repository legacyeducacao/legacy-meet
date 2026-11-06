import { after, NextRequest, NextResponse } from 'next/server';
import { isEnabled, sweep } from '@/lib/execscore';
import { isWorkerCall } from '@/lib/execscoreAuth';

export const dynamic = 'force-dynamic';

let running = false;

/**
 * Varredor chamado periodicamente pelo worker: envia reuniões cujo executor
 * escolheu os pilares, cujo prazo de escolha venceu (vai com todos os
 * pilares) ou cujo envio falhou e pode ser retentado.
 */
export async function POST(req: NextRequest) {
  if (!isWorkerCall(req)) return new NextResponse('não autorizado', { status: 401 });
  if (!isEnabled()) return NextResponse.json({ ok: true, ignorada: 'integração desligada' });
  if (running) return NextResponse.json({ ok: true, emAndamento: true }, { status: 202 });

  running = true;
  after(async () => {
    try {
      const r = await sweep();
      if (r.tentadas) console.log(`execscore: varredura ${r.enviadas}/${r.tentadas} enviadas`);
    } catch (e) {
      console.error('execscore: varredura', e);
    } finally {
      running = false;
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
