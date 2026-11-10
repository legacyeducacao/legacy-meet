/**
 * Editar um grupo do Impulsão depois de criado. Nome, substituto e cliente
 * mudam direto. Dia, horário, duração, executor ou data da primeira aula
 * replanejam os encontros já gerados NO LUGAR: cada reunião futura vai para o
 * novo dia/horário (mesma sala, mesmo convite, mesmo vínculo com a jornada do
 * cliente), na mesma ordem do ciclo. Conflitos passam pelas regras da empresa.
 */
import { emSegundoPlano } from '@/lib/segundoPlano';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { changeCalendarAttendees, updateCalendarEvent } from '@/lib/calendar';
import { listTeamMembers } from '@/lib/meetingHosts';
import { addDays, localYmd, ocorrenciasDoGrupo, reancorar, startOfWeek, validarConflitos } from '@/lib/agenda-engine';
import { carregarConfig, carregarFeriados, contextoExecutor, registrarSobreposicoes, FUSO } from './servidor';
import { decidirConflitos } from './regras';
import { paraConfig, type LinhaGrupo } from './grupos';
import type { RespostaConflito } from './tipos';

const DIA_RRULE = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export type MudancasGrupo = {
  nome?: string;
  diaSemana?: number;
  hora?: string;
  duracaoMin?: number;
  ancora?: string;
  executorId?: string;
  substitutoId?: string | null;
  tenantId?: string | null;
};

export type ResultadoEditar =
  | { ok: true; movidos: number }
  | { ok: false; conflito: RespostaConflito }
  | { ok: false; erro: string; status: number };

type Futura = {
  ocId: string;
  meetingId: string;
  inicio: string;
  fim: string;
  hostId: string;
  rotulo: string | null;
  substituto: boolean;
};

