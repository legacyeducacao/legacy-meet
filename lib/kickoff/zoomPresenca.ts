/**
 * Presença pelo Zoom (Zoom E3): regras puras, sem banco e sem rede.
 *
 * A mesma reunião recorrente do Zoom serve todas as sessões de kickoff; o Meeting ID
 * não diz de qual sessão é uma entrada. Por isso tudo é decidido pelo HORÁRIO, em
 * instantes absolutos (UTC; o fuso America/Sao_Paulo só aparece na tela):
 *
 *   - janela da sessão: 30 min antes do início até 30 min depois do fim (a mesma janela
 *     em que a empresa consegue entrar pelo endereço da Legacy, E2). Cobre reunião que
 *     começa antes ou atrasada e que termina cedo ou passa do horário;
 *   - execução da sessão: execução do Zoom (UUID) que cruza a janela;
 *   - entrada que vale para a sessão: cruza a janela. Se o trecho dela na janela cair
 *     INTEIRO na janela de outra sessão de kickoff (sessões vizinhas), é ambígua: vai
 *     para conferência, nunca para presença automática;
 *   - empresa: pelo identificador da inscrição (registrant_id, E2) ou pelo e-mail da
 *     inscrição ou do participante da reserva. Nome sozinho (mesmo com o #CÓDIGO)
 *     nunca basta: só aparece como pista em "não identificados".
 *
 * Reconexões: as entradas da mesma empresa se somam; o tempo é a união dos trechos
 * (o que se sobrepõe não conta duas vezes), dentro da janela.
 */
import { ACESSO_ABRE_ANTES_MIN, ACESSO_FECHA_DEPOIS_MIN } from './zoomAcessoRegras';
import type { ZoomReportParticipant } from '@/lib/zoom/api';

export interface Intervalo {
  inicio: number;
  fim: number;
}

export interface SessaoNoTempo {
  id: string;
  inicio: string;
  fim: string;
}

export interface InscricaoConhecida {
  zoom_meeting_id: string;
  registrant_id: string | null;
  email: string;
  tenant_id: string;
  empresa: string;
}

export interface ReservaConhecida {
  reserva_id: string;
  tenant_id: string;
  email: string;
  empresa: string;
  status: string;
  presenca: string | null;
}

/** O que o banco devolve (agenda_kickoff_zoom_presenca_contexto). */
export interface ContextoDaPresenca {
  sessao: SessaoNoTempo;
  outras: SessaoNoTempo[];
  salas: string[];
  inscricoes: InscricaoConhecida[];
  reservas: ReservaConhecida[];
}

/** Execução lida no Zoom, com o relatório de participantes (vazio se indisponível). */
export interface ExecucaoLida {
  zoom_meeting_id: string;
  uuid: string;
  inicio: string;
  /** null: relatório indisponível (em andamento ou ainda não gerado pelo Zoom). */
  fim: string | null;
  relatorio: 'ok' | 'indisponivel';
  emailDoAnfitriao: string | null;
  participantes: ZoomReportParticipant[];
}

export interface ExecucaoDaSessao {
  zoom_meeting_id: string;
  zoom_uuid: string;
  inicio: string;
  fim: string | null;
  participantes: number | null;
  compartilhada: boolean;
  relatorio: 'ok' | 'indisponivel';
}

/** Evidência de uma empresa (o banco confere e decide o que registrar). */
export interface EvidenciaDaEmpresa {
  tenant_id: string;
  empresa: string;
  evidencia: 'registrante' | 'email';
  /** Alguma entrada cai num trecho só desta sessão. */
  exclusiva: boolean;
  registrantes: string[];
  emails: string[];
  execucoes: string[];
  entradas: number;
  duracao_s: number;
  primeira_entrada: string;
  ultima_saida: string;
}

export interface NaoIdentificado {
  nome: string;
  /** Empresa sugerida pelo #CÓDIGO no nome (só pista; não registra nada). */
  sugestao: string | null;
}

export interface Apuracao {
  execucoes: ExecucaoDaSessao[];
  empresas: EvidenciaDaEmpresa[];
  naoIdentificados: NaoIdentificado[];
  /** Relatório pode estar incompleto: sessão ainda na janela ou relatório indisponível. */
  incompleta: boolean;
}

const MIN = 60_000;

