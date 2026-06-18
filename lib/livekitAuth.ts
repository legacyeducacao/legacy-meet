import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { verifyHostKey } from './hostLink';

export function roomService() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
  const host = new URL(LIVEKIT_URL!);
  host.protocol = 'https:';
  return new RoomServiceClient(host.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

// Verifica um token (JWT HS256) do LiveKit assinado com LIVEKIT_API_SECRET e
// devolve o identity (sub) se for válido e para a sala certa. Usado para
// autorizar ações de um co-anfitrião (que não tem cookie nem hostKey).
function verifyLivekitToken(token: string | undefined, roomName: string): string | null {
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    if (payload.video?.room !== roomName) return null;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Autoriza uma ação de anfitrião na sala. Aceita:
 *  - equipe logada (cookie staff_auth), ou
 *  - link de anfitrião assinado (hostKey), ou
 *  - co-anfitrião: token do participante válido + atributo cohost='true'.
 * Sem STAFF_PASSWORD configurado, libera tudo (modo dev).
 */
export async function authorizeHostAction(
  req: NextRequest,
  roomName: string,
  body: { hostKey?: string; participantToken?: string },
  opts: { allowCohost?: boolean } = {},
): Promise<boolean> {
  const { allowCohost = true } = opts;
  const staffPass = process.env.STAFF_PASSWORD;
  if (!staffPass) return true;
  if (req.cookies.get('staff_auth')?.value === staffPass) return true;
  if (verifyHostKey(roomName, body.hostKey)) return true;
  if (!allowCohost) return false;
  const identity = verifyLivekitToken(body.participantToken, roomName);
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
