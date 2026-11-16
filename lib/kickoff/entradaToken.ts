/**
 * Proteção da operação "Entrar na reunião" (POST /impulsao/reuniao/<código>/entrar).
 *
 * A entrada só acontece por um gesto na página da Legacy:
 *   1. o clique no botão pede um PASSE ao servidor (JSON, mesma origem);
 *   2. o navegador envia o formulário (POST) com o passe;
 *   3. o servidor confere a origem do pedido e o passe, e só então valida convite,
 *      reserva, horário e inscrição e encaminha ao Zoom.
 *
 * O passe é um HMAC do código do convite com validade curta (2 minutos), sem estado
 * no servidor. Outro site não consegue lê-lo (a resposta JSON não tem CORS) e, por
 * isso, não consegue montar um POST válido; robôs de pré-visualização e pré-carga,
 * que só fazem GET, nunca chegam a ele. O passe NÃO substitui nada: convite, limite
 * de tentativas, reserva ativa e janela de horário são conferidos de novo no POST.
 *
 * O que isto não resolve: quem tem o código do convite pode abrir a página e clicar.
 * O código continua sendo a credencial da empresa.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;

export const VALIDADE_DO_PASSE_S = 120;

// Fora de produção, sem KICKOFF_ORIGEM_SECRET: chave que só vale neste processo.
const CHAVE_DO_PROCESSO = randomBytes(32).toString('hex');

/** Mesma chave do limite de tentativas. Em produção é obrigatória (a rota fecha sem ela). */
function chave(env: Env): string {
  const k = env.KICKOFF_ORIGEM_SECRET?.trim();
  if (k && k.length >= 32) return k;
  if (env.NODE_ENV === 'production') throw new Error('KICKOFF_ORIGEM_SECRET não configurada: obrigatória em produção.');
  return CHAVE_DO_PROCESSO;
}

const assinar = (codigo: string, expira: number, env: Env) => createHmac('sha256', chave(env)).update(`entrada-na-reuniao|${codigo}|${expira}`).digest('hex');

/** Passe para entrar com este convite, válido por 2 minutos. Lança se a chave faltar em produção. */
export function emitirPasse(codigo: string, env: Env = process.env, agora: number = Date.now()): string {
  const expira = Math.floor(agora / 1000) + VALIDADE_DO_PASSE_S;
  return `${expira}.${assinar(codigo, expira, env)}`;
}

/** O passe é deste convite e ainda vale? Nunca lança. */
export function passeValido(passe: unknown, codigo: string, env: Env = process.env, agora: number = Date.now()): boolean {
  if (typeof passe !== 'string' || passe.length > 100) return false;
  const m = /^(\d{10})\.([0-9a-f]{64})$/.exec(passe);
  if (!m) return false;
  const expira = Number(m[1]);
  const segundos = Math.floor(agora / 1000);
  if (expira < segundos || expira > segundos + VALIDADE_DO_PASSE_S) return false;
  try {
    return timingSafeEqual(Buffer.from(m[2], 'hex'), Buffer.from(assinar(codigo, expira, env), 'hex'));
  } catch {
    return false;
  }
}

/**
 * O pedido veio de uma página da própria aplicação? Usa o que o navegador informa
 * e não pode ser forjado por outro site:
 *   - Sec-Fetch-Site (navegadores atuais): tem de ser "same-origin";
 *   - Origin: quando vem com um endereço, tem de ser o nosso. (Com a política
 *     "no-referrer" destas páginas o navegador manda "Origin: null" no POST; por
 *     isso a ausência não reprova, e o passe continua obrigatório.)
 */
export function pedidoDaPropriaPagina(headers: Headers, hostsAceitos: string[]): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = headers.get('origin');
  if (origin && origin !== 'null') {
    try {
      const host = new URL(origin).host.toLowerCase();
      if (!hostsAceitos.map((h) => h.toLowerCase()).includes(host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
