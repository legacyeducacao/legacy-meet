import crypto from 'crypto';

// Chave para assinar o link de anfitrião. O CRM (ou o app) gera um link de host
// com uma assinatura por sala; quem abrir esse link entra como anfitrião mesmo
// sem o cookie de login da equipe. Usa HOST_LINK_SECRET ou cai no segredo da
// LiveKit (estável e server-side; só o digest aparece na URL).
const SECRET = process.env.HOST_LINK_SECRET || process.env.LIVEKIT_API_SECRET || '';

export function signHostKey(roomName: string): string {
  if (!SECRET) return '';
  return crypto.createHmac('sha256', SECRET).update(roomName).digest('hex').slice(0, 32);
}

export function verifyHostKey(roomName: string, key?: string | null): boolean {
  if (!key || !SECRET) return false;
  const expected = signHostKey(roomName);
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
