import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Versão com o MODO INTERNO para o Legacy Meet. Tudo o que a tela do
// ExecScore já fazia continua igual (mesmo prompt ativo, mesmo modelo, mesmos
// pesos). O que mudou:
//   1. Chamada máquina a máquina: header `x-execscore-internal-secret` igual ao
//      secret EXECSCORE_INTERNAL_SECRET. Nesse modo não há usuário logado; o
//      executor vem no corpo (`executor_id`) e é validado no banco.
//   2. `meeting_id` / `meet_recording_ids` são gravados na avaliação. Uma
//      reunião gera UMA avaliação: chamar de novo para a mesma reunião atualiza
//      a avaliação existente (reprocesso, gravação reiniciada, troca de pilares).
//   3. `transcript_source` aceita "meet".

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PILLAR_KEYS = [
  "score_estrategia",
  "score_financeiro",
  "score_execucao",
  "score_processos",
  "score_marketing",
  "score_lideranca",
] as const;

const PILLAR_WEIGHTS: Record<string, number> = {
  score_estrategia: 20,
  score_financeiro: 20,
  score_execucao: 20,
  score_processos: 15,
  score_marketing: 15,
  score_lideranca: 10,
};

const MAX_TRANSCRIPT_CHARS = 500_000;
const VALID_SOURCES = new Set(["text", "file", "url", "api", "meet"]);
const INTERNAL_HEADER = "x-execscore-internal-secret";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Comparação em tempo constante (não vaza o secret por tempo de resposta).
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey, { db: { schema: "execscore" } });

  // ---------- Autenticação: interna (Legacy Meet) ou usuário logado ----------
  const internalHeader = req.headers.get(INTERNAL_HEADER);
  const internal = internalHeader !== null;
  let userId: string | null = null;
  let isAdmin = false;

  if (internal) {
    const secret = Deno.env.get("EXECSCORE_INTERNAL_SECRET");
    if (!secret) return json({ error: "Modo interno não configurado" }, 503);
    if (!safeEqual(internalHeader, secret)) return json({ error: "Não autorizado" }, 401);
  } else {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, 401);
    const callerClient = createClient(supabaseUrl, anonKey, {
      db: { schema: "execscore" },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await callerClient.auth.getUser();
    if (authError || !user) return json({ error: "Não autorizado" }, 401);
    userId = user.id;
    const [{ data: admin }, { data: isExec }] = await Promise.all([
      adminClient.rpc("has_role", { _user_id: user.id, _role: "admin" }),
      adminClient.rpc("has_role", { _user_id: user.id, _role: "executor" }),
    ]);
    isAdmin = !!admin;
    if (!isAdmin && !isExec) return json({ error: "Acesso negado" }, 403);
  }

  try {
    const body = await req.json();
    const {
      transcript,
      executor_name,
      pilares_selecionados,
      executor_id: bodyExecutorId,
      evaluation_id: bodyEvaluationId,
      transcript_content,
      transcript_filename,
      transcript_source,
      empresa_nome: bodyEmpresaNome,
      data_reuniao: bodyDataReuniao,
      evaluation_date: bodyEvaluationDate,
      meeting_id: bodyMeetingId,
      meet_recording_ids: bodyRecordingIds,
    } = body;

    // Campos manuais do formulário: quando presentes, prevalecem sobre a
    // extração da IA (que muitas vezes devolve "Não especificada" etc.).
    const manualEmpresa = typeof bodyEmpresaNome === "string" && bodyEmpresaNome.trim()
      ? bodyEmpresaNome.trim().slice(0, 200) : null;
    const manualData = typeof bodyDataReuniao === "string" && bodyDataReuniao.trim()
      ? bodyDataReuniao.trim().slice(0, 40) : null;

    // Data retroativa: quando o formulário envia evaluation_date (ISO), ela
    // vira a data oficial da avaliação (coluna `date`, que manda em filtros,
    // gráfico e ordenação). created_at segue registrando o momento do envio.
    let manualDateIso: string | null = null;
    if (typeof bodyEvaluationDate === "string" && bodyEvaluationDate) {
      const d = new Date(bodyEvaluationDate);
      const maxFuture = Date.now() + 24 * 60 * 60 * 1000; // tolera fuso/relógio
      if (!Number.isNaN(d.getTime()) && d.getTime() <= maxFuture) {
        manualDateIso = d.toISOString();
      }
    }

    // Vínculo com a reunião do Meet: só o modo interno pode gravar.
    const meetingId = internal && typeof bodyMeetingId === "string" && UUID_RE.test(bodyMeetingId)
      ? bodyMeetingId : null;
    const recordingIds = internal && Array.isArray(bodyRecordingIds)
      ? bodyRecordingIds.filter((r: unknown): r is string => typeof r === "string").slice(0, 20)
      : null;

    if (typeof transcript !== "string" || transcript.length === 0) {
      return json({ error: "Transcrição inválida ou vazia." }, 400);
    }
    if (transcript.length > MAX_TRANSCRIPT_CHARS) {
      return json({
        error: `Transcrição muito grande (máx ${MAX_TRANSCRIPT_CHARS.toLocaleString("pt-BR")} caracteres).`,
      }, 413);
    }

    // Resolve target executor_id
    let targetExecutorId: string | null = null;
    if (internal) {
      if (typeof bodyExecutorId === "string" && UUID_RE.test(bodyExecutorId)) {
        const { data: execRow } = await adminClient
          .from("executors").select("id").eq("id", bodyExecutorId).maybeSingle();
        targetExecutorId = execRow?.id ?? null;
      }
    } else if (isAdmin && typeof bodyExecutorId === "string" && bodyExecutorId) {
      targetExecutorId = bodyExecutorId;
    } else {
      const { data: execRow } = await adminClient
        .from("executors").select("id").eq("user_id", userId!).maybeSingle();
      targetExecutorId = execRow?.id ?? null;
    }
    if (!targetExecutorId) return json({ error: "Executor não encontrado" }, internal ? 404 : 403);

    // Validate evaluation_id ownership when updating
    let evaluationId: string | null = null;
    if (typeof bodyEvaluationId === "string" && bodyEvaluationId) {
      const { data: existing } = await adminClient
        .from("executor_evaluations").select("id, executor_id").eq("id", bodyEvaluationId).maybeSingle();
      if (!existing) return json({ error: "Avaliação não encontrada" }, 404);
      if (!isAdmin && existing.executor_id !== targetExecutorId) {
        return json({ error: "Acesso negado" }, 403);
      }
      evaluationId = existing.id;
    }
    // Uma avaliação por reunião: se já existe, a chamada atualiza a mesma.
    if (!evaluationId && meetingId) {
      const { data: existing } = await adminClient
        .from("executor_evaluations").select("id").eq("meeting_id", meetingId).maybeSingle();
      evaluationId = existing?.id ?? null;
    }

    const sanitizedPilares = Array.isArray(pilares_selecionados)
      ? pilares_selecionados.filter((k: unknown): k is string => typeof k === "string" && (PILLAR_KEYS as readonly string[]).includes(k))
      : undefined;

    const EXEC_OPENROUTER_KEY = Deno.env.get("EXEC_OPENROUTER_KEY");
    if (!EXEC_OPENROUTER_KEY) throw new Error("EXEC_OPENROUTER_KEY is not configured");

    const { data: promptData, error: promptError } = await adminClient
      .from("prompt_versions")
      .select("id, content")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (promptError || !promptData) {
      throw new Error("Nenhuma versão de prompt ativa encontrada. Configure uma versão ativa no painel Admin.");
    }
    const SYSTEM_PROMPT = promptData.content;
    const prompt_version_id = promptData.id;

    const allPillarLabels: Record<string, string> = {
      score_estrategia: "Estratégia & BSC",
      score_financeiro: "Gestão Financeira",
      score_execucao: "Execução & Postura",
      score_processos: "Processos & Escala",
      score_marketing: "Comercial & Marketing",
      score_lideranca: "Liderança & Mindset",
    };

    const activePillars: string[] = sanitizedPilares && sanitizedPilares.length > 0
      ? sanitizedPilares
      : PILLAR_KEYS as unknown as string[];

    const pillarInstruction = activePillars.length < 6
      ? `\n\n**INSTRUÇÃO IMPORTANTE**: Nesta reunião, foram abordados SOMENTE os seguintes pilares: ${activePillars.map(k => allPillarLabels[k] || k).join(", ")}. Os demais pilares NÃO foram tratados nesta reunião — atribua nota 0 para eles e NÃO os considere na auditoria nem nas recomendações. Foque sua análise exclusivamente nos pilares listados.`
      : "";

    const userPrompt = `Executor: ${executor_name}\n\nTranscrição da reunião:\n\n${transcript}${pillarInstruction}`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EXEC_OPENROUTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_evaluation",
              description: "Submete a avaliação completa do executor com notas, auditoria e recomendações.",
              parameters: {
                type: "object",
                properties: {
                  score_estrategia: { type: "integer" },
                  score_financeiro: { type: "integer" },
                  score_execucao: { type: "integer" },
                  score_processos: { type: "integer" },
                  score_marketing: { type: "integer" },
                  score_lideranca: { type: "integer" },
                  auditoria: { type: "string" },
                  recomendacoes: { type: "string" },
                  empresa_nome: { type: "string" },
                  data_reuniao: { type: "string" },
                },
                required: ["score_estrategia", "score_financeiro", "score_execucao", "score_processos", "score_marketing", "score_lideranca", "auditoria", "recomendacoes", "empresa_nome", "data_reuniao"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_evaluation" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return json({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }, 429);
      }
      if (response.status === 402) return json({ error: "Créditos insuficientes." }, 402);
      const t = await response.text();
      console.error("[EvaluationAPI] AI gateway error:", response.status, t);
      throw new Error("O serviço de IA está temporariamente indisponível.");
    }

    const aiResult = await response.json();
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("A IA não conseguiu gerar a avaliação estruturada.");

    const evaluation = JSON.parse(toolCall.function.arguments);
    if (manualEmpresa) evaluation.empresa_nome = manualEmpresa;
    if (manualData) evaluation.data_reuniao = manualData;

    // Sanitiza as notas da IA: garante número inteiro em 0-100 antes de
    // calcular o total e persistir (a IA pode devolver string, negativo ou >100).
    for (const k of PILLAR_KEYS) {
      const v = Number(evaluation[k]);
      evaluation[k] = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
    }

    const totalActiveWeight = activePillars.reduce((sum, k) => sum + (PILLAR_WEIGHTS[k] || 0), 0);
    const score_total = totalActiveWeight > 0
      ? Math.round(
          activePillars.reduce((sum, k) => {
            const score = evaluation[k] || 0;
            const weight = PILLAR_WEIGHTS[k] || 0;
            return sum + score * (weight / totalActiveWeight);
          }, 0)
        )
      : 0;

    const result = { ...evaluation, score_total, pilares_selecionados: activePillars, prompt_version_id };

    // Persist server-side
    const safeSource = typeof transcript_source === "string" && VALID_SOURCES.has(transcript_source) ? transcript_source : "text";
    const safeContent = typeof transcript_content === "string" ? transcript_content : transcript;
    const safeFilename = typeof transcript_filename === "string" ? transcript_filename : null;

    const persistPayload: Record<string, unknown> = {
      score_total,
      score_estrategia: evaluation.score_estrategia,
      score_financeiro: evaluation.score_financeiro,
      score_execucao: evaluation.score_execucao,
      score_processos: evaluation.score_processos,
      score_marketing: evaluation.score_marketing,
      score_lideranca: evaluation.score_lideranca,
      auditoria: evaluation.auditoria,
      recomendacoes: evaluation.recomendacoes,
      empresa_nome: evaluation.empresa_nome || null,
      data_reuniao: evaluation.data_reuniao || null,
      roleplay: "",
      detalhes_json: { ...evaluation, score_total, pilares_selecionados: activePillars },
      prompt_version_id,
      transcript_content: safeContent,
      transcript_filename: safeFilename,
      transcript_source: safeSource,
      ...(manualDateIso ? { date: manualDateIso } : {}),
      ...(meetingId ? { meeting_id: meetingId, meet_recording_ids: recordingIds ?? [] } : {}),
    };

    let savedId: string | null = null;
    if (evaluationId) {
      const { error: upErr } = await adminClient
        .from("executor_evaluations").update(persistPayload).eq("id", evaluationId);
      if (upErr) throw new Error(`Falha ao atualizar avaliação: ${upErr.message}`);
      savedId = evaluationId;
    } else {
      const { data: inserted, error: insErr } = await adminClient
        .from("executor_evaluations")
        .insert({ ...persistPayload, executor_id: targetExecutorId, evaluated_by: userId })
        .select("id").single();
      if (insErr && insErr.code === "23505" && meetingId) {
        // Corrida: outra chamada da mesma reunião inseriu primeiro. Atualiza a dela.
        const { data: raced } = await adminClient
          .from("executor_evaluations").select("id").eq("meeting_id", meetingId).maybeSingle();
        if (!raced) throw new Error(`Falha ao salvar avaliação: ${insErr.message}`);
        const { error: upErr } = await adminClient
          .from("executor_evaluations").update(persistPayload).eq("id", raced.id);
        if (upErr) throw new Error(`Falha ao atualizar avaliação: ${upErr.message}`);
        savedId = raced.id;
      } else if (insErr) {
        throw new Error(`Falha ao salvar avaliação: ${insErr.message}`);
      } else {
        savedId = inserted?.id ?? null;
      }
    }

    return json({ ...result, id: savedId });
  } catch (e) {
    console.error("[EvaluationAPI] Error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
