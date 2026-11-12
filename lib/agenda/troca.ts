/**
 * Troca de horário entre duas reuniões (arrastar uma para cima da outra).
 * Pura: roda no navegador (prévia otimista) e no servidor (o que vale).
 *
 * Regra: cada uma vai para o horário de início da outra e mantém a própria
 * duração. Quando as duas ficariam encavaladas (reuniões coladas ou de
 * durações diferentes no mesmo período), a que estava depois passa a começar
 * no início da primeira e a outra vem logo em seguida, com o mesmo intervalo
 * que havia entre elas.
 */
export type Faixa = { inicio: number; fim: number };

export function trocarHorarios(a: Faixa, b: Faixa): { a: Faixa; b: Faixa } {
  const durA = a.fim - a.inicio;
  const durB = b.fim - b.inicio;
  const novoA = { inicio: b.inicio, fim: b.inicio + durA };
  const novoB = { inicio: a.inicio, fim: a.inicio + durB };
  if (novoA.inicio >= novoB.fim || novoB.inicio >= novoA.fim) return { a: novoA, b: novoB };

  // Encavalaram: empilha na ordem invertida, guardando o intervalo original.
  const aPrimeiro = a.inicio <= b.inicio;
  const [prim, seg] = aPrimeiro ? [a, b] : [b, a];
  const intervalo = Math.max(0, seg.inicio - prim.fim);
  const durSeg = seg.fim - seg.inicio;
  const durPrim = prim.fim - prim.inicio;
  const segNovo = { inicio: prim.inicio, fim: prim.inicio + durSeg };
  const inicioPrim = segNovo.fim + intervalo;
  const primNovo = { inicio: inicioPrim, fim: inicioPrim + durPrim };
  return aPrimeiro ? { a: primNovo, b: segNovo } : { a: segNovo, b: primNovo };
}
