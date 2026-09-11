import { describe, expect, it } from 'vitest';
import { describeMediaError, iframePermissionProblem } from './mediaErrors';

const err = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('describeMediaError', () => {
  it('permissão negada orienta a liberar no cadeado', () => {
    expect(describeMediaError(err('NotAllowedError'), 'camera')).toMatch(/Permissão para a câmera negada.*cadeado/);
  });
  it('dispositivo em uso por outro app', () => {
    expect(describeMediaError(err('NotReadableError'), 'microphone')).toMatch(/em uso por outro programa/);
  });
  it('sem dispositivo', () => {
    expect(describeMediaError(err('NotFoundError'), 'microphone')).toMatch(/Nenhum dispositivo encontrado para o microfone/);
  });
  it('timeout do LiveKit ao iniciar a fonte', () => {
    expect(describeMediaError(new Error('Timeout starting video source'), 'camera')).toMatch(/Tempo esgotado/);
  });
  it('erro desconhecido mantém a mensagem original', () => {
    expect(describeMediaError(new Error('xyz'), 'camera')).toMatch(/Falha ao iniciar a câmera \(xyz\)/);
  });
});

describe('iframePermissionProblem', () => {
  it('fora de iframe não há problema', () => {
    expect(iframePermissionProblem({ isEmbedded: false, policy: { allowsFeature: () => false } })).toBeNull();
  });

  it('em iframe sem permissão de câmera/microfone devolve orientação', () => {
    const policy = { allowsFeature: (f: string) => f !== 'camera' && f !== 'microphone' };
    expect(iframePermissionProblem({ isEmbedded: true, policy })).toMatch(/câmera e microfone/);
    const onlyMic = { allowsFeature: (f: string) => f !== 'microphone' };
    expect(iframePermissionProblem({ isEmbedded: true, policy: onlyMic })).toMatch(/libera microfone\./);
  });

  it('em iframe com permissão liberada não há problema', () => {
    expect(iframePermissionProblem({ isEmbedded: true, policy: { allowsFeature: () => true } })).toBeNull();
  });

  it('sem API de política, não dá para saber → null', () => {
    expect(iframePermissionProblem({ isEmbedded: true, policy: null })).toBeNull();
  });
});
