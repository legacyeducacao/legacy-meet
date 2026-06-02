import { NextRequest, NextResponse } from 'next/server';
import { generateRoomId } from '@/lib/client-utils';
import { metaKey, writeJson } from '@/lib/recordings';
import { signHostKey } from '@/lib/hostLink';

export const dynamic = 'force-dynamic';

/**
 * Cria uma reunião (para integração com CRM/agendamento).
 * Protegido por API key no header `x-api-key` (env MEETINGS_API_KEY).
 *
 * Body (JSON, todos opcionais):
 *   { title?, host?, record?, transcribe?, roomName? }
 *
 * Retorna { roomName, hostUrl, guestUrl }.
 *  - hostUrl: link do anfitrião (nome pré-preenchido + gravação/transcrição ligadas)
 *  - guestUrl: link para os convidados (entram digitando o próprio nome)
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.MEETINGS_API_KEY;
  if (!apiKey) {
    return new NextResponse('MEETINGS_API_KEY não configurado no servidor', { status: 500 });
  }
  if (req.headers.get('x-api-key') !== apiKey) {
    return new NextResponse('Não autorizado', { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    host?: string;
    record?: boolean;
    transcribe?: boolean;
    roomName?: string;
  };

  const title = (body.title ?? '').trim();
  const host = (body.host ?? '').trim();
  const record = body.record !== false; // padrão: gravar
  const transcribe = record && body.transcribe !== false; // padrão: transcrever
  const roomName =
    (body.roomName?.trim() || generateRoomId()).toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  // Registra os metadados desde já (título/host) — assim a transcrição sai com o
  // título certo, independentemente de quem entrar primeiro na sala.
  try {
    await writeJson(metaKey(roomName), {
      title,
      host,
      createdAt: new Date().toISOString(),
      participants: host ? [host] : [],
    });
  } catch (e) {
    return new NextResponse(
      'Falha ao registrar a reunião: ' + (e instanceof Error ? e.message : 'erro'),
      { status: 500 },
    );
  }

  const base = (process.env.APP_BASE_URL || req.nextUrl.origin).replace(/\/$/, '');
  const hostParams = new URLSearchParams();
  if (host) hostParams.set('name', host);
  if (title) hostParams.set('title', title);
  hostParams.set('rec', record ? '1' : '0');
  hostParams.set('tx', transcribe ? '1' : '0');
  // assinatura que concede o papel de anfitrião ao abrir este link (closer)
  const hostKey = signHostKey(roomName);
  if (hostKey) hostParams.set('h', hostKey);

  return NextResponse.json({
    roomName,
    hostUrl: `${base}/rooms/${roomName}?${hostParams.toString()}`,
    guestUrl: `${base}/rooms/${roomName}`,
  });
}
