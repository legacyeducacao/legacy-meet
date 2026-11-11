/**
 * PDF do resumo da reunião, montado no navegador (o jsPDF só é carregado no
 * clique). Texto de verdade (dá para copiar e buscar), A4, com cabeçalho,
 * seções na mesma ordem da tela e rodapé com número de página.
 */
import type { MeetingSummary } from '@/lib/meetingSummaryCore';

const AZUL: [number, number, number] = [28, 67, 125]; // --primary do tema claro
const TEXTO: [number, number, number] = [33, 37, 41];
const SUAVE: [number, number, number] = [100, 108, 118];
const LINHA: [number, number, number] = [222, 226, 232];
const FUNDO: [number, number, number] = [240, 244, 250];

/** A fonte padrão do PDF só tem o alfabeto latino: troca o que ela não desenha. */
function limpar(t: string | null | undefined): string {
  return (t ?? '')
    .replace(/[→⇒➔]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/[‐-‒]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E¡-ÿ–—‘’“”•…€]/g, '')
    .trim();
}

export function nomeArquivoResumo(r: MeetingSummary): string {
  const partes = ['Resumo da reunião', r.clientName, r.meetingDate].map((p) => limpar(p).replace(/[\\/:*?"<>|]+/g, '-')).filter(Boolean);
  return `${partes.join(' - ')}.pdf`;
}

/** Monta o documento (sem baixar). */
export async function montarResumoPdf(r: MeetingSummary) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18;
  const LARG = W - 2 * M;
  const RODAPE = 16;
  let y = 0;

  const cor = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fonte = (estilo: 'normal' | 'bold', tam: number) => {
    doc.setFont('helvetica', estilo);
    doc.setFontSize(tam);
  };
  const alturaLinha = (tam: number) => tam * 0.3528 * 1.45;
  const novaPagina = () => {
    doc.addPage();
    y = M;
  };
  const garantir = (h: number) => {
    if (y + h > H - RODAPE - 4) novaPagina();
  };

  /** Parágrafo com quebra de linha e de página. */
  const paragrafo = (texto: string, x: number, largura: number, tam = 10, estilo: 'normal' | 'bold' = 'normal', c = TEXTO) => {
    fonte(estilo, tam);
    cor(c);
    const lh = alturaLinha(tam);
    for (const linha of doc.splitTextToSize(limpar(texto), largura) as string[]) {
      garantir(lh);
      doc.text(linha, x, y + lh * 0.75);
      y += lh;
    }
  };

  const secao = (titulo: string, qtd?: number) => {
    // Título nunca fica sozinho no pé da página.
    garantir(30);
    y += 5;
    doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]);
    doc.rect(M, y, 1.2, 6, 'F');
    fonte('bold', 12);
    cor(AZUL);
    doc.text(limpar(titulo) + (qtd ? `  (${qtd})` : ''), M + 4, y + 4.6);
    y += 9;
  };

  /** Item com marcador (texto ou número) e recuo. */
  const medir = (texto: string, largura: number, tam: number, estilo: 'normal' | 'bold') => {
    fonte(estilo, tam);
    return (doc.splitTextToSize(limpar(texto), largura) as string[]).length * alturaLinha(tam);
  };
  const item = (marcador: string | 'caixa', texto: string, opts: { titulo?: string; extra?: string } = {}) => {
    const recuo = 7;
    const larg = LARG - recuo;
    // O item inteiro vai para a próxima página quando não cabe (se couber numa página só).
    const altura = (opts.titulo ? medir(opts.titulo, larg, 10, 'bold') : 0) + (texto ? medir(texto, larg, 10, 'normal') : 0) + (opts.extra ? medir(opts.extra, larg, 9, 'normal') : 0);
    garantir(Math.min(altura, H - RODAPE - 4 - M));
    if (marcador === 'caixa') {
      doc.setDrawColor(AZUL[0], AZUL[1], AZUL[2]);
      doc.setLineWidth(0.35);
      doc.roundedRect(M + 1, y + 1.1, 3.2, 3.2, 0.5, 0.5, 'S');
      doc.setLineWidth(0.2);
    } else {
      fonte('bold', 10);
      cor(AZUL);
      doc.text(marcador, M + 1, y + alturaLinha(10) * 0.75);
    }
    if (opts.titulo) paragrafo(opts.titulo, M + recuo, LARG - recuo, 10, 'bold');
    if (texto) paragrafo(texto, M + recuo, LARG - recuo, 10, 'normal', opts.titulo ? SUAVE : TEXTO);
    if (opts.extra) paragrafo(opts.extra, M + recuo, LARG - recuo, 9, 'normal', SUAVE);
    y += 2.5;
  };

  // Cabeçalho
  doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]);
  doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255, 255, 255);
  fonte('bold', 18);
  doc.text('Resumo da reunião', M, 14);
  fonte('normal', 10);
  doc.text(limpar(r.title) || 'Legacy Executoria', M, 22, { maxWidth: LARG });
  y = 38;

  const dados: Array<[string, string]> = [
    ['Cliente', limpar(r.clientName)],
    ['Executor', limpar(r.executorName)],
    ['Data', limpar(r.meetingDate)],
  ].filter(([, v]) => v) as Array<[string, string]>;
  if (r.onboarding) dados.push(['Tipo', 'Onboarding']);
  for (const [k, v] of dados) {
    fonte('bold', 10);
    cor(SUAVE);
    doc.text(`${k}:`, M, y + 3.5);
    fonte('normal', 10);
    cor(TEXTO);
    doc.text(v, M + 20, y + 3.5, { maxWidth: LARG - 20 });
    y += 5.5;
  }

  // Resumo em destaque
  if (r.resumo) {
    y += 4;
    fonte('normal', 10.5);
    const linhas = doc.splitTextToSize(limpar(r.resumo), LARG - 10) as string[];
    const lh = alturaLinha(10.5);
    const alturaCaixa = linhas.length * lh + 8;
    if (alturaCaixa < H - RODAPE - 4 - y) {
      doc.setFillColor(FUNDO[0], FUNDO[1], FUNDO[2]);
      doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]);
      doc.roundedRect(M, y, LARG, alturaCaixa, 2, 2, 'FD');
      cor(TEXTO);
      linhas.forEach((l, i) => doc.text(l, M + 5, y + 4 + lh * 0.75 + i * lh));
      y += alturaCaixa;
    } else {
      paragrafo(r.resumo, M, LARG, 10.5);
    }
  }

  if (r.acompanhamento_anterior) {
    secao('Sobre a reunião anterior');
    paragrafo(r.acompanhamento_anterior, M, LARG);
  }
  if (r.assuntos.length) {
    secao('Assuntos tratados', r.assuntos.length);
    r.assuntos.forEach((a, i) => item(`${i + 1}.`, a.detalhes, { titulo: a.titulo }));
  }
  if (r.decisoes.length) {
    secao('Decisões e combinados', r.decisoes.length);
    r.decisoes.forEach((d) => item('•', d));
  }
  if (r.proximos_passos.length) {
    secao('Próximos passos', r.proximos_passos.length);
    r.proximos_passos.forEach((p) => {
      const extra = [p.responsavel && `Responsável: ${p.responsavel}`, p.prazo && `Prazo: ${p.prazo}`].filter(Boolean).join('   ·   ');
      item('caixa', p.acao, { extra: extra || undefined });
    });
  }
  if (r.retomar.length) {
    secao('Para retomar na próxima reunião', r.retomar.length);
    r.retomar.forEach((t) => item('•', t));
  }
  if (r.sugestoes.length) {
    secao('Sugestões de melhoria (metodologia ExecScore)', r.sugestoes.length);
    r.sugestoes.forEach((s) => item('•', s.sugestao, { titulo: s.pilar || undefined }));
  }

  // Rodapé em todas as páginas
  const gerado = new Date(r.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]);
    doc.line(M, H - RODAPE + 2, W - M, H - RODAPE + 2);
    fonte('normal', 8);
    cor(SUAVE);
    doc.text(`Gerado pela IA a partir da transcrição em ${gerado}. Confira os pontos importantes na gravação.`, M, H - RODAPE + 7, { maxWidth: LARG - 25 });
    doc.text(`Página ${p} de ${total}`, W - M, H - RODAPE + 7, { align: 'right' });
  }

  return doc;
}

export async function baixarResumoPdf(r: MeetingSummary): Promise<void> {
  (await montarResumoPdf(r)).save(nomeArquivoResumo(r));
}
