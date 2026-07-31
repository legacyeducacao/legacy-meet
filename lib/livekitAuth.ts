import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { getCurrentUser } from '@/lib/auth';
import { verifyHostKey } from './hostLink';

export function roomService() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
  const host = new URL(LIVEKIT_URL!);
  host.protocol = 'https:';
  return new RoomServiceClient(host.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// Verifica um token (JWT HS256) do LiveKit assinado com LIVEKIT_API_SECRET e
// devolve o PAYLOAD se for válido e para a sala certa. O grant `video.roomAdmin`
// prova que é host (o connection-details só emite roomAdmin p/ staff/hostKey);
// `sub` é o identity (usado no caminho de co-anfitrião).
type LivekitPayload = {
  sub?: string;
  exp?: number;
  video?: { room?: string; roomAdmin?: boolean; roomJoin?: boolean };
};
function verifyLivekitPayload(token: string | undefined, roomName: string): LivekitPayload | null {
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as LivekitPayload;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    if (payload.video?.room !== roomName) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Token de PARTICIPANTE válido para a sala (grant roomJoin + sala correta).
 * Prova que quem chama está de fato na reunião — usado nos endpoints que
 * qualquer participante pode acionar (ex.: iniciar a gravação automática).
 */
export function verifyRoomToken(
  token: string | undefined,
  roomName: string,
): LivekitPayload | null {
  const payload = verifyLivekitPayload(token, roomName);
  return payload?.video?.roomJoin === true ? payload : null;
}

/**
 * Autoriza uma ação de anfitrião na sala. Aceita:
 *  - link de anfitrião assinado (hostKey), ou
 *  - usuário interno logado (sessão Supabase), ou
 *  - token do participante com grant de ADMIN da sala (host que entrou como
 *    staff/hostKey) — funciona mesmo sem o cookie de sessão (Meet embutido no
 *    CRM), ou
 *  - co-anfitrião: token válido + atributo cohost='true'.
 */
export async function authorizeHostAction(
  req: NextRequest,
  roomName: string,
  body: { hostKey?: string; participantToken?: string },
  opts: { allowCohost?: boolean } = {},
): Promise<boolean> {
  const { allowCohost = true } = opts;
  if (verifyHostKey(roomName, body.hostKey)) return true;

  // Token de host (roomAdmin) prova a permissão sem precisar do cookie — checado
  // antes do getCurrentUser (rede) porque é local e é o caso comum no CRM embutido.
  const payload = verifyLivekitPayload(body.participantToken, roomName);
  if (payload?.video?.roomAdmin === true) return true;

  const user = await getCurrentUser();
  if (user?.isStaff) return true;

  if (!allowCohost) return false;
  const identity = typeof payload?.sub === 'string' ? payload.sub : null;
  if (identity) {
    try {
      const p = await roomService().getParticipant(roomName, identity);
      if (p?.attributes?.cohost === 'true') return true;
    } catch {
      /* participante não encontrado */
    }
  }
  return false;
}
