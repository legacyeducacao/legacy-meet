/**
 * Co-anfitriões guardados nos METADADOS DA SALA (só o servidor escreve, via
 * RoomServiceClient). Antes o co-anfitrião era um atributo do próprio
 * participante — que qualquer convidado com permissão de atualizar os próprios
 * atributos podia escrever, virando "co-anfitrião" sozinho e ganhando o direito
 * de admitir, silenciar, expulsar e parar a gravação.
 *
 * Compartilhado entre servidor (autorização) e cliente (mostrar os painéis).
 */
export interface RoomMeta {
  cohosts?: string[];
}

export function parseRoomMeta(metadata: string | null | undefined): RoomMeta {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? (parsed as RoomMeta) : {};
  } catch {
    return {};
  }
}

export function parseCohosts(metadata: string | null | undefined): string[] {
  const list = parseRoomMeta(metadata).cohosts;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

export function isCohostIdentity(metadata: string | null | undefined, identity: string): boolean {
  return parseCohosts(metadata).includes(identity);
}

/** Metadados da sala com a identidade incluída/removida da lista de co-anfitriões. */
export function withCohost(metadata: string | null | undefined, identity: string, enabled: boolean): string {
  const meta = parseRoomMeta(metadata);
  const current = parseCohosts(metadata);
  const next = enabled
    ? current.includes(identity)
      ? current
      : [...current, identity]
    : current.filter((i) => i !== identity);
  return JSON.stringify({ ...meta, cohosts: next });
}
