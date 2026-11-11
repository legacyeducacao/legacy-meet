import { after, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { dispatchMeeting, reabrirErros, resumoErros } from '@/lib/execscore';

export const dynamic = 'force-dynamic';

/** GET: quantas reuniões não chegaram ao ExecScore (aviso dos admins). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return new NextResponse('Não autorizado', { status: 403 });
  try {
    return NextResponse.json(await resumoErros());
  } catch (e) {
    console.error('execscore erros GET', e);
    return new NextResponse('erro ao carregar', { status: 500 });
  }
}

/** POST: reenvia todas as reuniões com erro (depois de recarregar os créditos, por exemplo). */
export async function POST() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return new NextResponse('Não autorizado', { status: 403 });
  try {
    const ids = await reabrirErros();
    // Um por vez, em segundo plano: cada avaliação leva até alguns minutos.
    after(async () => {
      for (const id of ids) await dispatchMeeting(id).catch((e) => console.error('execscore reenviar', id, e));
    });
    return NextResponse.json({ reenviadas: ids.length });
  } catch (e) {
    console.error('execscore erros POST', e);
    return new NextResponse('erro ao reenviar', { status: 500 });
  }
}
