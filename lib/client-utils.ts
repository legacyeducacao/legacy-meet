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
