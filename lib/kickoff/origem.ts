/**
 * Origem do visitante das rotas públicas do kickoff, para o limite de tentativas
 * no banco. O banco nunca vê o IP: só um HMAC dele com KICKOFF_ORIGEM_SECRET.
 *
 * De onde vem o IP (verificado em 12/11/2026): o domínio público do Meet passa pela
 * Cloudflare (IPs 104.21.x/172.67.x, "Server: cloudflare", CF-RAY) e depois pelo
 * proxy do EasyPanel (Traefik) até o Next. Por isso:
 *   - padrão: "cf-connecting-ip", que a Cloudflare preenche com o IP de quem chegou
 *     a ela, sobrescrevendo o que o visitante mandar;
 *   - NUNCA o primeiro item de x-forwarded-for (o visitante escreve o que quiser ali).
 *   - alternativa (KICKOFF_IP_CABECALHO=x-forwarded-for): o item que o proxy
 *     confiável mais próximo acrescentou, contando da DIREITA
 *     (KICKOFF_PROXIES_CONFIAVEIS, padrão 1).
 * Só vale se o servidor não puder ser alcançado sem passar pela Cloudflare (senão o
 * cabeçalho pode ser forjado chamando a origem direto). Isso é configuração externa
 * (firewall do servidor / Authenticated Origin Pulls) e não foi verificado.
 *
 * KICKOFF_ORIGEM_SECRET é obrigatória em produção (NODE_ENV=production), com 32+
 * caracteres; sem ela, as rotas públicas respondem 503. Fora de produção, sem a
 * chave, usa sha256 simples (só para desenvolvimento e testes).
 */
import { createHash, createHmac } from 'node:crypto';

export type FonteDoIp = 'cf-connecting-ip' | 'x-forwarded-for';
type Env = Record<string, string | undefined>;

export type ConfiguracaoDaOrigem =
  | { ok: true; fonte: FonteDoIp; saltos: number; chave: string | null }
  | { ok: false; motivo: string };

const PRODUCAO = (env: Env) => env.NODE_ENV === 'production';

export function configuracaoDaOrigem(env: Env = process.env): ConfiguracaoDaOrigem {
  const fonte = (env.KICKOFF_IP_CABECALHO?.trim().toLowerCase() || 'cf-connecting-ip') as FonteDoIp;
  if (fonte !== 'cf-connecting-ip' && fonte !== 'x-forwarded-for') {
    return { ok: false, motivo: 'KICKOFF_IP_CABECALHO inválida: use "cf-connecting-ip" ou "x-forwarded-for".' };
  }
  const saltos = Number(env.KICKOFF_PROXIES_CONFIAVEIS?.trim() || '1');
  if (!Number.isInteger(saltos) || saltos < 1 || saltos > 5) {
    return { ok: false, motivo: 'KICKOFF_PROXIES_CONFIAVEIS inválida: use um número de 1 a 5.' };
  }
  const chave = env.KICKOFF_ORIGEM_SECRET?.trim() || null;
  if (chave && chave.length < 32) return { ok: false, motivo: 'KICKOFF_ORIGEM_SECRET curta demais: use 32 caracteres ou mais.' };
  if (!chave && PRODUCAO(env)) {
    return { ok: false, motivo: 'KICKOFF_ORIGEM_SECRET não configurada: obrigatória em produção para o limite de tentativas.' };
  }
  return { ok: true, fonte, saltos, chave };
}

const PARECE_IP = /^[0-9a-f:.]{2,45}$/i;

/** IP do visitante pela fonte configurada; "?" quando não há (todos caem na mesma chave). */
export function ipDoVisitante(headers: Headers, fonte: FonteDoIp = 'cf-connecting-ip', saltos = 1): string {
  if (fonte === 'cf-connecting-ip') {
    const ip = headers.get('cf-connecting-ip')?.trim() ?? '';
    return PARECE_IP.test(ip) ? ip : '?';
  }
  const lista = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const ip = lista[lista.length - saltos] ?? '';
  return PARECE_IP.test(ip) ? ip : '?';
}

/** "ip:<32 hex>". Lança se a configuração estiver errada (a rota responde 503). */
export function origemDoVisitante(headers: Headers, env: Env = process.env): string {
  const c = configuracaoDaOrigem(env);
  if (!c.ok) throw new Error(c.motivo);
  const ip = ipDoVisitante(headers, c.fonte, c.saltos);
  const hash = c.chave ? createHmac('sha256', c.chave).update(ip).digest('hex') : createHash('sha256').update(ip).digest('hex');
  return `ip:${hash.slice(0, 32)}`;
}
