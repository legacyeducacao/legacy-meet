import { describe, expect, it } from 'vitest';
import { mergeAttendees } from './calendar';

describe('mergeAttendees', () => {
  const existing = [
    { email: 'luan@legacy.com', responseStatus: 'accepted' },
    { email: 'Leonardo@legacy.com', responseStatus: 'needsAction' },
    { email: 'cliente@empresa.com', responseStatus: 'accepted' },
  ];

  it('remove quem saiu e acrescenta quem entrou, mantendo as respostas dos demais', () => {
    expect(mergeAttendees(existing, ['guilherme@legacy.com'], ['leonardo@legacy.com'])).toEqual([
      { email: 'luan@legacy.com', responseStatus: 'accepted' },
      { email: 'cliente@empresa.com', responseStatus: 'accepted' },
      { email: 'guilherme@legacy.com' },
    ]);
  });

  it('não duplica quem já está convidado', () => {
    expect(mergeAttendees(existing, ['CLIENTE@empresa.com'], [])).toHaveLength(3);
  });

  it('sem mudanças devolve a mesma lista', () => {
    expect(mergeAttendees(existing, [], [])).toEqual(existing);
  });
});
