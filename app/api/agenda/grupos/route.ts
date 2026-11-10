import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { addDays, localYmd, ocorrenciasDoGrupo } from '@/lib/agenda-engine';
import { carregarFeriados, FUSO } from '@/lib/agenda/servidor';
import { paraConfig, type LinhaGrupo } from '@/lib/agenda/grupos';
import { corpo, usuarioAgenda } from '@/lib/agenda/rota';

export const dynamic = 'force-dynamic';

/** Grupos do Impulsão com a prévia das próximas 8 semanas (conteúdo de cada encontro). */
export async function GET() {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('agenda_grupos')
    .select('*, executor:users!agenda_grupos_executor_id_fkey(name), substituto:users!agenda_grupos_substituto_id_fkey(name), client_tenants(name)')
    .order('ativo', { ascending: false })
    .order('dia_semana');
  if (error) return new NextResponse(error.message, { status: 500 });
  const grupos = (data ?? []) as Array<LinhaGrupo & { executor: { name: string } | null; substituto: { name: string } | null; client_tenants: { name: string } | null }>;

  const hoje = localYmd(new Date(), FUSO);
  const ate = addDays(hoje, 7 * 8);
  const feriados = await carregarFeriados(new Date(), new Date(Date.parse(`${ate}T00:00:00Z`)));
  const { data: jornadas } = await admin.from('agenda_jornadas').select('grupo_id').eq('status', 'ativa').eq('produto', 'impulsao');
  const ativos = new Map<string, number>();
  for (const j of (jornadas ?? []) as Array<{ grupo_id: string | null }>) if (j.grupo_id) ativos.set(j.grupo_id, (ativos.get(j.grupo_id) ?? 0) + 1);

  return NextResponse.json({
    podeCriar: true,
    podeAdministrar: a.user.isAdmin,
    meId: a.user.id,
    grupos: grupos.map((g) => ({
      ...g,
      executorNome: g.executor?.name ?? null,
      substitutoNome: g.substituto?.name ?? null,
      clienteNome: g.client_tenants?.name ?? null,
      clientesAtivos: ativos.get(g.id) ?? 0,
      proximos: g.ativo
        ? ocorrenciasDoGrupo(paraConfig(g), hoje, ate, feriados).map((o) => ({ data: o.data, rotulo: o.rotulo, status: o.status, feriado: o.feriado ?? null }))
        : [],
    })),
  });
}

type Corpo = {
  nome?: string;
  templateId?: string;
  executorId?: string;
  substitutoId?: string | null;
  tenantId?: string | null;
  diaSemana?: number;
  hora?: string;
  duracaoMin?: number;
  ancora?: string;
  defasagem?: number;
  inicio?: string | null;
  fim?: string | null;
};

/**
 * Cria um grupo a partir de um modelo do Impulsão. Admin define tudo; o
 * executor cria o grupo dele e só ajusta os campos que o modelo libera
 * (sequência, entradas e política de feriado vêm sempre do modelo).
 */
export async function POST(req: NextRequest) {
  const a = await usuarioAgenda();
  if (a.res) return a.res;
  const b = await corpo<Corpo>(req);
  const admin = createAdminSupabase();
  const { data: t } = await admin.from('agenda_templates').select('*').eq('id', b.templateId ?? '').eq('ativo', true).maybeSingle();
  if (!t) return new NextResponse('Escolha um modelo', { status: 400 });
  if (t.produto !== 'impulsao') return new NextResponse('Grupos são do Impulsão', { status: 400 });

  const isAdmin = a.user.isAdmin;
  const livre = new Set<string>(isAdmin ? ['dia_semana', 'hora', 'ancora', 'defasagem', 'duracao_min', 'executor', 'substituto', 'tenant'] : (t.campos_editaveis as string[]));
  const executorId = isAdmin && b.executorId ? b.executorId : a.user.id;
  const pega = <T,>(campo: string, valor: T | undefined, padrao: T): T => (livre.has(campo) && valor !== undefined && valor !== null ? valor : padrao);

  const hora = pega('hora', b.hora, (t.hora_padrao as string | null) ?? '19:00');
  const diaSemana = pega('dia_semana', b.diaSemana, 2);
  const ancora = pega('ancora', b.ancora, localYmd(new Date(), FUSO));
  if (!/^\d{2}:\d{2}$/.test(hora) || !(diaSemana >= 1 && diaSemana <= 7) || !/^\d{4}-\d{2}-\d{2}$/.test(ancora)) {
    return new NextResponse('Dia, hora ou semana inicial inválidos', { status: 400 });
  }
  const nome = (b.nome ?? '').trim() || `Grupo ${['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][diaSemana - 1]}`;

  const { data, error } = await admin
    .from('agenda_grupos')
    .insert({
      nome,
      template_id: t.id,
      executor_id: executorId,
      substituto_id: isAdmin ? b.substitutoId ?? null : null,
      tenant_id: isAdmin ? b.tenantId ?? null : null,
      dia_semana: diaSemana,
      hora,
      duracao_min: pega('duracao_min', b.duracaoMin, t.duracao_min as number),
      sequencia: t.sequencia,
      defasagem: pega('defasagem', b.defasagem, t.defasagem_padrao as number),
      ancora,
      politica_feriado: t.politica_feriado === 'segue' ? 'segue' : 'pausa',
      entradas_permitidas: t.entradas_permitidas,
      inicio: b.inicio ?? null,
      fim: b.fim ?? null,
      criado_por: a.user.id,
    })
    .select('*')
    .single();
  if (error) return new NextResponse('Falha ao criar o grupo: ' + error.message, { status: 400 });
  return NextResponse.json({ grupo: data });
}
