/**
 * Tipos de reunião da Legacy. O tipo é codificado como prefixo no nome da sala
 * (ex: "comercial-1a2b-3c4d"), o que faz o tipo viajar de forma confiável até a
 * gravação (escolha do bucket) e até os webhooks, sem depender de query params.
 */
export const MEETING_TYPES = ['comercial', 'executoria'] as const;

export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  comercial: 'Comercial',
  executoria: 'Executoria',
};

export const DEFAULT_MEETING_TYPE: MeetingType = 'comercial';

/** Monta o nome da sala com o prefixo do tipo. */
export function roomNameWithType(type: MeetingType, roomId: string): string {
  return `${type}-${roomId}`;
}

/** Extrai o tipo a partir do nome da sala (prefixo). */
export function meetingTypeFromRoomName(roomName: string): MeetingType {
  const prefix = roomName.split('-', 1)[0];
  return (MEETING_TYPES as readonly string[]).includes(prefix)
    ? (prefix as MeetingType)
    : DEFAULT_MEETING_TYPE;
}
