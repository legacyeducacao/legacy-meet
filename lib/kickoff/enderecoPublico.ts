/**
 * Endereço oficial do agendamento público, de onde saem os links que a equipe manda
 * às empresas: KICKOFF_PUBLIC_BASE_URL (ex.: https://<domínio oficial da Legacy>).
 * Não depende do navegador de quem copia. Sem a variável, ou com um valor que não
 * sirva para cliente (http, localhost, IP de rede interna, com usuário, query ou
 * fragmento), gerar e reemitir convites são recusados com o motivo.
 */
import { linkDoAgendamento } from './publico';

export type EnderecoPublico = { ok: true; base: string } | { ok: false; motivo: string };

const INTERNO = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1?\])$/i;

export function enderecoPublico(env: Record<string, string | undefined> = process.env): EnderecoPublico {
  const bruto = env.KICKOFF_PUBLIC_BASE_URL?.trim();
  if (!bruto) {
    return { ok: false, motivo: 'KICKOFF_PUBLIC_BASE_URL não configurada: defina o endereço oficial do agendamento (https://…) no servidor.' };
  }
  let u: URL;
  try {
    u = new URL(bruto);
  } catch {
    return { ok: false, motivo: 'KICKOFF_PUBLIC_BASE_URL inválida: use um endereço completo, como https://dominio.com.br.' };
  }
  if (u.protocol !== 'https:') return { ok: false, motivo: 'KICKOFF_PUBLIC_BASE_URL precisa começar com https://.' };
  if (INTERNO.test(u.hostname)) return { ok: false, motivo: 'KICKOFF_PUBLIC_BASE_URL aponta para um endereço local ou interno: use o domínio público oficial.' };
  if (u.username || u.password || u.search || u.hash) {
    return { ok: false, motivo: 'KICKOFF_PUBLIC_BASE_URL não pode ter usuário, senha, parâmetros (?) nem fragmento (#).' };
  }
  return { ok: true, base: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}

/**
 * Hosts de onde um formulário nosso pode chegar: o do pedido (como o proxy o repassa)
 * e o do endereço oficial. Usado para conferir a origem do POST de entrada na reunião.
 */
export function hostsDaAplicacao(req: { headers: Headers; nextUrl: { host: string } }, env: Record<string, string | undefined> = process.env): string[] {
  const hosts = [req.nextUrl.host, req.headers.get('host') ?? ''];
  const oficial = enderecoPublico(env);
  if (oficial.ok) hosts.push(new URL(oficial.base).host);
  return [...new Set(hosts.filter(Boolean))];
}

/** Link do convite no endereço oficial; null se o endereço não estiver configurado. */
export function linkOficial(codigo: string, env: Record<string, string | undefined> = process.env): string | null {
  const e = enderecoPublico(env);
  return e.ok ? linkDoAgendamento(e.base, codigo) : null;
}
