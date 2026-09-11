import { beforeAll, describe, expect, it } from 'vitest';
import { newSignedPostfix, verifySignedPostfix } from './participantIdentity';

describe('sufixo assinado da identidade', () => {
  beforeAll(() => {
    process.env.LIVEKIT_API_SECRET = 'segredo-de-teste-1234567890';
  });

  it('gera e verifica', () => {
    const { postfix, cookieValue } = newSignedPostfix();
    expect(postfix).toMatch(/^[a-z0-9]{4,8}$/);
    expect(verifySignedPostfix(cookieValue)).toBe(postfix);
  });

  it('rejeita cookie sem assinatura, forjado ou com sufixo trocado', () => {
    expect(verifySignedPostfix('ab12')).toBeNull();
    expect(verifySignedPostfix('ab12.deadbeefdeadbeef')).toBeNull();
    const { cookieValue } = newSignedPostfix();
    const [, sig] = cookieValue.split('.');
    expect(verifySignedPostfix(`zz99.${sig}`)).toBeNull();
    expect(verifySignedPostfix(undefined)).toBeNull();
  });
});
