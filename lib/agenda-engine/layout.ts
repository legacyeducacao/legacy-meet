/**
 * Posição de eventos sobrepostos na visão de dia/semana, no mesmo espírito do
 * Google Agenda: eventos que se encostam formam um grupo de colisão; dentro
 * dele cada evento vai para a primeira coluna livre (mais cedo primeiro, e no
 * empate o mais longo à esquerda) e se estica para a direita enquanto as
 * colunas seguintes estiverem livres no seu horário.
 */

export interface ItemLayout {
  id: string;
  inicio: number; // ms
  fim: number; // ms
}

export interface PosicaoLayout {
  id: string;
  /** Coluna (0 = esquerda). */
  coluna: number;
  /** Total de colunas do grupo de colisão. */
  colunas: number;
  /** Quantas colunas o evento ocupa (expansão para a direita). */
  span: number;
  /** Posição horizontal em fração: left = coluna/colunas, width = span/colunas. */
  left: number;
  width: number;
}

const cruza = (a: ItemLayout, b: ItemLayout) => a.inicio < b.fim && b.inicio < a.fim;

export function layoutDia(itens: readonly ItemLayout[]): PosicaoLayout[] {
  const ordenados = [...itens].sort((a, b) => a.inicio - b.inicio || b.fim - b.inicio - (a.fim - a.inicio) || a.id.localeCompare(b.id));
  const out: PosicaoLayout[] = [];

  // Grupos de colisão: corrente de eventos que se sobrepõem.
  let grupo: ItemLayout[] = [];
  let fimGrupo = -Infinity;
  const fechar = () => {
    if (!grupo.length) return;
    const colunas: ItemLayout[][] = [];
    const colunaDe = new Map<string, number>();
    for (const ev of grupo) {
      let c = colunas.findIndex((col) => col[col.length - 1].fim <= ev.inicio);
      if (c < 0) {
        colunas.push([]);
        c = colunas.length - 1;
      }
      colunas[c].push(ev);
      colunaDe.set(ev.id, c);
    }
    const n = colunas.length;
    for (const ev of grupo) {
      const c = colunaDe.get(ev.id)!;
      let span = 1;
      while (c + span < n && !colunas[c + span].some((o) => cruza(o, ev))) span++;
      out.push({ id: ev.id, coluna: c, colunas: n, span, left: c / n, width: span / n });
    }
    grupo = [];
  };

  for (const ev of ordenados) {
    if (ev.inicio >= fimGrupo) {
      fechar();
      fimGrupo = -Infinity;
    }
    grupo.push(ev);
    fimGrupo = Math.max(fimGrupo, ev.fim);
  }
  fechar();
  return out;
}
