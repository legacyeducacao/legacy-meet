import crypto from 'crypto';

// Mesmo segredo do link de anfitrião: estável e server-side.
const secret = () => process.env.HOST_LINK_SECRET || process.env.LIVEKIT_API_SECRET || '';

const POSTFIX_RE = /^[a-z0-9]{4,8}$/;

function sign(postfix: string): string {
  return crypto.createHmac('sha256', secret()).update(`postfix:${postfix}`).digest('hex').slice(0, 16);
}

/**
 * Sufixo aleatório da identidade (`nome__sufixo`) ASSINADO. A identidade é o
 * que o LiveKit usa para saber "é a mesma pessoa": um valor vindo de cookie
 * sem assinatura permitia forjar a identidade do anfitrião e derrubá-lo com
 * DUPLICATE_IDENTITY. Formato do cookie: `<sufixo>.<assinatura>`.
 */
export function newSignedPostfix(): { postfix: string; cookieValue: string } {
  const postfix = crypto.randomBytes(3).toString('hex').slice(0, 6);
  return { postfix, cookieValue: `${postfix}.${sign(postfix)}` };
}

/** Sufixo do cookie, se a assinatura for válida; senão null. */
export function verifySignedPostfix(cookieValue: string | undefined | null): string | null {
  if (!cookieValue || !secret()) return null;
  const [postfix, sig] = cookieValue.split('.');
  if (!postfix || !sig || !POSTFIX_RE.test(postfix)) return null;
  const expected = sign(postfix);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return postfix;
}