export async function editarGrupo(
  grupoId: string,
  usuario: { id: string; isAdmin: boolean },
  m: MudancasGrupo,
  justificativa?: string,
): Promise<ResultadoEditar> {
  const admin = createAdminSupabase();
  const { data: row } = await admin.from('agenda_grupos').select('*').eq('id', grupoId).maybeSingle();
  if (!row) return { ok: false, erro: 'Grupo não encontrado', status: 404 };
  const g = row as LinhaGrupo;
  if (!g.ativo) return { ok: false, erro: 'Grupo encerrado', status: 400 };

  // Permissões: admin muda tudo; o executor do grupo muda o nome e o que o modelo libera.
  const dono = g.executor_id === usuario.id;
  if (!usuario.isAdmin) {
    if (!dono) return { ok: false, erro: 'Só o executor do grupo ou um admin', status: 403 };
    if (m.executorId !== undefined || m.substitutoId !== undefined || m.tenantId !== undefined) {
      return { ok: false, erro: 'Executor, substituto e cliente só o admin muda', status: 403 };
    }
    const { data: t } = await admin.from('agenda_templates').select('campos_editaveis').eq('id', g.template_id ?? '').maybeSingle();
    const livres = new Set((t?.campos_editaveis as string[] | undefined) ?? []);
    const pedidos: Array<[unknown, string]> = [
      [m.diaSemana, 'dia_semana'],
      [m.hora, 'hora'],
      [m.duracaoMin, 'duracao_min'],
      [m.ancora, 'ancora'],
    ];
    for (const [v, campo] of pedidos) {
      if (v !== undefined && !livres.has(campo)) return { ok: false, erro: 'O modelo deste grupo não deixa o executor mudar esse campo', status: 403 };
    }
  }

  const novo: LinhaGrupo = { ...g };
  const nome = m.nome?.trim();
  if (m.nome !== undefined && !nome) return { ok: false, erro: 'O nome não pode ficar vazio', status: 400 };
  if (nome) novo.nome = nome;
  if (m.diaSemana !== undefined) novo.dia_semana = m.diaSemana;
  if (m.hora !== undefined) novo.hora = m.hora;
  if (m.duracaoMin !== undefined) novo.duracao_min = Math.round(m.duracaoMin);
  if (m.executorId) novo.executor_id = m.executorId;
  if (m.substitutoId !== undefined) novo.substituto_id = m.substitutoId || null;
  if (m.tenantId !== undefined) novo.tenant_id = m.tenantId || null;
  if (!(novo.dia_semana >= 1 && novo.dia_semana <= 7) || !/^\d{2}:\d{2}$/.test(novo.hora)) return { ok: false, erro: 'Dia ou horário inválido', status: 400 };
  if (!(novo.duracao_min >= 15 && novo.duracao_min <= 12 * 60)) return { ok: false, erro: 'Duração entre 15 min e 12 h', status: 400 };
  if (novo.substituto_id && novo.substituto_id === novo.executor_id) return { ok: false, erro: 'O substituto tem que ser outra pessoa', status: 400 };
  const mudouAncora = !!m.ancora && m.ancora !== g.ancora;
  if (m.ancora !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(m.ancora)) return { ok: false, erro: 'Data da primeira aula inválida', status: 400 };

  const mudouDia = novo.dia_semana !== g.dia_semana;
  const mudouHorario = mudouDia || novo.hora !== g.hora || novo.duracao_min !== g.duracao_min;
  const mudouExecutor = novo.executor_id !== g.executor_id;
  const replanejar = mudouHorario || mudouAncora;

  // Encontros futuros já gerados (série aberta do grupo).
  const agora = new Date();
  const { data: serie } = await admin.from('agenda_series').select('id').eq('grupo_id', g.id).is('encerrada_em', null).maybeSingle();
  let futuras: Futura[] = [];
  if (serie) {
    const { data: ocs } = await admin
      .from('agenda_ocorrencias')
      .select('id, meeting_id, rotulo, executor_substituto_id, meetings!inner(id, scheduled_start_at, scheduled_end_at, host_id, status)')
      .eq('serie_id', serie.id)
      .not('meeting_id', 'is', null)
      .eq('meetings.status', 'scheduled')
      .gt('meetings.scheduled_start_at', agora.toISOString());
    type Linha = {
      id: string;
      meeting_id: string;
      rotulo: string | null;
      executor_substituto_id: string | null;
      meetings: { scheduled_start_at: string; scheduled_end_at: string | null; host_id: string };
    };
    futuras = ((ocs ?? []) as unknown as Linha[])
      .map((o) => ({
        ocId: o.id,
        meetingId: o.meeting_id,
        inicio: o.meetings.scheduled_start_at,
        fim: o.meetings.scheduled_end_at ?? o.meetings.scheduled_start_at,
        hostId: o.meetings.host_id,
        rotulo: o.rotulo,
        substituto: !!o.executor_substituto_id && o.meetings.host_id !== g.executor_id,
      }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
  }
  const idsFuturas = futuras.map((f) => f.meetingId);

  // Clientes com encontros marcados nessas reuniões.
  const { data: encs } = idsFuturas.length
    ? await admin.from('agenda_jornada_encontros').select('jornada_id, numero, meeting_id, agenda_jornadas!inner(status)').in('meeting_id', idsFuturas).eq('agenda_jornadas.status', 'ativa')
    : { data: [] };
  const encontros = (encs ?? []) as unknown as Array<{ jornada_id: string; numero: number; meeting_id: string }>;
  if (mudouAncora && encontros.length) {
    return { ok: false, erro: 'Há clientes com encontros marcados neste grupo: a data da primeira aula não pode mudar (mudaria o conteúdo das aulas deles).', status: 400 };
  }
  if (mudouAncora) {
    novo.ancora = m.ancora!;
    novo.defasagem = 0;
  } else if (mudouDia && futuras.length) {
    // O ciclo continua de onde estava: a 1ª aula futura mantém o conteúdo.
    const primeira = futuras.find((f) => f.rotulo && g.sequencia.includes(f.rotulo));
    if (primeira) Object.assign(novo, reancorar(g.sequencia, primeira.rotulo!, localYmd(new Date(primeira.inicio), g.fuso || FUSO)));
  }

  // Novos horários: a k-ésima reunião futura vai para a k-ésima aula do grupo no formato novo.
  type Plano = Futura & { novoInicio: Date; novoFim: Date; novoRotulo: string | null; novoHost: string };
  let plano: Plano[] = [];
  let pausas: Array<{ inicio: Date; rotulo: string | null; feriado: string | null }> = [];
  if (replanejar && futuras.length) {
    // Começa na semana do primeiro encontro marcado: nenhum encontro é puxado para antes da semana dele.
    const hoje = localYmd(agora, g.fuso || FUSO);
    const semanaPrimeira = startOfWeek(localYmd(new Date(futuras[0].inicio), g.fuso || FUSO));
    const de = semanaPrimeira > hoje ? semanaPrimeira : hoje;
    const ultima = localYmd(new Date(futuras[futuras.length - 1].inicio), g.fuso || FUSO);
    const ate = addDays(ultima, 7 * 12);
    const feriados = await carregarFeriados(agora, new Date(`${ate}T23:59:59Z`));
    const todas = ocorrenciasDoGrupo(paraConfig(novo), de, ate, feriados).filter((o) => o.inicio > agora);
    const aulas = todas.filter((o) => o.status === 'normal');
    if (aulas.length < futuras.length) return { ok: false, erro: 'Não coube: faltaram semanas para remarcar os encontros', status: 400 };
    plano = futuras.map((f, k) => ({
      ...f,
      novoInicio: aulas[k].inicio,
      novoFim: aulas[k].fim,
      novoRotulo: aulas[k].rotulo,
      novoHost: f.substituto ? f.hostId : novo.executor_id,
    }));
    const limite = aulas[futuras.length - 1].inicio;
    pausas = todas.filter((o) => o.status !== 'normal' && o.inicio < limite).map((o) => ({ inicio: o.inicio, rotulo: o.rotulo, feriado: o.feriado ?? null }));
  } else {
    plano = futuras.map((f) => ({
      ...f,
      novoInicio: new Date(f.inicio),
      novoFim: new Date(f.fim),
      novoRotulo: f.rotulo,
      novoHost: f.substituto ? f.hostId : novo.executor_id,
    }));
  }

  // Conflitos na agenda de quem vai conduzir (só quando muda horário ou pessoa).
  let registrar: Parameters<typeof registrarSobreposicoes>[0] = [];
  const checar = plano.filter((p) => !p.substituto && (replanejar || mudouExecutor));
  if (checar.length) {
    const cfg = await carregarConfig();
    const de = new Date(Math.min(...checar.map((p) => p.novoInicio.getTime())));
    const ateD = new Date(Math.max(...checar.map((p) => p.novoFim.getTime())) + 86_400_000);
    const contexto = await contextoExecutor(novo.executor_id, de, ateD, cfg);
    const movidas = new Set(idsFuturas);
    const conflitos = validarConflitos(
      checar.map((p) => ({ ref: p.meetingId, inicio: p.novoInicio, fim: p.novoFim, grupo: true, substituiEventoId: p.meetingId })),
      { ...contexto, eventos: contexto.eventos.filter((e) => !movidas.has(e.id)) },
    );
    const decisao = decidirConflitos(conflitos, usuario.isAdmin, justificativa);
    if (!decisao.ok) return { ok: false, conflito: decisao.resposta };
    registrar = decisao.registrar;
  }

  // 1) Grupo e série.
  const { error: errG } = await admin
    .from('agenda_grupos')
    .update({
      nome: novo.nome,
      dia_semana: novo.dia_semana,
      hora: novo.hora,
      duracao_min: novo.duracao_min,
      ancora: novo.ancora,
      defasagem: novo.defasagem,
      executor_id: novo.executor_id,
      substituto_id: novo.substituto_id,
      tenant_id: novo.tenant_id,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', g.id);
  if (errG) return { ok: false, erro: 'Falha ao salvar: ' + errG.message, status: 400 };
  if (serie) {
    const primeiro = plano[0]?.novoInicio;
    await admin
      .from('agenda_series')
      .update({
        titulo: `Impulsão · ${novo.nome}`,
        executor_id: novo.executor_id,
        tenant_id: novo.tenant_id,
        rrule: `FREQ=WEEKLY;BYDAY=${DIA_RRULE[novo.dia_semana - 1]}`,
        duracao_min: novo.duracao_min,
        defasagem: novo.defasagem,
        ...(primeiro ? { inicio_local: `${localYmd(primeiro, g.fuso || FUSO)}T${novo.hora}` } : {}),
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', serie.id);
  }

  // 2) Reuniões futuras: horário, título, anfitrião e cliente.
  const tenantReuniao = novo.tenant_id ?? process.env.MEET_COMMERCIAL_TENANT_ID ?? null;
  const tituloDe = (p: Plano) => `Impulsão · ${novo.nome}${p.novoRotulo ? ` · ${p.novoRotulo}` : ''}`;
  for (const p of plano) {
    const { error } = await admin
      .from('meetings')
      .update({
        scheduled_start_at: p.novoInicio.toISOString(),
        scheduled_end_at: p.novoFim.toISOString(),
        title: tituloDe(p),
        host_id: p.novoHost,
        ...(m.tenantId !== undefined && tenantReuniao ? { tenant_id: tenantReuniao } : {}),
        ...(mudouDia ? { recurrence_rule: `rrule:FREQ=WEEKLY;BYDAY=${DIA_RRULE[novo.dia_semana - 1]}` } : {}),
      })
      .eq('id', p.meetingId)
      .eq('status', 'scheduled');
    if (error) return { ok: false, erro: 'Falha ao remarcar: ' + error.message, status: 500 };
  }

  if (replanejar && serie) {
    // Semanas sem aula (feriado) do formato antigo saem; as do novo entram.
    await admin
      .from('agenda_ocorrencias')
      .delete()
      .eq('serie_id', serie.id)
      .is('meeting_id', null)
      .gt('inicio_original', agora.toISOString());
    for (const p of plano) {
      await admin.from('agenda_ocorrencias').update({ inicio_original: p.novoInicio.toISOString(), rotulo: p.novoRotulo, atualizado_em: new Date().toISOString() }).eq('id', p.ocId);
    }
    if (pausas.length) {
      await admin.from('agenda_ocorrencias').upsert(
        pausas.map((o) => ({ serie_id: serie.id, inicio_original: o.inicio.toISOString(), rotulo: o.rotulo, status: 'pulada_feriado', motivo_excecao: o.feriado, meeting_id: null })),
        { onConflict: 'serie_id,inicio_original', ignoreDuplicates: true },
      );
    }
    const remarcadas = plano.filter((p) => p.novoInicio.getTime() !== new Date(p.inicio).getTime());
    if (remarcadas.length) {
      await admin.from('agenda_remarcacoes').insert(
        remarcadas.map((p) => ({ meeting_id: p.meetingId, origem: 'legacy', de_inicio: p.inicio, para_inicio: p.novoInicio.toISOString(), usuario_id: usuario.id })),
      );
    }
    // Jornadas dos clientes: nova data de cada encontro e nova previsão de conclusão.
    const porMeeting = new Map(plano.map((p) => [p.meetingId, p]));
    for (const e of encontros) {
      const p = porMeeting.get(e.meeting_id);
      if (!p) continue;
      await admin.from('agenda_jornada_encontros').update({ data: localYmd(p.novoInicio, g.fuso || FUSO), rotulo: p.novoRotulo }).eq('jornada_id', e.jornada_id).eq('numero', e.numero);
    }
    for (const jornadaId of new Set(encontros.map((e) => e.jornada_id))) {
      const { data: datas } = await admin.from('agenda_jornada_encontros').select('data').eq('jornada_id', jornadaId).order('data', { ascending: false }).limit(1);
      const fim = (datas?.[0]?.data as string | undefined) ?? null;
      if (fim) await admin.from('agenda_jornadas').update({ fim_previsto: fim, atualizado_em: new Date().toISOString() }).eq('id', jornadaId);
    }
  }
  if (mudouExecutor) {
    await admin.from('agenda_jornadas').update({ executor_id: novo.executor_id }).eq('grupo_id', g.id).eq('status', 'ativa');
  }
  if (registrar.length) await registrarSobreposicoes(registrar, usuario.id, justificativa!.trim(), (ref) => ref, serie?.id ?? null);

  // 3) Google Agenda em segundo plano (avisa os convidados). Não fatal.
  if (plano.length) {
    const mudouNome = novo.nome !== g.nome;
    emSegundoPlano(async () => {
      try {
        const team = mudouExecutor ? await listTeamMembers() : [];
        const email = (id: string) => team.find((t) => t.id === id)?.email ?? null;
        const { data: secs } = await admin.from('meet_meeting_sector').select('meeting_id, calendar_event_id').in('meeting_id', idsFuturas);
        const porMeeting = new Map(plano.map((p) => [p.meetingId, p]));
        for (const s of (secs ?? []) as Array<{ meeting_id: string; calendar_event_id: string | null }>) {
          const p = porMeeting.get(s.meeting_id);
          if (!s.calendar_event_id || !p) continue;
          try {
            if (replanejar || mudouNome || p.novoRotulo !== p.rotulo) {
              await updateCalendarEvent(s.calendar_event_id, {
                summary: tituloDe(p),
                ...(replanejar ? { startISO: p.novoInicio.toISOString(), endISO: p.novoFim.toISOString() } : {}),
              });
            }
            if (p.novoHost !== p.hostId) {
              const sai = email(p.hostId);
              const entra = email(p.novoHost);
              await changeCalendarAttendees(s.calendar_event_id, { add: entra ? [entra] : [], remove: sai ? [sai] : [] });
            }
          } catch (e) {
            console.error('[agenda] editar grupo: evento do Google Agenda', e);
          }
        }
      } catch (e) {
        console.error('[agenda] editar grupo: Google Agenda', e);
      }
    });
  }

  return { ok: true, movidos: replanejar ? plano.filter((p) => p.novoInicio.getTime() !== new Date(p.inicio).getTime()).length : 0 };
}
