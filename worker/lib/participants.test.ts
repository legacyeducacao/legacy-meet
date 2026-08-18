import { describe, expect, it } from 'vitest';
import { mergeParticipants } from './participants';

describe('mergeParticipants', () => {
  it('remove duplicatas por caixa/acentos', () => {
    expect(mergeParticipants(['Mariza'], ['MARIZA', 'SANDRA'])).toEqual(['Mariza', 'SANDRA']);
    expect(mergeParticipants([], ['CELSO BENTO', 'Celso Bento'])).toEqual(['CELSO BENTO']);
  });

  it('funde variante com sufixo " - Empresa" mantendo o nome sem sufixo', () => {
    expect(mergeParticipants(['Matheus Parolini - Legacy'], ['Matheus Parolini'])).toEqual([
      'Matheus Parolini',
    ]);
    expect(mergeParticipants(['Matheus Parolini'], ['Matheus Parolini - Legacy'])).toEqual([
      'Matheus Parolini',
    ]);
  });

  it('NÃO funde nomes diferentes de verdade', () => {
    expect(mergeParticipants(['Ana'], ['Ana Paula'])).toEqual(['Ana', 'Ana Paula']);
    expect(mergeParticipants(['Evelyn e delsio'], ['Eve'])).toEqual(['Evelyn e delsio', 'Eve']);
  });

  it('ignora vazios e espaços', () => {
    expect(mergeParticipants([], ['  ', '', 'João '])).toEqual(['João']);
  });
});