export function janelaDaSessao(s: { inicio: string; fim: string }): Intervalo {
  return { inicio: Date.parse(s.inicio) - ACESSO_ABRE_ANTES_MIN * MIN, fim: Date.parse(s.fim) + ACESSO_FECHA_DEPOIS_MIN * MIN };
}

const valido = (i: Intervalo) => Number.isFinite(i.inicio) && Number.isFinite(i.fim) && i.fim > i.inicio;

export function cruza(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

export function recorte(a: Intervalo, b: Intervalo): Intervalo | null {
  const r = { inicio: Math.max(a.inicio, b.inicio), fim: Math.min(a.fim, b.fim) };
  return r.fim > r.inicio ? r : null;
}

/** O que sobra de `a` depois de tirar os trechos de `tirar`. */
export function subtrair(a: Intervalo, tirar: Intervalo[]): Intervalo[] {
  let resto = [a];
  for (const t of tirar) {
    resto = resto.flatMap((r) => {
      if (!cruza(r, t)) return [r];
      const partes: Intervalo[] = [];
      if (t.inicio > r.inicio) partes.push({ inicio: r.inicio, fim: t.inicio });
      if (t.fim < r.fim) partes.push({ inicio: t.fim, fim: r.fim });
      return partes;
    });
  }
  return resto;
}

/** Soma dos trechos sem contar duas vezes o que se sobrepõe. */
export function duracaoDaUniao(trechos: Intervalo[]): number {
  const ord = [...trechos].sort((x, y) => x.inicio - y.inicio);
  let total = 0;
  let atual: Intervalo | null = null;
  for (const t of ord) {
    if (!atual || t.inicio > atual.fim) {
      if (atual) total += atual.fim - atual.inicio;
      atual = { ...t };
    } else atual.fim = Math.max(atual.fim, t.fim);
  }
  if (atual) total += atual.fim - atual.inicio;
  return total;
}

const limpo = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const emailDe = (v: unknown) => limpo(v).toLowerCase();
const CODIGO_NO_NOME = /#([0-9A-F]{8})\s*$/i;

/**
 * Execuções que interessam à sessão: as que cruzam a janela. Sem fim conhecido
 * (relatório indisponível), vale o início dentro da janela.
 */
export function execucoesDaSessao(ctx: ContextoDaPresenca, lidas: ExecucaoLida[], agora: number): ExecucaoLida[] {
  const j = janelaDaSessao(ctx.sessao);
  return lidas.filter((e) => {
    const inicio = Date.parse(e.inicio);
    const fim = e.fim ? Date.parse(e.fim) : Math.max(agora, inicio + 1);
    return Number.isFinite(inicio) && cruza({ inicio, fim }, j);
  });
}

export function apurarPresenca(ctx: ContextoDaPresenca, lidas: ExecucaoLida[], agora: number): Apuracao {
  const janela = janelaDaSessao(ctx.sessao);
  const outras = ctx.outras.map(janelaDaSessao).filter((o) => valido(o) && cruza(o, janela));
  const daSessao = execucoesDaSessao(ctx, lidas, agora);

  const porRegistrante = new Map<string, InscricaoConhecida>();
  const porEmail = new Map<string, { tenant_id: string; empresa: string }>();
  for (const i of ctx.inscricoes) {
    if (i.registrant_id) porRegistrante.set(`${i.zoom_meeting_id}|${i.registrant_id}`, i);
    porEmail.set(`${i.zoom_meeting_id}|${emailDe(i.email)}`, i);
  }
  // E-mail do participante da reserva desta sessão (vale em qualquer sala).
  const reservaPorEmail = new Map(ctx.reservas.map((r) => [emailDe(r.email), r]));
  const empresaPorCodigo = new Map<string, string>();
  for (const x of [...ctx.inscricoes, ...ctx.reservas]) empresaPorCodigo.set(x.tenant_id.replace(/-/g, '').slice(0, 8).toUpperCase(), x.empresa);

  type Acumulado = Omit<EvidenciaDaEmpresa, 'duracao_s' | 'primeira_entrada' | 'ultima_saida' | 'registrantes' | 'emails' | 'execucoes'> & {
    trechos: Intervalo[];
    primeira: number;
    ultima: number;
    registrantes: Set<string>;
    emails: Set<string>;
    execucoes: Set<string>;
  };
  const empresas = new Map<string, Acumulado>();
  const naoIdentificados = new Map<string, NaoIdentificado>();

  for (const e of daSessao) {
    const anfitriao = emailDe(e.emailDoAnfitriao);
    for (const p of e.participantes) {
      // Sala de espera não é participação.
      if (p.status && p.status !== 'in_meeting') continue;
      const email = emailDe(p.user_email);
      if (anfitriao && email === anfitriao) continue;
      const entrada = Date.parse(limpo(p.join_time));
      const saida = p.leave_time ? Date.parse(limpo(p.leave_time)) : agora;
      if (!valido({ inicio: entrada, fim: saida })) continue;
      const naJanela = recorte({ inicio: entrada, fim: saida }, janela);
      if (!naJanela) continue;
      const exclusiva = subtrair(naJanela, outras).length > 0;

      const registrante = limpo(p.registrant_id);
      const insc = registrante ? porRegistrante.get(`${e.zoom_meeting_id}|${registrante}`) : undefined;
      let quem: { tenant_id: string; empresa: string; evidencia: 'registrante' | 'email' } | null = insc
        ? { tenant_id: insc.tenant_id, empresa: insc.empresa, evidencia: 'registrante' }
        : null;
      if (!quem && email) {
        const porE = porEmail.get(`${e.zoom_meeting_id}|${email}`) ?? reservaPorEmail.get(email);
        if (porE) quem = { tenant_id: porE.tenant_id, empresa: porE.empresa, evidencia: 'email' };
      }

      if (!quem) {
        const nome = limpo(p.name) || 'Sem nome';
        const codigo = CODIGO_NO_NOME.exec(nome)?.[1]?.toUpperCase();
        naoIdentificados.set(nome.toLowerCase(), { nome, sugestao: (codigo && empresaPorCodigo.get(codigo)) || null });
        continue;
      }

      let a = empresas.get(quem.tenant_id);
      if (!a) {
        a = {
          tenant_id: quem.tenant_id,
          empresa: quem.empresa,
          evidencia: quem.evidencia,
          exclusiva: false,
          entradas: 0,
          trechos: [],
          primeira: entrada,
          ultima: saida,
          registrantes: new Set(),
          emails: new Set(),
          execucoes: new Set(),
        };
        empresas.set(quem.tenant_id, a);
      }
      // O identificador da inscrição é a evidência mais forte; prevalece sobre o e-mail.
      if (quem.evidencia === 'registrante') a.evidencia = 'registrante';
      a.exclusiva ||= exclusiva;
      a.entradas += 1;
      a.trechos.push(naJanela);
      a.primeira = Math.min(a.primeira, entrada);
      a.ultima = Math.max(a.ultima, saida);
      if (registrante && insc) a.registrantes.add(registrante);
      if (email) a.emails.add(email);
      a.execucoes.add(e.uuid);
    }
  }

  const fimDaJanela = janela.fim;
  return {
    execucoes: daSessao.map((e) => {
      const inicio = Date.parse(e.inicio);
      const fim = e.fim ? Date.parse(e.fim) : Math.max(agora, inicio + 1);
      return {
        zoom_meeting_id: e.zoom_meeting_id,
        zoom_uuid: e.uuid,
        inicio: e.inicio,
        fim: e.fim,
        participantes: e.relatorio === 'ok' ? e.participantes.length : null,
        // A execução também cruza a janela de outra sessão de kickoff.
        compartilhada: outras.some((o) => cruza(o, { inicio, fim })),
        relatorio: e.relatorio,
      };
    }),
    empresas: [...empresas.values()].map((a) => ({
      tenant_id: a.tenant_id,
      empresa: a.empresa,
      evidencia: a.evidencia,
      exclusiva: a.exclusiva,
      registrantes: [...a.registrantes],
      emails: [...a.emails],
      execucoes: [...a.execucoes],
      entradas: a.entradas,
      duracao_s: Math.round(duracaoDaUniao(a.trechos) / 1000),
      primeira_entrada: new Date(a.primeira).toISOString(),
      ultima_saida: new Date(a.ultima).toISOString(),
    })),
    naoIdentificados: [...naoIdentificados.values()],
    incompleta: agora < fimDaJanela || daSessao.some((e) => e.relatorio === 'indisponivel'),
  };
}
