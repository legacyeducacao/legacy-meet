/**
 * Teste manual do provider AssemblyAI: recebe a URL de uma gravação (MP4/MP3
 * acessível pela internet — ex.: URL assinada do MinIO), roda a transcrição
 * completa (sem webhook, com polling) e imprime as utterances com falantes.
 *
 *   cd worker
 *   npx tsx scripts/transcribe-url.ts "<url>" [--participants "Ana Souza,Bruno Lima"] [--json saida.json]
 *
 * Envs: ASSEMBLYAI_API_KEY (obrigatória); OPENROUTER_API_KEY (opcional, para
 * mapear A/B/C → nomes quando --participants é informado); ASSEMBLYAI_SPEECH_MODEL,
 * ASSEMBLYAI_LANGUAGE_CODE, KEYTERMS_FILE, SPEAKER_MAP_MIN_CONFIDENCE.
 * Custo: ~US$ 0,28 por hora de áudio.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AssemblyAIClient, buildTranscriptParams, DEFAULT_SPEECH_MODEL, estimateCostUsd } from '../lib/assemblyai';
import { buildKeyterms, loadKeytermsFile } from '../lib/keyterms';
import { openRouterJson } from '../lib/openrouter';
import { mergeParticipants } from '../lib/participants';
import { normalizeUtterances } from '../lib/speakers';
import { applySpeakerMap, mapSpeakers } from '../lib/speakerMap';
import { utterancesToPlainText } from '../lib/text';
import { parseAssemblyUtterances } from '../lib/utterances';

function loadEnvFile(filePath: string) {
  try {
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  } catch {
    // sem .env
  }
}
loadEnvFile(path.resolve(process.cwd(), '../.env'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

async function main() {
  const url = process.argv[2];
  if (!url || url.startsWith('--')) {
    console.error('uso: npx tsx scripts/transcribe-url.ts "<url>" [--participants "A,B"] [--json saida.json]');
    process.exit(2);
  }
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    console.error('ASSEMBLYAI_API_KEY ausente');
    process.exit(2);
  }
  const participants = mergeParticipants(
    [],
    (arg('--participants') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const keytermsFile = process.env.KEYTERMS_FILE ?? path.resolve(process.cwd(), 'config/keyterms.json');
  const keyterms = buildKeyterms(loadKeytermsFile(keytermsFile), participants);
  const speechModel = process.env.ASSEMBLYAI_SPEECH_MODEL ?? DEFAULT_SPEECH_MODEL;

  const client = new AssemblyAIClient({
    apiKey,
    onRetry: (a, e, d) => console.error(`tentativa ${a} falhou (${e}) — retry em ${d}ms`),
  });
  const params = buildTranscriptParams({
    audioUrl: url,
    speechModel,
    languageCode: process.env.ASSEMBLYAI_LANGUAGE_CODE ?? 'pt',
    keyterms,
    maxSpeakers: participants.length || undefined,
  });
  console.error(`submetendo (modelo=${speechModel}, keyterms=${keyterms.length}, participantes=${participants.length})…`);
  const startedAt = Date.now();
  const submitted = await client.submit(params);
  console.error(`transcript_id=${submitted.id} status=${submitted.status}`);

  let t = submitted;
  let delay = 5_000;
  while (t.status === 'queued' || t.status === 'processing') {
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(30_000, delay * 1.5);
    t = await client.get(submitted.id);
    console.error(`  status=${t.status} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
  }
  if (t.status === 'error') {
    console.error(`ERRO: ${t.error}`);
    process.exit(1);
  }

  let utts = parseAssemblyUtterances(t.utterances);
  const audioSeconds = Number(t.audio_duration ?? 0);
  console.error(
    `concluída em ${Math.round((Date.now() - startedAt) / 1000)}s — áudio ${fmt(audioSeconds)}, ` +
      `${utts.length} utterances, modelo=${t.speech_model_used}, custo≈US$ ${estimateCostUsd(audioSeconds, { keyterms: keyterms.length > 0 })}`,
  );

  if (participants.length) {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const r = await mapSpeakers(utts, participants, {
      minConfidence: Number(process.env.SPEAKER_MAP_MIN_CONFIDENCE ?? '0.7'),
      llm: async ({ prompt, schema }) => {
        if (!openRouterKey) throw new Error('OPENROUTER_API_KEY ausente');
        return openRouterJson({
          apiKey: openRouterKey,
          model: process.env.SPEAKER_MAP_MODEL ?? process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash',
          prompt,
          schema,
          schemaName: 'speaker_map',
          timeoutMs: 60_000,
        });
      },
    });
    console.error(`mapeamento de falantes (${r.source}): ${JSON.stringify(r.map)}`);
    utts = applySpeakerMap(utts, r.map);
  }
  const finalUtts = normalizeUtterances(utts, participants);

  const jsonOut = arg('--json');
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ transcriptId: t.id, audioSeconds, utterances: finalUtts }, null, 2));
    console.error(`salvo em ${jsonOut}`);
  }
  for (const u of finalUtts) console.log(`[${fmt(u.start)}] ${u.speaker}: ${u.text}`);
  if (!finalUtts.length) console.log(utterancesToPlainText(finalUtts) || '(sem falas)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
