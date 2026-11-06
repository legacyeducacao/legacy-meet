# Integração Legacy Meet -> ExecScore

Quando o executor encerra uma reunião da **Executoria**, a transcrição vai
sozinha para o ExecScore e vira uma avaliação no painel do executor
responsável. A única ação do executor é, na tela de saída, desligar os pilares
que não foram tratados na reunião.

## Fluxo

```
Executor sai da sala ──> /obrigado mostra os 6 pilares ──> POST /api/execscore/pilares
                                                                   │
LiveKit egress ──> worker transcreve ──> manifesto "complete"      │
                          │                                         ▼
                          └──> POST /api/execscore/transcricao-pronta ──> execscore.meet_integracao
                                                                   │
                          (transcrição pronta E pilares escolhidos, ou 24 h sem escolha)
                                                                   ▼
                                      edge function execscore-evaluate-executor (modo interno)
                                                                   ▼
                                      execscore.executor_evaluations (meeting_id preenchido)
```

- **Quem recebe:** `meetings.host_id` = `execscore.executors.user_id`. Reunião
  comercial, sem anfitrião ou de anfitrião fora do ExecScore é ignorada.
- **Uma avaliação por reunião:** índice único em `executor_evaluations.meeting_id`.
  Reprocesso, gravação reiniciada (as partes são juntadas em ordem) ou troca de
  pilares atualizam a mesma avaliação.
- **Executor não escolheu:** depois de `EXECSCORE_PILLAR_WAIT_HOURS` (24 h) avalia
  com os 6 pilares. Se ele escolher depois, a avaliação é refeita.
- **Falhas:** até `EXECSCORE_MAX_ATTEMPTS` (4) tentativas, com 15 min entre elas;
  o erro fica em `meet_integracao.ultimo_erro`.

## Onboarding e no-show (002_onboarding_noshow.sql)

- **Onboarding:** switch "Reunião de onboarding" na criação/edição (Executoria),
  guardado em `meet_meeting_sector.onboarding`. Não vai para o ExecScore.
- **No-show:** na tela de saída o executor marca "O cliente não compareceu".
  Usa a mesma regra da Agenda (`lib/noShow.ts`, status `no_show` em `meetings`).
- Nos dois casos a linha de `meet_integracao` vira `descartada` (motivo em
  `ultimo_erro`). Desfazer o no-show ou desligar o onboarding devolve para a fila.
  Avaliação já enviada não é apagada do ExecScore.

## Resumo da reunião

Quando a transcrição fica pronta, o mesmo aviso do worker
(`/api/execscore/transcricao-pronta`) gera o resumo da reunião da Executoria
(`lib/meetingSummary.ts`, IA pelo LLM Gateway da AssemblyAI com
`ASSEMBLYAI_API_KEY`). Usa o prompt ativo do ExecScore
(`execscore.prompt_versions`) como referência da metodologia e o resumo da
reunião anterior com o mesmo cliente. Fica em `resumos/<sala>.json` no MinIO e
aparece na gravação e no botão "Última reunião" da Agenda.
`MEETING_SUMMARY_DISABLED=1` desliga.

## Arquivos

| Onde | O quê |
|---|---|
| `integracoes/execscore/001_meet_execscore.sql` | Migration aditiva no projeto **legacy-plan** |
| `integracoes/execscore/execscore-evaluate-executor/index.ts` | Nova versão da edge function (modo interno + vínculo com a reunião) |
| `lib/execscore.ts` | Regras e acesso ao banco |
| `app/api/execscore/*` | Rotas: pilares (executor logado), transcrição pronta e varredor (worker) |
| `worker/lib/execscore.ts` | Aviso do worker ao app |

## Implantação (nesta ordem)

1. Aplicar `001_meet_execscore.sql` no Supabase legacy-plan.
2. Gerar dois secrets: `openssl rand -hex 32` (duas vezes).
3. Supabase legacy-plan > Edge Functions > Secrets: `EXECSCORE_INTERNAL_SECRET=<secret 1>`.
4. Publicar a nova `execscore-evaluate-executor` (o caminho da tela do ExecScore não muda).
5. App do Meet: `EXECSCORE_INTERNAL_SECRET=<secret 1>` e `EXECSCORE_WORKER_SECRET=<secret 2>`.
6. Worker: `EXECSCORE_WORKER_SECRET=<secret 2>` (e `APP_BASE_URL`, que já existe).
7. Publicar app e worker. Sem os secrets, tudo segue como hoje (integração desligada).

## Acompanhar

```sql
select m.title, mi.status, mi.pilares_desabilitados, mi.tentativas, mi.ultimo_erro, mi.enviada_em
from execscore.meet_integracao mi join public.meetings m on m.id = mi.meeting_id
order by mi.updated_at desc limit 50;
```
