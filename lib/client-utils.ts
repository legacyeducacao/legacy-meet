export function encodePassphrase(passphrase: string) {
  return encodeURIComponent(passphrase);
}

export function decodePassphrase(base64String: string) {
  return decodeURIComponent(base64String);
}

export function generateRoomId(): string {
  return `${randomString(4)}-${randomString(4)}`;
}

export function randomString(length: number): string {
  let result = '';
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export function isLowPowerDevice() {
  return navigator.hardwareConcurrency < 6;
}

export function isMobileDevice() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Converte o deviceId vindo do PreJoin em algo seguro para o livekit-client.
 *
 * O PreJoin usa "default" como valor inicial (é o padrão do
 * @livekit/components-react). Mas "default" é um pseudo-dispositivo que o
 * Chrome expõe só para ÁUDIO — não existe câmera com esse id, e no Firefox ele
 * não existe para nenhum dos dois. Como o livekit-client converte um deviceId
 * em string para um filtro `exact`, pedir a câmera "default" sempre falha com
 * OverConstrainedError; a chamada só funciona na tentativa seguinte, que a
 * própria biblioteca refaz com `ideal`.
 *
 * Custo disso: uma chamada de getUserMedia condenada a falhar em todo ingresso,
 * cerca de um segundo a mais para a câmera aparecer, e uma janela maior para a
 * câmera ainda estar presa à pré-visualização (o "Timeout starting video
 * source"). Devolvendo undefined, a biblioteca usa o caminho de preferência
 * (`ideal`) já na primeira tentativa.
 */
export function preferredDeviceId(deviceId: string | undefined | null): string | undefined {
  if (!deviceId || deviceId === 'default' || deviceId === 'communications') return undefined;
  return deviceId;
}

/** Opções do Krisp compartilhadas por NoiseFilterBoot e MicrophoneSettings. */
export const KRISP_FILTER_OPTIONS = {
  bufferOverflowMs: 100,
  bufferDropMs: 200,
  quality: 'medium' as const,
  onBufferDrop: () => {
    console.warn('krisp buffer drop — o filtro se desativa sozinho nas versões >= 0.3.2');
  },
};

export function isMeetStaging() {
  return new URL(location.origin).host === 'meet.staging.livekit.io';
}
