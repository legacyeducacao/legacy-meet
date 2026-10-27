import { describe, expect, it } from 'vitest';
import { MAX_GUEST_EMAILS, parseGuestEmails } from './guestEmails';

describe('parseGuestEmails', () => {
  it('aceita um e-mail', () => {
    expect(parseGuestEmails('cliente@empresa.com.br')).toEqual({ emails: ['cliente@empresa.com.br'], invalid: [] });
  });

  it('separa por vírgula, ponto e vírgula, espaço e quebra de linha; normaliza e remove repetidos', () => {
    expect(parseGuestEmails('Joao@Empresa.com; maria@empresa.com,\njoao@empresa.com  ze@x.io')).toEqual({
      emails: ['joao@empresa.com', 'maria@empresa.com', 'ze@x.io'],
      invalid: [],
    });
  });

  it('aceita lista vinda do formulário', () => {
    expect(parseGuestEmails(['a@b.com', 'c@d.com']).emails).toEqual(['a@b.com', 'c@d.com']);
  });

  it('aponta os inválidos sem descartar os bons', () => {
    expect(parseGuestEmails('bom@empresa.com, joao@empresa, maria.com')).toEqual({
      emails: ['bom@empresa.com'],
      invalid: ['joao@empresa', 'maria.com'],
    });
  });

  it('vazio ou lixo vira lista vazia', () => {
    expect(parseGuestEmails('')).toEqual({ emails: [], invalid: [] });
    expect(parseGuestEmails(undefined)).toEqual({ emails: [], invalid: [] });
    expect(parseGuestEmails(42)).toEqual({ emails: [], invalid: [] });
  });

  it('limita a quantidade', () => {
    const many = Array.from({ length: 30 }, (_, i) => `c${i}@x.com`).join(',');
    expect(parseGuestEmails(many).emails).toHaveLength(MAX_GUEST_EMAILS);
  });
});
