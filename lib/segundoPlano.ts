import { after } from 'next/server';

/**
 * Trabalho depois da resposta (convites do Google Agenda etc.). Dentro de uma
 * requisição usa `after`; fora dela (rotina periódica do servidor), roda direto.
 */
export function emSegundoPlano(fn: () => Promise<void>): void {
  try {
    after(fn);
  } catch {
    void fn().catch((e) => console.error('segundo plano:', e));
  }
}
