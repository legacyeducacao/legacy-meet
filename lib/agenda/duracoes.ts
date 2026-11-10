/**
 * Duração real das gravações no banco (agenda_gravacoes_duracao): é a fonte
 * das "horas realizadas" do painel. Vem do manifesto do worker (já com o
 * corte de silêncio das salas esquecidas abertas).
 */
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getManifest, listJsonKeys } from '@/lib/recordings';

const roomDe = (id: string) => id.split('__')[0];

/** Grava (ou atualiza) a duração de uma gravação. Nunca lança. */
export async function registrarDuracao(recordingId: string): Promise<boolean> {
  try {
    const m = await getManifest(recordingId);
    if (!m || !(m.durationSeconds > 0)) return false;
    const admin = createAdminSupabase();
    const room = m.roomName || roomDe(recordingId);
    const { data: meeting } = await admin.from('meetings').select('id').eq('room_name', room).maybeSingle();
    const { error } = await admin.from('agenda_gravacoes_duracao').upsert({
      recording_id: recordingId,
      meeting_id: meeting?.id ?? null,
      room_name: room,
      inicio: m.createdAt,
      duracao_seg: Math.round(m.durationSeconds),
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error(`agenda: duração da gravação ${recordingId}`, e);
    return false;
  }
}

/** Preenche as gravações que ainda não estão na tabela (até `limite` por chamada). */
export async function sincronizarDuracoes(limite = 300): Promise<{ novas: number; restantes: number }> {
  const chaves = await listJsonKeys('manifests/');
  const ids = chaves.map((k) => k.slice('manifests/'.length, -'.json'.length));
  const { data } = await createAdminSupabase().from('agenda_gravacoes_duracao').select('recording_id');
  const ja = new Set(((data ?? []) as Array<{ recording_id: string }>).map((r) => r.recording_id));
  const faltam = ids.filter((id) => !ja.has(id));
  let novas = 0;
  for (const id of faltam.slice(0, limite)) if (await registrarDuracao(id)) novas++;
  return { novas, restantes: Math.max(faltam.length - limite, 0) };
}
