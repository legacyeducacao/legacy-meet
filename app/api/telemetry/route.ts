import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listTelemetry, storeTelemetry, validateTelemetry } from '@/lib/telemetryStore';

export const dynamic = 'force-dynamic';

/**
 * Recebe eventos de telemetria do cliente da sala (erros de câmera/microfone,
 * quedas e reconexões) — ver lib/telemetry.ts. Público como as demais rotas
 * usadas por convidados; o payload é validado e limitado em tamanho.
 *
 * Cada evento vira uma linha JSON no log do app (grep `"telemetry"`) e um
 * objeto em `telemetry/<dia>/` no MinIO. GET lista o dia (só admin).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '');
  if (raw.length > 8_000) return new NextResponse('payload grande demais', { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse('JSON inválido', { status: 400 });
  }
  const event = validateTelemetry(body);
  if (!event) return new NextResponse('evento inválido', { status: 400 });

  console.log(JSON.stringify({ telemetry: true, ...event }));
  try {
    await storeTelemetry(event);
  } catch (e) {
    // O log acima já registrou; o MinIO fora do ar não pode virar erro para o cliente.
    console.error('telemetry: falha ao gravar no MinIO', e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return new NextResponse('Não autorizado', { status: 401 });
  const date = req.nextUrl.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new NextResponse('date inválida', { status: 400 });
  return NextResponse.json(await listTelemetry(date));
}
