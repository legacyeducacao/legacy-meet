/**
 * Destino depois do login (`/login?next=...`). Só caminhos do próprio Meet:
 * um `next` externo ("//evil.com", "https://...") viraria redirecionamento
 * aberto para phishing com a cara do nosso login.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  const next = raw.trim();
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/^\/login(?:[/?#]|$)/.test(next)) return '/';
  return next;
}
