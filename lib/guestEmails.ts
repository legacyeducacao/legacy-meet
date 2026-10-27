/**
 * E-mails de convidados (clientes) digitados ao agendar — recebem o convite
 * do Google Agenda com o link da sala. Aceita lista ou texto separado por
 * vírgula, ponto e vírgula, espaço ou quebra de linha.
 */
export const MAX_GUEST_EMAILS = 20;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

export function parseGuestEmails(raw: unknown): { emails: string[]; invalid: string[] } {
  const parts = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(/[\s,;]+/))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!EMAIL_RE.test(p)) {
      if (!invalid.includes(p)) invalid.push(p);
    } else if (!emails.includes(p) && emails.length < MAX_GUEST_EMAILS) {
      emails.push(p);
    }
  }
  return { emails, invalid };
}
