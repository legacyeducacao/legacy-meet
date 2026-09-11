/**
 * Tradução dos erros de getUserMedia/LiveKit para mensagens em português com
 * orientação prática. Antes, permissão negada, câmera ocupada por outro app ou
 * microfone inexistente iam só para o console e o usuário entrava mudo/sem
 * vídeo sem saber por quê.
 */
export type MediaSource = 'camera' | 'microphone' | 'screenshare' | 'unknown';

const LABEL: Record<MediaSource, string> = {
  camera: 'a câmera',
  microphone: 'o microfone',
  screenshare: 'o compartilhamento de tela',
  unknown: 'o dispositivo',
};

export function describeMediaError(error: unknown, source: MediaSource = 'unknown'): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  const dev = LABEL[source];
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return `Permissão para ${dev} negada. Clique no cadeado ao lado do endereço, permita câmera e microfone e recarregue a página.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `Nenhum dispositivo encontrado para ${dev}. Verifique se está conectado e reconhecido pelo sistema.`;
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return `Não foi possível iniciar ${dev}: parece estar em uso por outro programa (Zoom, Teams, OBS…). Feche-o e tente de novo.`;
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return `O dispositivo selecionado para ${dev} não está mais disponível. Escolha outro no menu ao lado do botão.`;
    case 'TypeError':
      if (/secure|https/i.test(message)) {
        return 'Câmera e microfone só funcionam em páginas HTTPS. Abra a reunião pelo link seguro.';
      }
      break;
    default:
      break;
  }
  if (/timeout/i.test(message)) {
    return `Tempo esgotado ao iniciar ${dev}. Aguarde alguns segundos e ative pelo botão da barra.`;
  }
  return `Falha ao iniciar ${dev}${message ? ` (${message})` : ''}. Tente ativar pelo botão da barra.`;
}

type PolicyLike = { allowsFeature(feature: string): boolean };
export interface IframeCheckEnv {
  isEmbedded: boolean;
  policy?: PolicyLike | null;
}

export function currentIframeEnv(): IframeCheckEnv {
  if (typeof window === 'undefined' || typeof document === 'undefined') return { isEmbedded: false };
  const doc = document as Document & { permissionsPolicy?: PolicyLike; featurePolicy?: PolicyLike };
  return { isEmbedded: window.self !== window.top, policy: doc.permissionsPolicy ?? doc.featurePolicy ?? null };
}

/**
 * Detecta o Meet embutido em um iframe sem `allow="camera; microphone"`: o
 * navegador nega getUserMedia antes mesmo de perguntar ao usuário. É o caso do
 * CRM que embute a sala. Devolve null quando não há problema ou não dá para saber.
 */
export function iframePermissionProblem(env: IframeCheckEnv = currentIframeEnv()): string | null {
  if (!env.isEmbedded || !env.policy) return null;
  const policy = env.policy;
  const blocked = ['camera', 'microphone'].filter((f) => {
    try {
      return !policy.allowsFeature(f);
    } catch {
      return false;
    }
  });
  if (!blocked.length) return null;
  const what = blocked.map((f) => (f === 'camera' ? 'câmera' : 'microfone')).join(' e ');
  return `Esta reunião está aberta dentro de outro sistema que não libera ${what}. Abra a reunião em uma aba própria do navegador (botão "Copiar link") ou peça ao suporte para liberar o acesso no sistema.`;
}
