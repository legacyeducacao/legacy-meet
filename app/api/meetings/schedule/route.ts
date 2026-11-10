import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { criarReunioes } from '@/lib/meetingsCore';
import { computeOccurrences, type Frequency } from '@/lib/recurrence';
import { listTeamMembers, normalizeCoHostIds } from '@/lib/meetingHosts';
import { parseGuestEmails } from '@/lib/guestEmails';

export const dynamic = 'force-dynamic';

const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'biweekly', 'monthly'];

// Agenda uma reunião futura (status=scheduled) — ou uma SÉRIE recorrente, com
// todas as ocorrências criadas em massa (cada uma com sala/link próprios,
// ligadas por recurrence_parent_id = id da primeira). Os eventos do Google
// Agenda são criados em segundo plano (after) para a tela responder na hora.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Não autorizado', { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    sector?: 'comercial' | 'executoria';
    title?: string;
    tenantId?: string;
    startAt?: string; // ISO (UTC)
    record?: boolean;
    transcribe?: boolean;
    /** Reunião de onboarding (Executoria): não vai para o ExecScore. */
    onboarding?: boolean;
    /** Outros anfitriões (ids de colaboradores) — ex.: o Closer da sessão. */
    coHostIds?: string[];
    /** E-mails dos clientes convidados (recebem o convite do Google Agenda). */
    guestEmails?: string[] | string;
    recurrence?: {
      frequency?: string;
      until?: string; // 'yyyy-mm-dd' (inclusive) — exclusivo com count
      count?: number;
    };
  };

  const sector = body.sector === 'comercial' ? 'comercial' : 'executoria';
  const title = (body.title ?? '').trim();
  if (!title) return new NextResponse('Título da reunião é obrigatório', { status: 400 });
  const tenantId = sector === 'comercial' ? process.env.MEET_COMMERCIAL_TENANT_ID! : body.tenantId;
  if (!tenantId) return new NextResponse('Cliente (tenant) obrigatório para Executoria', { status: 400 });

  const start = body.startAt ? new Date(body.startAt) : null;
  if (!start || isNaN(start.getTime()))
    return new NextResponse('Data e hora inválidas', { status: 400 });

  // Datas da série (reunião avulsa = série de 1).
  let occurrences: Date[] = [start];
  let recurrenceRule: string | null = null;
  if (body.recurrence) {
    const frequency = body.recurrence.frequency as Frequency;
    if (!FREQUENCIES.includes(frequency)) {
      return new NextResponse('Frequência de repetição inválida', { status: 400 });
    }
    // Data limite chega como 'yyyy-mm-dd' — inclusiva até o fim do dia em São Paulo.
    const until = body.recurrence.until
      ? new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(body.recurrence.until)
            ? `${body.recurrence.until}T23:59:59.999-03:00`
            : body.recurrence.until,
        )
      : undefined;
    if (until && isNaN(until.getTime())) {
      return new NextResponse('Data limite da repetição inválida', { status: 400 });
    }
    try {
      occurrences = computeOccurrences(start, { frequency, until, count: body.recurrence.count });
    } catch (e) {
      return new NextResponse(e instanceof Error ? e.message : 'Recorrência inválida', {
        status: 400,
      });
    }
    if (occurrences.length === 0) {
      return new NextResponse('A data limite é anterior à primeira reunião', { status: 400 });
    }
    recurrenceRule = until
      ? `${frequency};until=${until.toISOString().slice(0, 10)}`
      : `${frequency};count=${occurrences.length}`;
  }

  const guests = parseGuestEmails(body.guestEmails);
  if (guests.invalid.length) {
    return new NextResponse(`E-mail inválido: ${guests.invalid.join(', ')}`, { status: 400 });
  }

  const team = await listTeamMembers();
  const coHostIds = normalizeCoHostIds(body.coHostIds, new Set(team.map((m) => m.id)), user.id);

  const r = await criarReunioes({
    hostId: user.id,
    hostEmail: user.email,
    sector,
    tenantId,
    title,
    // Agenda atual: toda reunião dura 1 hora.
    ocorrencias: occurrences.map((occ) => ({ inicio: occ, fim: new Date(occ.getTime() + 60 * 60 * 1000) })),
    record: body.record !== false,
    transcribe: body.transcribe !== false,
    onboarding: body.onboarding === true,
    coHostIds,
    team,
    guestEmails: guests.emails,
    recurrenceRule,
  });
  if (!r.ok) return new NextResponse(r.message, { status: r.status });
  const { ids, roomNames } = r;

  return NextResponse.json({ id: ids[0], roomName: roomNames[0], occurrences: ids.length });
}
