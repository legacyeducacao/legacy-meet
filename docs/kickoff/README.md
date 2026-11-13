# Kickoff Impulsão no Legacy Meet

Documento permanente do módulo de kickoff: o que é, como funciona e como operar. Atualizar a cada etapa.

| Etapa | O que entrega | Situação |
|---|---|---|
| M1 | Sessão de kickoff como evento da agenda, permissão `kickoff_impulsao.manage`, seção "Kickoffs Impulsão", filtro na agenda | **Código local (sem commit). Banco pronto e empresa organizadora criada em 12/11/2026. Configurado só no ambiente local. Operação real bloqueada** até os passos 4 (servidor) e 5 da Instalação |
| M2 | Reservas das empresas pela equipe (capacidade, kickoff único por empresa, comparecimento e conclusão manuais, reagendamento por ausência, remanejar, cancelar, histórico) e regras para mexer em sessão com reservas | **Código local (sem commit). Migrations `003` e `004` aplicadas em produção em 12/11/2026** (seção "Reservas (M2)"). Operação real ainda depende dos passos 4 e 5 da Instalação |
| M3 | Convite por empresa e página pública `/impulsao/agendar/<código>` | **Código local (sem commit). Migration `005` aplicada em produção em 12/11/2026, pelo SQL Editor** (seção "Convites e agendamento público (M3)") |
| M4 | Zoom E1: sala recorrente do Impulsão (cliente OAuth, validação, ativação e troca da sala) | **Código local (sem commit). Migration `006` aplicada em produção em 13/11/2026, pelo SQL Editor, e conferida por leitura no mesmo dia** (seção "Migration 006 aplicada") |
| M5 | Zoom E2: inscrição do participante na sala, acesso individual por empresa, `/impulsao/reuniao/<código>` | **Código local (sem commit). Migration `007` aplicada em produção em 13/11/2026, pelo SQL Editor, e conferida por leitura no mesmo dia** (seção "Migration 007 aplicada"). Nenhuma inscrição real foi criada no Zoom |
| M6 | Corte do Legacy CS | Pendente |
| M7 | Manual completo e presença automática pelo Zoom (E3) | Pendente |

Numeração ajustada em 12/11/2026: as reservas, antes previstas para a M3, viraram a M2, junto com as regras de edição de sessão com reservas.

## O que é o kickoff Impulsão

É a reunião coletiva de início do Impulsão. Uma sessão recebe várias empresas clientes (até 5), cada uma com seus representantes, conduzida por alguém da equipe de Customer Success. A reunião acontece no Zoom, não na sala de vídeo do Meet.

O módulo nasceu no Legacy CS e está sendo trazido para o Meet.

- **Referências do CS:** [referencia-cs/kickoff-cs-guia-tecnico.md](referencia-cs/kickoff-cs-guia-tecnico.md) (guia técnico completo, com os apêndices A a D) e [referencia-cs/kickoff-cs-para-meet-handoff.md](referencia-cs/kickoff-cs-para-meet-handoff.md) (decisões e plano). São cópias idênticas dos arquivos de `docs/kickoff/handoff/` do repositório do CS, feitas em 12/11/2026, com o SHA-256 conferido. Não editar aqui: são referência histórica.
- **Diagnóstico da agenda do Meet:** [2026-11-11-diagnostico-calendario-kickoff.md](2026-11-11-diagnostico-calendario-kickoff.md).

## Por que usa a agenda do Meet

Para não existir um segundo calendário. Uma sessão de kickoff é um evento como qualquer outro da agenda e reaproveita:

- recorrência e sessões avulsas;
- feriados, bloqueios e expediente;
- conflitos com os outros compromissos do anfitrião;
- edição por "esta / esta e as seguintes / todas", cancelamento e "Desfazer".

O que é só do kickoff fica numa tabela à parte, ligada ao evento.

## Empresa organizadora e empresas participantes

- **Empresa organizadora:** um registro interno de `client_tenants`, configurado em `MEET_KICKOFF_TENANT_ID`. Toda reunião do Meet precisa de uma empresa (`meetings.tenant_id` é obrigatório). Como uma sessão tem várias empresas, a reunião fica na organizadora. Ela não é cliente, não ocupa vaga e não aparece:
  - na sessão, para quem usa a agenda (o evento não mostra a empresa);
  - no painel de indicadores da agenda (as sessões ficam fora);
  - na agenda do cliente no Plan (`agenda_do_cliente()` ignora as sessões, depois da migration).
- **Empresas participantes:** entram pelas reservas (M3), sempre por `client_tenants.id`. Nunca pelo CNPJ e nunca pela empresa da reunião.

**Organizadora em uso: "Customer Success"**, empresa interna sem contatos e sem logins.

- **id:** `f7249ca9-78cb-49f7-9621-e81f871527a3`
- **Criada em:** 12/11/2026 às 17:43 UTC, pelo [procedimento-customer-success.md](procedimento-customer-success.md) (conferência, ensaio com `rollback`, criação).
- "Legacy Executoria" não deve ser usada: tem e-mail, logins de cliente e já é a sentinela do Comercial.

Campos com que a empresa foi criada:

| Campo | Valor | Por quê |
|---|---|---|
| `name`, `sector`, `sector_type`, `status` | `Customer Success`, `Educação`, `Serviço`, `Concluido` | Igual à interna que já existe ("Legacy Executoria") |
| `requires_billing` | **`false`** | O padrão é `true`. Com `false`, a automação de cobrança não bloqueia nem cobra (`set_tenant_access_block` recusa) |
| `produto`, `executor_id` | nulos | Não é Impulsão nem Legado e não entra em carteira |
| `email`, `phone`, `cnpj`, `owner` | nulos | Sem contato, nenhum lembrete ou mensagem tem destino |
| `onboarding_data` | padrão (`{}`) | O gatilho de onboarding não copia nada |
| logins (`users.tenant_id`) | nenhum | Ninguém vê as sessões pela agenda do cliente |

**Conferido por leitura depois da criação (12/11/2026):**

- uma única empresa com esse nome, com os campos da tabela acima;
- `requires_billing = false`; `access_blocked`, `inativo` e `inadimplente` falsos;
- nenhum login, colaborador, reunião, jornada, assinatura, carteira de executor ou resposta de onboarding ligados a ela;
- nenhum vínculo com as empresas participantes (elas só entram pelas reservas, M3);
- os 4 materiais gravados pelo gatilho de modelos ("Reunião 1:1", "Rituais de Sucesso", "Roteiro de Contratação", "Roteiro para Entrevista"), com links válidos.

O que acontece no Plan ao criar a empresa (verificado em 12/11/2026):

- **Ao inserir rodam só dois dos cinco gatilhos:**
  - `apply_default_comercial_templates` grava 4 links de materiais em `client_reports`. São dados internos, sem aviso a ninguém; a "Legacy Executoria" tem 14 desses;
  - `sync_onboarding_to_rows` não faz nada com `onboarding_data` vazio.
- **Os outros três rodam só em atualizações:** `carimba_inativacao`, `client_tenants_autosave_guard` e `guard_client_tenants_writable`.
- **Onde a empresa aparece:** nas listas de clientes da equipe no Plan e na escolha de cliente do admin no Meet, como a "Legacy Executoria" já aparece.
- **Envio para o Hub:** a ponte `comunidade_ponte` do Plan manda, a cada 15 min, todas as empresas para o Hub (projeto `wiazawqobwtyllnlqrnf`), e, a cada minuto, todas as reuniões de Executoria de ontem até 8 dias à frente. O Hub usa essas reuniões para lembretes anti-no-show por WhatsApp (grupo do cliente) e e-mail (os da empresa e dos logins `CLIENT`). A empresa vai ao Hub como "conta", sem pessoas, telefones ou e-mails. As sessões de kickoff **não** vão: a ponte as exclui desde 12/11/2026 (seção abaixo).

## Configuração: `MEET_KICKOFF_TENANT_ID`

O Meet descobre a organizadora pela variável de ambiente `MEET_KICKOFF_TENANT_ID`, lida no servidor (`organizadorDoKickoff`, em `lib/kickoff/regras.ts`). Precisa ser um UUID válido; qualquer outro valor conta como "não configurado".

**Para configurar um ambiente:**

1. Definir `MEET_KICKOFF_TENANT_ID=f7249ca9-78cb-49f7-9621-e81f871527a3` nas variáveis do ambiente (local: arquivo `.env`, que não vai para o git; modelo em `.env.example`).
2. Reiniciar o app.
3. Conceder a permissão `kickoff_impulsao.manage` a quem vai operar (seção abaixo).

**Ao criar uma sessão, o servidor confere, nesta ordem:**

- quem cria tem a permissão (senão, 403);
- a variável está definida (senão, 409 "organizadora não configurada");
- a empresa existe em `client_tenants` (senão, 409);
- a tabela `agenda_kickoff_sessoes` existe (senão, 503).

Sem a variável, só a criação de kickoff é recusada, com mensagem clara. O resto do Meet não muda.

**Situação em 12/11/2026:**

| Ambiente | `MEET_KICKOFF_TENANT_ID` |
|---|---|
| Local (`.env` da máquina de desenvolvimento) | Definida |
| Servidor de produção | **Não definida** (depende de autorização e de deploy) |

**Validação local (12/11/2026),** sem criar sessões:

- com o `.env` local, `organizadorDoKickoff()` devolve o id acima, a empresa é encontrada e a tabela de sessões responde (0 sessões);
- app local sem login (rotinas automáticas desligadas com `AGENDA_EXTENSAO=0` e `LIVEKIT_URL` vazio, para não gravar nada no banco): `/agenda/kickoffs`, `/api/agenda/kickoffs`, `/agenda`, `GET` e `POST /api/agenda/eventos`, `/admin/usuarios` e `/api/admin/users` levam a `/login`;
- **limitação:** a tela logada (quem tem a permissão x quem não tem) não foi aberta, porque exigiria entrar com uma conta real. Essa parte é coberta pelos testes `app/agenda/kickoffs/page.test.tsx`, `app/api/agenda/kickoffs/route.test.ts` e `app/api/agenda/eventos/*.test.ts`, que passaram.

**Atenção ao rodar o app local:** ele usa o banco de produção. Ao subir, agenda a extensão dos grupos do Impulsão (grava reuniões) e, com `LIVEKIT_URL` definida, a varredura de gravações. Para só olhar, subir com `AGENDA_EXTENSAO=0` e `LIVEKIT_URL` vazia.

## Integração `comunidade_ponte` (pré-requisito da operação real)

**Regra: a operação real do kickoff não começa enquanto a ponte `comunidade_ponte` do Legacy Plan mandar sessões `kickoff_impulsao` para o Hub.**

- **O que a ponte faz hoje:** `comunidade_ponte.reunioes()`, chamada por `enviar_reunioes()` a cada minuto, manda ao Hub (projeto `wiazawqobwtyllnlqrnf`, função `comunidade`, `/integracoes-receber`) toda reunião do Meet com setor `executoria` entre ontem e 8 dias à frente. Junto vão a empresa, o anfitrião, o nome da sala do Meet e os e-mails da empresa e dos logins `CLIENT`.
- **O que o Hub faz com isso:** dispara lembretes anti-no-show por WhatsApp (grupo do cliente) e e-mail.
- **Por que as sessões entram:** são reuniões de Executoria da empresa organizadora. Os participantes reais (as empresas das reservas, M3) não estão na reunião, então qualquer lembrete iria para o lugar errado ou para ninguém.
- **Onde está a rotina:** só no banco, no schema `comunidade_ponte`, fora do histórico de migrations e de qualquer repositório local. A cadeia é:
  - o cron `comunidade-ponte-reunioes` (a cada minuto) chama `enviar_reunioes()`;
  - `enviar_reunioes()` chama `reunioes()`, que monta `{janela, reunioes[]}`;
  - o envio vai para o Hub em `/integracoes-receber`, que grava com `comunidade_reunioes_registrar`.
- **Correção aplicada em 12/11/2026 às 17:18 UTC** (histórico `20261112171806`, `comunidade_ponte_sem_kickoff`). Conferido depois:
  - o hash do corpo passou a ser `0542a72a…`;
  - dono, segurança e permissões estão iguais;
  - o envio continua idêntico (115 reuniões, hash `d6ab4371…`);
  - o cron está sem mudança;
  - o primeiro envio ao Hub depois da mudança (17:20) teve resposta `200 {"ok":true,"sumiram":0,"reunioes":115}`.
- **Arquivo:** [integracoes/kickoff/002_comunidade_ponte_sem_kickoff.sql](../../integracoes/kickoff/002_comunidade_ponte_sem_kickoff.sql).
  - Muda só o `where` de `comunidade_ponte.reunioes()`, acrescentando:
    ```sql
    and not exists (select 1 from public.agenda_kickoff_sessoes k
                     where k.meeting_id = m.id and k.tipo = 'kickoff_impulsao')
    ```
  - O resto é a definição de produção copiada sem mudança: o hash do corpo bate com o do banco.
  - Para desfazer: [002_comunidade_ponte_sem_kickoff.reverter.sql](../../integracoes/kickoff/002_comunidade_ponte_sem_kickoff.reverter.sql), a definição atual intacta.
- **Hub:** não muda. `comunidade_reunioes_registrar` trata cada envio como a lista completa da janela: reunião que não vem fica com `sumiu_em`. Basta não mandar. `enviar_reunioes()` também não muda.
- **Testes:** `lib/kickoff/comunidadePonte.test.ts` (Postgres em memória) compara a versão de produção com a corrigida:
  - sem sessões de kickoff, o envio é idêntico, em todos os campos;
  - com uma sessão marcada, só ela sai;
  - data, setor, status, empresa e e-mails continuam iguais;
  - só o tipo `kickoff_impulsao` é excluído;
  - dono, segurança e permissões continuam os mesmos.

**Como aplicar em produção (com autorização):**

1. **Conferir antes**, só leitura:
   - o corpo de `comunidade_ponte.reunioes()` ainda tem o hash `808d0f8d78c401993f3076834d8fba6d` (corpo normalizado sem comentários e espaços, como em `lib/kickoff/comunidadePonte.test.ts`);
   - `agenda_kickoff_sessoes` existe;
   - guardar a contagem e o hash de `comunidade_ponte.reunioes()->'reunioes'`.
2. **Aplicar** `integracoes/kickoff/002_comunidade_ponte_sem_kickoff.sql`. Só ela.
3. **Conferir depois:**
   - o hash do corpo passa a ser `0542a72aeaf2b3dfebbecd3551ce3fea`;
   - dono `postgres`, `SECURITY DEFINER`, `search_path` vazio e permissões `{postgres=X/postgres}` sem mudança;
   - sem sessões de kickoff, a contagem e o hash de `reunioes()->'reunioes'` iguais aos do passo 1;
   - o cron sem mudança.
4. **Se precisar voltar:** aplicar o `.reverter.sql`.

**Lembretes dos participantes:** se forem desejados no futuro, saem das reservas (M3) ou do Zoom (M5/M6), nunca desta ponte.

## Permissão `kickoff_impulsao.manage`

**O que libera:**

- a opção "Kickoff Impulsão" ao criar evento na agenda;
- editar, mover e cancelar sessões de kickoff de qualquer anfitrião;
- a seção "Kickoffs Impulsão" (`/agenda/kickoffs`) e o atalho na agenda;
- o filtro "Todos / Reuniões / Kickoffs" e os detalhes internos da sessão (capacidade e ocupação, "3/5");
- buscar empresas, inscrever, remanejar e cancelar reservas, corrigir o participante principal e ver o histórico (M2);
- registrar comparecimento, concluir o kickoff da empresa e reagendar quem não compareceu (M2);
- mudar a capacidade, bloquear novas reservas e cancelar uma sessão junto com as reservas (M2).

**Quem tem:**

- quem recebeu a permissão no perfil do Meet;
- **o admin global do Meet** (ele concede e revoga);
- nunca quem não é da equipe do Meet, mesmo que a permissão esteja gravada.

**Onde mora:** na coluna `meet_user_profile.capacidades` (lista de permissões), no perfil que o Meet já tem. Não há tabela nova de usuários.

**Conferida no servidor:** a criação (`POST /api/agenda/eventos`), a edição e o cancelamento (`resolverAlvos`), a seção e todas as rotas dela (`/api/agenda/kickoffs/**`, via `gestorDeKickoff`). A tela só esconde o que a pessoa não pode usar.

**Conferida também no banco (M2):** cada função de reserva recebe o usuário da sessão (nunca do pedido) e confere de novo, em `meet_user_profile`, se ele é admin ou tem a permissão. Sem isso, recusa com `42501`.

**Conceder ou revogar** (só admin do Meet):

1. Abrir **Usuários** (`/admin/usuarios`).
2. Na linha da pessoa, ligar ou desligar o interruptor **Kickoffs**.
3. Vale no próximo carregamento da página da pessoa.

A lista mostra só e-mails `@legacyeducacaocorp.com.br`. Quem não aparece precisa primeiro ser cadastrado no Meet.

A permissão não depende de nome nem de e-mail. Se o responsável pelos kickoffs mudar, basta ligar para a pessoa nova e desligar para a anterior.

## Como a sessão se liga à agenda

- **Criar:** na agenda, **Criar → Mais opções → Kickoff Impulsão**. Escolher data, horário, repetição e quantas empresas por sessão (padrão 5).
- **O que é gravado:**
  - uma reunião em `meetings` por ocorrência, com:
    - anfitrião = quem criou (admin pode indicar outro pela API);
    - empresa = a organizadora;
    - setor = `executoria`;
    - `onboarding = true`, o que a deixa fora do ExecScore;
    - gravação e transcrição desligadas;
  - uma linha em `agenda_kickoff_sessoes` para cada reunião (capacidade e "aceita reservas");
  - se houver repetição, a série em `agenda_series`, como as outras séries.
- **O que não é feito:**
  - nenhum evento ou convite no Google Agenda;
  - nenhuma sala do Meet: o evento não traz o link da sala, e `/api/meetings/start` recusa sessão de kickoff.
- **Conflitos:** a sessão passa pelas mesmas regras da agenda (sobreposição, bloqueios, expediente, feriados). Ela ocupa a agenda do anfitrião como qualquer reunião. O filtro visual não muda a disponibilidade.
- **Editar, mover ou cancelar:** pelos mesmos caminhos da agenda, só para quem tem a permissão. Mudar a série inteira atinge só as sessões daquela série. Com empresas inscritas, valem as regras da seção "Reservas (M2)".
- **Desfazer a criação:** apaga as reuniões, e a marcação de kickoff vai junto. Recusado se alguma sessão já recebeu reserva (mesmo cancelada).
- **Rotas antigas** (`/api/meetings/[id]`, `/api/meetings/cancel`, `/api/meetings/no-show`): recusam sessão de kickoff (409) e mandam usar a agenda.

Código: `lib/kickoff/` (regras, servidor, evento, reservas), `app/api/agenda/eventos/route.ts` (criação), `lib/agenda/alvos.ts` (edição e cancelamento), `app/api/agenda/kickoffs/**` e `app/agenda/kickoffs/page.tsx` (seção), `components/agenda-nova/` (agenda, formulário e seção).

## Reservas (M2)

**Estado: código local, sem commit. As migrations `003` e `004` foram aplicadas em produção em 12/11/2026** (ver "Migrations aplicadas"). Até o código ser publicado e a organizadora configurada no servidor (Instalação, passo 4), ninguém usa as reservas. Nenhuma sessão nem reserva existe.

As regras vêm do Legacy CS ([guia técnico](referencia-cs/kickoff-cs-guia-tecnico.md), seções 2 e 3), adaptadas à agenda do Meet: a sessão é a reunião da agenda; a empresa é `client_tenants.id`; data, hora, anfitrião e estado vêm da reunião e não são copiados.

### Regra central: um kickoff por empresa

O kickoff é o onboarding da empresa e acontece **uma única vez**. As sessões se repetem na agenda porque empresas diferentes precisam participar, não para a mesma empresa voltar.

O sistema separa três coisas:

| | O que é | Como fica no banco |
|---|---|---|
| 1. Reserva | A empresa tem vaga numa sessão | `status = 'ativa'` |
| 2. Comparecimento | A empresa apareceu (ou não) na sessão | `presenca = 'presente'` ou `'ausente'`, com data, autor e origem (`manual`; `zoom` fica reservado para o futuro) |
| 3. Conclusão | O kickoff da empresa está feito | `status = 'concluida'`, com data e autor. Ato **explícito** de quem gerencia, só depois de `presenca = 'presente'` |

**O que conclui o kickoff:** só a ação "Concluir kickoff". Nada é presumido:

- o fim do horário não muda nada: a reserva continua `ativa` até alguém registrar o que aconteceu;
- comparecimento registrado não conclui;
- não existe rotina automática.

**Como cada situação fica:**

| Situação | Estado | A empresa pode... |
|---|---|---|
| Reserva futura | `ativa` | ...remanejar ou cancelar. Não pode ter outra reserva ao mesmo tempo |
| Sessão passou, nada registrado | `ativa` | ...esperar o registro. Não reserva outra (ainda tem uma) |
| Compareceu, conclusão pendente | `ativa` + `presente` | ...ser concluída, ou ter a **participação não concluída** registrada (motivo obrigatório). **Não pode ser cancelada** nem remanejada: um kickoff já realizado não se repete sem controle |
| Participou, não concluiu | `interrompida` + `presente` | ...ser **reagendada** (reserva nova, ligada à participação). A participação e o motivo ficam no histórico e não mudam |
| Não compareceu | `ausente` | ...ser **reagendada** (reserva nova, ligada à ausência). A ausência fica no histórico |
| Cancelou antes de concluir | `cancelada` | ...reservar de novo |
| Concluiu | `concluida` | **...nada.** Não reserva outro kickoff, não é cancelada, remanejada nem reaberta, nem por admin |

**Pendências:** sessão que já terminou com reserva ainda `ativa` (sem resultado, ou "compareceu" sem conclusão nem interrupção) aparece como **resultado pendente** na seção (aviso no topo e marca na sessão). Nada é concluído pelo horário e não há rotina automática.

**Correção de engano:** presença ou ausência registrada por engano se corrige na **mesma reserva**, com motivo obrigatório (veja "Correção de presença" abaixo). Não se cria reserva nova para corrigir um clique.

**Exceção (repetir um kickoff concluído):** não existe caminho, nem na tela, nem nas funções, nem por SQL comum (os gatilhos recusam). Se um dia for preciso, será um mecanismo novo, explícito, autorizado e auditável, tratado pelo suporte.

### Modelo

| Tabela | O que guarda |
|---|---|
| `agenda_kickoff_sessoes` (M1) | A marcação da reunião como sessão: capacidade (1 a 50, padrão 5) e "aceita reservas". A M2 acrescenta `atualizado_por` |
| `agenda_kickoff_reservas` | Uma empresa numa sessão. Guarda: `meeting_id` (a sessão), `tenant_id` (a empresa), participante principal (nome, e-mail obrigatório, telefone/WhatsApp), estado (`ativa`, `cancelada`, `ausente`, `interrompida`, `concluida`), comparecimento (`presenca`, quando, quem, origem), conclusão (quando, quem, observação), participação não concluída (quando, quem, motivo), `origem_reserva_id` (a ausência ou interrupção que esta reserva reagendou), quem e quando criou, alterou e cancelou |
| `agenda_kickoff_reservas_historico` | Só inclusão, gravado por gatilho: `criada`, `reagendada`, `remanejada` (de, para, motivo), `cancelada` (motivo), `participante_alterado` (antes e depois), `presenca_registrada`, `ausente`, `concluida`, `interrompida` (motivo), `presenca_corrigida` (antes, depois, motivo), com usuário e horário |

Relações:

- reserva → sessão: `on delete restrict`. Uma reunião com reserva, mesmo cancelada, não pode ser apagada;
- reserva → empresa: `on delete restrict` (ver "Exclusão de empresas no Plan");
- reserva → reserva ausente (`origem_reserva_id`): `on delete restrict`;
- histórico → reserva e sessões: `on delete restrict`.

Acesso: RLS ligado, sem policies, nada para `anon` e `authenticated`; só o servidor (`service_role`), pelas funções.

### Regras (no banco, valem para qualquer escrita)

| Regra | Onde |
|---|---|
| **Kickoff único:** no máximo uma reserva `ativa` OU `concluida` por empresa | Índice único parcial `agenda_kickoff_reservas_empresa_key (tenant_id) where status in ('ativa', 'concluida')`. Empresa concluída nunca mais tem reserva ativa; com reserva ativa, não tem outra |
| Concluída é definitiva | Gatilho `_agenda_kickoff_reservas_regras`: recusa mudar estado, sessão, presença ou conclusão de reserva concluída (só o participante pode ser corrigido) |
| Concluir exige presença `presente` | Check `agenda_kickoff_reservas_conclusao_presenca_ck` |
| Ausente e interrompida são definitivas para aquela reserva (fora a correção de presença da ausência) | Mesmo gatilho; `ausente` só depois do fim da sessão |
| Depois de presença registrada, não se cancela | Check `agenda_kickoff_reservas_cancelada_sem_presenca_ck` e a função de cancelar |
| Interrupção: só de quem compareceu, sempre com motivo | Checks `agenda_kickoff_reservas_interrompida_ck` e `..._interrompida_dados_ck` |
| Correção de presença: só pela função, com motivo; nunca concluída nem interrompida; nunca ausência que já gerou reagendamento | Mesmo gatilho (exige a marca da função e o motivo na transação) |
| Presença só depois do início da sessão, uma vez só | Mesmo gatilho |
| Reagendar: só ausência ou interrupção da mesma empresa, uma vez | Gatilho + índice único `agenda_kickoff_reservas_origem_key` |
| Capacidade: no máximo `capacidade` reservas não canceladas por sessão | Mesmo gatilho: trava a linha da sessão (`FOR UPDATE`) e só então conta |
| Só sessão futura, agendada, não cancelada e aberta para reservas | Mesmo gatilho, lendo a reunião depois da trava |
| A empresa organizadora (Customer Success) não é participante | Mesmo gatilho: recusa a empresa da reunião e a de qualquer sessão de kickoff. O servidor também recusa a organizadora e a sentinela do Comercial |
| E-mail obrigatório e válido; nome de 2 a 200; telefone de 8 a 15 dígitos | Checks da tabela (no CS o e-mail era opcional e só validado nas funções) |
| Capacidade nunca abaixo das vagas ocupadas | Gatilho `_agenda_kickoff_sessoes_capacidade` |
| Reserva não se apaga; cancelada não volta nem muda; empresa da reserva não muda | Gatilhos `agenda_kickoff_reservas_sem_apagar`, `..._sem_truncate` e o de regras |
| Histórico não se altera nem se apaga | Gatilhos `agenda_kickoff_historico_imutavel` e `..._sem_truncate` |
| Sessão com reserva não cancelada não muda de horário, estado nem empresa | Função `agenda_kickoff_remarcar_sessoes` (caminho do Meet) e, com a `004`, gatilho em `public.meetings` (qualquer caminho) |

Vaga ocupada = reserva `ativa`, `ausente`, `interrompida` ou `concluida` (a sessão já aconteceu com ela). Só `cancelada` libera a vaga.

**Concorrência.** Toda operação pega a fila única do kickoff (`pg_advisory_xact_lock`), trava a linha da sessão e a da reserva até o fim da transação. Reservar, concluir, cancelar, mudar a capacidade e mover ou cancelar a mesma sessão nunca se cruzam. As travas e o índice único valem mesmo para escrita fora das funções.

### Operações (funções do banco, chamadas só pelo servidor)

| Função | Faz |
|---|---|
| `agenda_kickoff_reservar(sessão, empresa, nome, e-mail, telefone, usuário)` | Inscreve a empresa. Se ela tiver uma ausência ainda não reagendada, a reserva nova fica ligada a ela |
| `agenda_kickoff_remanejar(reserva, sessão de destino, motivo, usuário)` | Leva a MESMA reserva (mesmo id) para outra sessão. Só reserva ativa sem presença registrada |
| `agenda_kickoff_cancelar_reserva(reserva, motivo, usuário)` | Cancela uma reserva ativa **sem presença registrada**; libera a vaga e a empresa. Recusa concluída, ausente, interrompida e quem compareceu |
| `agenda_kickoff_registrar_presenca(reserva, 'presente' ou 'ausente', usuário)` | Comparecimento manual. `presente` depois do início; `ausente` depois do fim (e vira estado `ausente`) |
| `agenda_kickoff_concluir(reserva, observação, usuário)` | Conclusão explícita e definitiva; exige `presente` |
| `agenda_kickoff_reagendar(reserva ausente ou interrompida, sessão, motivo, usuário)` | Reserva nova na sessão escolhida, com o mesmo participante, ligada à anterior |
| `agenda_kickoff_registrar_interrupcao(reserva, motivo, usuário)` | Participação não concluída: só de quem compareceu; motivo obrigatório. Libera a empresa para reagendar |
| `agenda_kickoff_corrigir_presenca(reserva, 'presente' / 'ausente' / 'nenhuma', motivo, usuário)` | Correção de engano na mesma reserva; motivo obrigatório; histórico com antes e depois |
| `agenda_kickoff_atualizar_participante(reserva, nome, e-mail, telefone, usuário)` | Corrige o participante (inclusive de reserva ausente ou concluída); sem mudança, não grava histórico |
| `agenda_kickoff_configurar_sessao(sessão, capacidade, aceita reservas, usuário)` | Capacidade e bloqueio (nulo = mantém) |
| `agenda_kickoff_remarcar_sessoes(itens, usuário)` | Mover, redimensionar e "Desfazer" da agenda para sessões de kickoff |
| `agenda_kickoff_cancelar_sessoes(sessões, cancelar reservas?, motivo, origem, usuário)` | Cancelar pela agenda (sem reservas) ou "cancelar com as reservas" (decisão explícita). Recusa sessão com presença ou conclusão registrada |

Rotas (todas só para quem gerencia kickoffs; nenhuma é pública):

- `GET /api/agenda/kickoffs`: sessões, ocupação e reservas;
- `GET /api/agenda/kickoffs/empresas?q=`: busca por nome (mínimo 2 letras, até 20, sem as empresas internas), dizendo quem já tem reserva, já concluiu ou faltou;
- `POST /api/agenda/kickoffs/reservas`: inscrever;
- `GET`, `PATCH` e `POST /api/agenda/kickoffs/reservas/[id]`: histórico; participante; `{acao: 'cancelar' | 'remanejar' | 'presenca' | 'concluir' | 'reagendar' | 'interromper' | 'corrigirPresenca'}`;
- `PATCH` e `POST /api/agenda/kickoffs/sessoes/[id]`: capacidade e bloqueio, `{acao: 'cancelar', comReservas: true}`.

### Procedimentos (seção Kickoffs Impulsão)

- **Inscrever:** na sessão, **Adicionar empresa**. Buscar pelo nome, escolher, preencher o participante principal (e-mail obrigatório). Aparecem desabilitadas: empresa com kickoff marcado (remanejar a reserva dela) e empresa que já concluiu. Empresa que faltou antes aparece com aviso; a reserva nova fica ligada à ausência.
- **Depois da sessão (presença):** a sessão continua na lista até cada empresa ter um registro.
  - **Compareceu:** a partir do início da sessão. Não conclui.
  - **Não compareceu:** depois do fim, com confirmação. Definitivo para aquela reserva.
- **Concluir kickoff:** para quem compareceu, com confirmação e observação opcional. Definitivo.
- **Não concluiu:** para quem compareceu e não terminou o kickoff (interrupção, problema técnico). Motivo obrigatório. Depois, **Reagendar**.
- **Reagendar:** na reserva de quem não compareceu ou não concluiu. Escolher uma sessão futura com vaga.
- **Corrigir presença:** em "Compareceu" ou "Não compareceu" registrados por engano. Escolher o valor certo ("Compareceu", "Não compareceu" ou "Sem registro") e o motivo (obrigatório). A mesma reserva é corrigida. Não aparece para reserva concluída, interrompida ou ausência já reagendada.
- **Resultado pendente:** o aviso no topo lista as sessões terminadas com empresas sem resultado; cada uma tem a marca "Resultado pendente".
- **Remanejar:** só antes da presença. Só aparecem sessões futuras, abertas e com vaga. O motivo vai para o histórico.
- **Cancelar reserva:** só reserva ativa sem presença registrada (antes de a empresa participar), com motivo opcional. Não tem volta; a empresa pode ser inscrita de novo.
- **Participante:** o lápis. Os dados anteriores ficam no histórico.
- **Histórico:** o relógio, na linha da empresa.
- **Capacidade e bloqueio:** no topo da sessão, antes de ela começar. "Aceita novas reservas" desligado = bloqueada (as inscritas continuam).
- **Cancelar sessão com empresas:** **Cancelar sessão e reservas**, com confirmação, antes de a sessão começar. Para manter alguma empresa, remanejar antes.

Nenhuma operação avisa a empresa: não há e-mail nem WhatsApp nesta etapa.

### Sessões com reservas: o que a agenda faz

"Com reserva" = qualquer reserva não cancelada (ativa, ausente ou concluída).

| Operação na agenda | Sem reserva | Com reserva |
|---|---|---|
| Mover ou mudar a duração (esta, seguintes, todas) | Como na M1 | **Recusada** (422): "A sessão de DD/MM às HH:MM tem N empresa(s) inscrita(s). Remaneje ou cancele as reservas antes de mudar o horário." Nada muda, nem nas outras sessões da série |
| Renomear | Como na M1 | Permitido (não afeta a reserva) |
| Cancelar (esta, seguintes, todas) | Como na M1 | **Recusada** (422), apontando para "Cancelar sessão e reservas" na seção. Na série, nada é cancelado se qualquer sessão atingida tiver empresa. Sessão com presença ou conclusão registrada não se cancela de jeito nenhum |
| "Desfazer" de movimento | Como na M1 | Recusado, pela mesma regra de mover |
| Desfazer a criação | Como na M1 | Recusado se a sessão já teve qualquer reserva |
| Reduzir capacidade | Livre (1 a 50) | Nunca abaixo das vagas ocupadas |
| Bloquear novas reservas | Livre | Livre; as inscritas continuam |

### Estados de erro

| HTTP | Código do banco | Quando |
|---|---|---|
| 400 | (servidor), `23514`, `23502` | Dados inválidos: e-mail ausente ou inválido, telefone, capacidade fora de 1 a 50, sessão ou empresa não escolhida, presença inválida |
| 403 | `42501` | Sem a permissão (servidor ou banco); apagar reserva ou alterar histórico |
| 404 | `P0002` | Sessão, reserva ou empresa não encontrada |
| 409 | `23505`, `23001` | Empresa já inscrita (nesta ou em outra sessão) ou com kickoff concluído; ausência já reagendada; sessão com reservas não se apaga |
| 422 | `22023` | Regra de negócio: sessão lotada, passada, cancelada, bloqueada; empresa organizadora; capacidade abaixo das vagas; sessão com reservas não muda de horário nem é cancelada; concluída, interrompida ou ausente não muda; presença antes do início ou ausência antes do fim; concluir ou registrar interrupção sem presença; cancelar depois de comparecer; correção sem motivo, sem registro anterior ou de ausência já reagendada |
| 503 | `PGRST202`, `42P01` | Migration `003` não aplicada |

### Exclusão de empresas no Plan (investigado em 12/11/2026)

Leitura do banco de produção, sem alterar nada:

- **O Plan inativa, não apaga.** `client_tenants` tem `inativo` e `inativo_em` (com o gatilho `carimba_inativacao`); 5 das 253 empresas estão inativas.
- **Exclusão física existe, mas é rara e restrita:**
  - a política de RLS `client_tenants_delete` só permite ao papel `MASTER`;
  - nenhuma função do banco nem Edge Function apaga empresas (busca nos corpos das funções do banco; nenhuma Edge Function do projeto tem nome ou papel de exclusão de empresa);
  - as estatísticas acumuladas da tabela (`pg_stat_user_tables`, sem data de início registrada) mostram **1 exclusão** contra 77 inclusões e 43.973 atualizações;
  - o código do front do Plan não está nos repositórios acessíveis (os candidatos não usam `client_tenants`), então a tela de exclusão, se existir, não foi lida.
- **Hoje a exclusão física já é bloqueada para quase todas as empresas:** 247 das 253 têm logins (`users.tenant_id`, chave sem cascata). As outras chaves sem cascata (`billing_audit_log`, `meeting_nps_responses`, `master_alerts`, `agenda_series`, `agenda_grupos`, `cohort_zoom_*`) bloqueiam do mesmo jeito.
- **Efeito das reservas:** uma empresa só tem reserva se for cliente real em onboarding, o que, na prática, significa ter logins. A trava nova (`on delete restrict`) é do mesmo tipo das que já existem e não muda a operação do Plan.
- **Decisão:** manter a proteção. Nenhuma mudança no fluxo de exclusão do Plan. Se um dia for preciso apagar uma empresa com histórico de kickoff, o caminho é o mesmo das outras chaves: decidir caso a caso (por exemplo, anonimizar o participante), nunca apagar o histórico.

### Compatibilidade da `004` (conferida em 12/11/2026)

Em produção, `public.meetings` já tem dois gatilhos: `meetings_updated_at_trigger` (grava `updated_at`) e `trg_guard_writable` (trava de inadimplência). Há 2.817 reuniões do Meet e 286 do Plan.

O teste `lib/kickoff/reuniaoProtegida.test.ts` usa as definições reais desses dois gatilhos (copiadas do banco) e RLS de atualização no estilo do Plan. Ele confere que:

- reuniões comuns do Meet movem, renomeiam e cancelam normalmente, e o `updated_at` continua sendo gravado;
- reuniões do Plan: o anfitrião (papel `authenticated`, com RLS) move, cancela e apaga a própria reunião; a trava de inadimplência continua valendo igual;
- sessões de kickoff sem reservas, ou só com canceladas, continuam editáveis, inclusive por SQL direto;
- sessões com reserva: horário, fim, estado (cancelar, no-show) e empresa são recusados mesmo por SQL direto como dono do banco; apagar também (`23001`);
- campos que não são horário, estado nem empresa (título, sala, gravação) continuam livres, e "atualizar" com o mesmo valor também;
- pelo Plan (sem acesso às tabelas do kickoff) a regra vale com mensagem clara, sem erro de permissão: o gatilho é `SECURITY DEFINER`;
- sessão histórica (reservas concluída, ausente e interrompida): título, sala e gravação continuam editáveis; data, fim, estado (cancelar, encerrar) e empresa não mudam, a reunião não se apaga e não se cancela com as reservas;
- cancelar a sessão junto com as reservas (decisão explícita) continua funcionando.

### Migrations aplicadas (12/11/2026)

As duas foram aplicadas **pelo SQL Editor do Supabase**, pelo responsável pelo projeto, entre 19:21 e 19:59 UTC de 12/11/2026, nesta ordem: `003`, depois `004`. A ferramenta de migration do Claude Code foi recusada duas vezes na janela de permissão; por isso a aplicação foi manual.

**Consequência: não há linha em `supabase_migrations.schema_migrations`** para a `003` nem para a `004`. A última registrada continua sendo `20261112171806` (`comunidade_ponte_sem_kickoff`). A prova do que foi aplicado é a conferência abaixo. Os cabeçalhos dos arquivos ainda dizem "NÃO APLICADA": o texto foi mantido como estava, porque é o conteúdo exato que foi aplicado (SHA-256 `df58ee35…` para a `003` e `941b1ea6…` para a `004`).

**Conferido antes** (só leitura):

- M1 presente: `agenda_kickoff_sessoes` com RLS e 0 sessões; check de `capacidades` instalado; nenhum perfil com `kickoff_impulsao.manage`;
- nenhum objeto com os nomes a criar;
- gatilhos de `meetings` (`meetings_updated_at_trigger`, `trg_guard_writable`) iguais aos usados no teste de compatibilidade: mesma definição e mesmo corpo (hash do corpo normalizado).

**Conferido depois da `003`** (só leitura):

- as 23 funções da `003` existem e o corpo de cada uma é **idêntico ao do arquivo** (md5 do corpo, uma a uma);
- todas pertencem a `postgres`, com `search_path` vazio; todas `SECURITY DEFINER`, menos `_agenda_kickoff_participante`, como no arquivo;
- `anon` e `authenticated` não executam nenhuma; `service_role` executa todas;
- `agenda_kickoff_reservas` (25 colunas) e `agenda_kickoff_reservas_historico` (9 colunas) criadas, com RLS ligado, sem policies e sem nenhum privilégio para `anon` e `authenticated`;
- `agenda_kickoff_sessoes.atualizado_por` criada;
- os 18 checks da reserva e os 2 do histórico, as 6 chaves estrangeiras (todas `on delete restrict`) e os 6 índices, inclusive `agenda_kickoff_reservas_empresa_key` (`where status in ('ativa', 'concluida')`) e `agenda_kickoff_reservas_origem_key`;
- os 7 gatilhos (regras, histórico, sem apagar, sem truncate, histórico imutável, capacidade), todos ativos;
- reservas, histórico e sessões: 0 linhas.
- **Customer Success não pode ser inscrita:** conferido pela definição (`_agenda_kickoff_conferir_vaga`, idêntica ao arquivo, recusa a empresa da reunião e a de qualquer sessão de kickoff) e pelos testes isolados. Não foi feito teste com dados reais, por decisão (nenhuma sessão ou reserva de teste em produção).

**Conferido depois da `004`** (só leitura):

- função `_agenda_kickoff_reuniao_protegida` com corpo idêntico ao do arquivo, `SECURITY DEFINER`, sem execução para `anon` e `authenticated`;
- gatilho `agenda_kickoff_reuniao_protegida` em `public.meetings`: `BEFORE UPDATE OF scheduled_start_at, scheduled_end_at, status, tenant_id`, com a cláusula `WHEN` do arquivo, ativo;
- `meetings_updated_at_trigger` e `trg_guard_writable` intactos: mesma definição e mesmo corpo de antes;
- reuniões comuns fora da regra: o gatilho só age quando há linha da reunião em `agenda_kickoff_sessoes` (0 em produção), e a compatibilidade está nos testes isolados (`lib/kickoff/reuniaoProtegida.test.ts`).

**Dados** (foto às 19:21 x conferência às 19:59 UTC):

- Customer Success e perfis do Meet: idênticos;
- reuniões: 25 alteradas e 3 criadas no intervalo, todas pelo uso normal do Meet e do Plan (entrar ao vivo, encerrar, edições de série), nenhuma sessão de kickoff;
- empresas: 6 atualizadas no intervalo pelo uso normal do Plan (horários espalhados de 19:25 a 19:59); as migrations não escrevem em `client_tenants`.

### Migrations (arquivos)

| Arquivo | O que faz | Toca em tabela do Plan? |
|---|---|---|
| [`integracoes/kickoff/003_kickoff_reservas.sql`](../../integracoes/kickoff/003_kickoff_reservas.sql) | Tabelas de reservas e histórico, gatilhos, funções (inclusive presença, conclusão e reagendamento), permissões; coluna `atualizado_por` em `agenda_kickoff_sessoes` | Não altera estrutura. Lê `meetings`, `client_tenants` e `meet_user_profile`; o cancelamento de sessão grava `meetings.status`, como a agenda já faz. As chaves para `client_tenants` são `on delete restrict` (seção acima) |
| [`integracoes/kickoff/004_kickoff_reuniao_protegida.sql`](../../integracoes/kickoff/004_kickoff_reuniao_protegida.sql) | Gatilho em `public.meetings`: sessão com reserva não cancelada não muda de horário, estado nem empresa, por nenhum caminho | **Sim**: cria um gatilho em `public.meetings`. Só roda quando muda horário, estado ou empresa, e só recusa sessão de kickoff com reserva. Precisa de autorização própria |

Ordem de aplicação: `003`, depois `004` (ambas aplicadas; seção acima). Para desfazer a `004`: `drop trigger agenda_kickoff_reuniao_protegida on public.meetings; drop function public._agenda_kickoff_reuniao_protegida();`.

### Limitações conhecidas

- **Presença pelo Zoom:** não existe nesta etapa. O comparecimento é registrado à mão; a coluna `presenca_origem` já aceita `zoom` para a coleta futura. Mesmo com o Zoom, a conclusão continua sendo um ato explícito.
- **Correção de presença:** só para presença ou ausência; nunca para conclusão (só pelo suporte) nem para participação não concluída (registrada com motivo).
  - Ausência que já gerou reagendamento não se corrige, mesmo que a reserva nova seja cancelada depois: a mensagem explica e o histórico fica coerente.
  - A correção só é aceita pelo gatilho dentro da função (marca de transação + motivo). Uma escrita SQL manual que imitasse a marca também precisaria do motivo e ficaria no histórico; não há outro caminho.
- **Proteção das sessões históricas (004):** título, sala, gravação e anfitrião continuam editáveis numa sessão com reservas ausentes, interrompidas ou concluídas. Data, fim, estado e empresa não mudam, e a reunião não se apaga.
- **Sessão passada:** não recebe reserva nem remanejamento, e a seção não oferece ações de sessão nela (capacidade, bloqueio, adicionar, cancelar com reservas). Ela continua na lista enquanto alguma reserva estiver sem registro. Como a sessão de kickoff não usa a sala do Meet, a reunião continua "agendada" depois do horário; a tela mostra "Em andamento" ou "Encerrada" pelo horário.
- **Avisos:** nenhuma mudança avisa as empresas (e-mail e WhatsApp ficam para depois).
- **Agenda do cliente no Plan:** as empresas inscritas ainda não veem o kickoff na agenda delas (`agenda_do_cliente()` continua ignorando sessões de kickoff).
- **Tela logada:** a seção não foi aberta com uma conta real nesta etapa (exigiria login e banco com as migrations). A interface foi conferida por tipos e lint; as regras, pelos testes de banco e de rota.

## Convites e agendamento público (M3)

**Estado: código local, sem commit. A migration `005` foi aplicada em produção em 12/11/2026, manualmente pelo SQL Editor** (seção "Migration 005 aplicada"). Nenhum convite existe. Até o código ser publicado com `KICKOFF_PUBLIC_BASE_URL` e `KICKOFF_ORIGEM_SECRET` (Instalação, passo 9), ninguém usa os convites. Num ambiente sem a `005`, a seção mostra "Os convites dependem da migration 005" e o link público responde com aviso genérico. Nada de Zoom nesta etapa.

Baseado no Legacy CS ([guia técnico](referencia-cs/kickoff-cs-guia-tecnico.md), seções 4 e 5): o calendário Mês/Semana/Dia, o formulário em duas etapas e os textos foram portados. O que mudou: a empresa é `client_tenants.id`; o visitante nunca fala com o banco (a rota do Meet fala, com `service_role`); o convite expira; a página não mostra CNPJ nem sugere contatos da empresa.

### Como funciona

1. A equipe gera o **convite da empresa** na seção Kickoffs Impulsão e copia o link: `<KICKOFF_PUBLIC_BASE_URL>/impulsao/agendar/<código>` (seção "Endereço oficial dos links").
2. A empresa abre o link **sem login**, vê o nome dela, escolhe um horário (Mês, Semana ou Dia) e informa o participante principal (nome, **e-mail obrigatório**, WhatsApp opcional).
3. A confirmação chama a função do banco, que **insere a reserva pelas mesmas regras da M2** (gatilho com trava da sessão, capacidade, uma reserva ativa ou concluída por empresa, sessão futura e aberta, organizadora fora). A reserva fica com `convite_id` e o histórico registra "Agendado pela empresa, pelo link do convite".
4. **Recuperar a reserva:** o mesmo link, aberto de novo, mostra o kickoff marcado (data, horário, participante, quem conduz). Não há outra senha nem e-mail.

**Código do convite x link da videoconferência.** O código identifica a **empresa** (para agendar e consultar). O link individual do Zoom é outra coisa: fica só no servidor, e `/impulsao/reuniao/<mesmo código>` acha a reserva pelo convite e encaminha a ele (seção "Zoom E2: acesso individual"). O acesso à reunião de uma reserva ativa não depende da validade de 90 dias (que é só para novos agendamentos): convite expirado com reserva ativa continua levando à reunião; convite revogado, não.

### Modelo

| Objeto | O que é |
|---|---|
| `agenda_kickoff_convites` | `codigo` (12 caracteres, alfabeto sem 0/o/1/l/i, check no banco), `tenant_id` (a empresa), quem e quando criou, `expira_em`, revogação (quando, quem, motivo). **Um convite em vigor por empresa** (índice único parcial). Não se apaga nem muda: só se revoga (gatilho) |
| `agenda_kickoff_reservas.convite_id` | Coluna nova: qual convite fez a reserva (nula = reserva feita pela equipe) |
| `agenda_kickoff_limite_publico` | Contagem de tentativas por chave, em janela de 15 minutos; linhas com mais de 1 dia são apagadas a cada uso |

O código sai de 12 bytes aleatórios do `gen_random_uuid` (gerador seguro do Postgres), só das posições sem bits fixos: cerca de 7,9·10¹⁷ combinações. O link não leva id, CNPJ nem nome.

**Validade:** 90 dias por padrão (1 a 365, na geração). A validade limita **novos agendamentos**, não a consulta de quem já agendou:

| Convite | Abrir o link | Agendar | Conta tentativa da origem? |
|---|---|---|---|
| Válido | Mostra os horários (ou a reserva, se já houver) | Sim | Não |
| Expirado, **sem** reserva ativa ou concluída | "Este link expirou" | Não | Sim (como código errado) |
| Expirado, **com** reserva ativa ou concluída | Só consulta: o kickoff marcado (ou "concluído"), com o aviso de que o prazo para novos agendamentos acabou. Nenhum horário aparece | Não (recusado mesmo para outra sessão) | Não, ao consultar; sim, ao tentar agendar |
| Revogado (inclusive pela reemissão) | "Este link foi substituído", **mesmo com reserva** | Não | Sim |

Empresa que faltou, não concluiu ou cancelou não tem reserva viva: com convite expirado, o link não abre e a equipe gera outro. Gerar de novo revoga o expirado e cria outro (a reserva não muda e passa a aparecer no link novo). Na lista da equipe, convite expirado com reserva aparece como "Expirado (só consulta)" e ainda pode ser copiado; sem reserva, não.

### Operação (seção Kickoffs Impulsão, só quem gerencia kickoffs)

- **Gerar:** em "Convites das empresas", buscar a empresa (2 letras ou mais) e clicar em **Convite**. Se já houver convite em vigor, ele é reaproveitado (não duplica). O link aparece com **Copiar link**. Empresa que concluiu o kickoff não recebe convite; a organizadora e a sentinela do Comercial também não.
- **Lista:** convites em vigor, com a situação do kickoff de cada empresa (ainda não agendou, data agendada com atalho para a sessão, concluído) e a validade.
- **Reemitir:** o link atual para de abrir na hora e nasce outro (ex.: o link vazou). A reserva não muda.
- **Revogar:** o link para de abrir e nenhum outro é criado. A reserva não muda.
- **Enviar o link:** pela equipe, por fora do sistema. Nada é enviado automaticamente.

### Rotas

| Rota | Login | O que faz |
|---|---|---|
| `/impulsao/agendar/[codigo]` | Não | A página (`noindex`, sem referrer) |
| `GET /api/impulsao/convites/[codigo]` | Não | O que a página mostra |
| `POST /api/impulsao/convites/[codigo]/agendar` | Não | `{sessaoId, nome, email, telefone}`; a empresa sai do convite |
| `GET` e `POST /api/agenda/kickoffs/convites` | Sim (gestor) | Lista; `{acao: 'gerar' \| 'reemitir' \| 'revogar', tenantId, motivo?, dias?}` |

O middleware libera só `/impulsao/*` e `/api/impulsao/*`. A busca de empresas (`/api/agenda/kickoffs/empresas`) e a gestão continuam exigindo login e a permissão.

**O que a página recebe** (nada além disso): nome da empresa; situação (`disponivel`, `reservada`, `concluida`); `expirado` (só consulta); a reserva ativa (data, início, fim, nome do participante, quem conduz); e as sessões disponíveis (id, data, início, fim, vagas, quem conduz).

**Quem conduz:** o anfitrião da sessão na agenda, com nome e foto. A foto só vai para a página se for a **foto pública do perfil**: um endereço do bucket público `avatars` do Supabase (`https://<projeto>.supabase.co/storage/v1/object/public/avatars/...`, sem parâmetros). A regra está no banco (`_agenda_kickoff_publico_anfitriao`) e de novo no servidor do Meet (`FOTO_PUBLICA`, em `lib/kickoff/convites.ts`); qualquer outro endereço (site externo, link assinado, `javascript:`) é descartado. Sem foto, ou se ela não carregar, a página mostra as iniciais do nome. Em 12/11/2026, 5 perfis da equipe tinham foto nesse bucket e 28 não tinham foto.

### Disponibilidade

A página mostra só sessões de kickoff da agenda do Meet que estão agendadas, futuras (até 180 dias), abertas para reservas e com vaga. Nada é gerado pela página; a recorrência continua sendo a da agenda.

| Situação | O que o visitante vê |
|---|---|
| Carregando | "Carregando os horários…" |
| Falha técnica | "Não foi possível abrir" + "Tentar de novo" |
| Código errado / revogado / expirado sem reserva | "Link inválido" / "Este link foi substituído" / "Este link expirou" |
| Expirado com reserva | A confirmação da reserva (ou "Kickoff concluído"), com a nota de que o prazo para novos agendamentos acabou |
| Muitas tentativas | "Aguarde 15 minutos" |
| Sem horários | "Ainda não há horários abertos" |
| Horário lotou ou saiu enquanto confirmava | Volta ao calendário (relido) com o aviso; os dados digitados ficam |
| Já tem kickoff marcado | A confirmação da reserva existente |
| Já concluiu | "Kickoff concluído" |
| Faltou ou não concluiu antes | Pode agendar de novo; a reserva nova fica ligada à anterior (regra da M2) |

### Segurança

- **Sem acesso direto ao banco:** tabelas e funções só para `service_role`; `anon` e `authenticated` não leem nem executam nada. O navegador fala só com as rotas do Meet.
- **Empresa só do convite:** as funções públicas não recebem empresa; qualquer `tenantId` no corpo é ignorado (testado).
- **Código validado no servidor:** fora do formato nem vai ao banco; aceita maiúsculas e espaços (normalizados).
- **Limite de tentativas** (no banco, vale para qualquer instância do servidor):
  - código errado, revogado ou expirado sem reserva (e agendar com convite expirado) conta 1 tentativa da origem; **10 em 15 minutos bloqueiam a origem**, inclusive para código certo (senão o bloqueio revelaria qual código existe);
  - **10 pedidos de agendamento em 15 minutos por convite**.
- **Origem do visitante:** HMAC-SHA256 do IP com `KICKOFF_ORIGEM_SECRET` (seção "IP do visitante e limite de tentativas"). O banco nunca vê o IP.
- **Respostas:** só os campos do contrato público, montados campo a campo no servidor; falha do banco vira mensagem genérica (503), sem detalhe interno; `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.
- **Duplicidade:** pedido repetido para a mesma sessão devolve a mesma reserva; para outra sessão, "já inscrita". O índice único da M2 é a garantia final, inclusive com pedidos simultâneos (testado em Postgres real).
- **Plan:** nenhuma rota pública lista empresas; os dados digitados pelo cliente ficam só na reserva (nada é criado no cadastro do Plan).

### Endereço oficial dos links (`KICKOFF_PUBLIC_BASE_URL`)

O link entregue ao cliente é montado **no servidor**, a partir de `KICKOFF_PUBLIC_BASE_URL` (`lib/kickoff/enderecoPublico.ts`). Não depende do domínio em que a equipe está no navegador.

- **Formato:** `https://` + domínio público, opcionalmente com caminho (ex.: `https://<domínio oficial>` ou `https://<domínio>/<caminho>`). A barra final é ignorada.
- **Recusado:** sem `https`; `localhost`, `*.localhost`, `*.local`, `*.internal`; IPs locais ou privados (`127.x`, `10.x`, `192.168.x`, `172.16–31.x`, `0.0.0.0`, `[::1]`); usuário/senha, parâmetros (`?`) ou `#` no endereço.
- **Sem a variável (ou com valor recusado):** gerar e reemitir convite respondem 409 com o motivo, **antes** de ir ao banco (nenhum convite é criado com link que não serve ao cliente). A lista continua abrindo, mostra o aviso em vermelho e não oferece link para copiar. Revogar continua funcionando.
- **Domínio definitivo:** não foi escolhido nesta etapa. Quem publica define o valor. O domínio atual do Meet em produção (atrás da Cloudflare) serve, se a operação decidir usá-lo.

### IP do visitante e limite de tentativas

**Verificado em 12/11/2026 (só leitura, sem mudar infraestrutura):** o domínio de produção do Meet resolve para IPs da Cloudflare e responde com `Server: cloudflare` e `CF-RAY`. Atrás dela, o app roda no EasyPanel (Traefik). Ou seja: o visitante fala com a Cloudflare, que fala com o servidor.

**O que o Meet usa** (`lib/kickoff/origem.ts`):

- **Padrão: `cf-connecting-ip`.** A Cloudflare sempre preenche esse cabeçalho com o IP de quem se conectou a ela e **sobrescreve** o valor que o visitante mandar. O valor é validado (só dígitos, `.`, `:`, a–f); fora disso, vira uma chave comum `?`.
- **`x-forwarded-for` não é usado** por padrão: o visitante controla o começo da lista. Para um deploy sem Cloudflare existe o modo `KICKOFF_IP_CABECALHO=x-forwarded-for`, que conta da **direita** (`KICKOFF_PROXIES_CONFIAVEIS`, padrão 1: o último valor, acrescentado pelo proxy confiável), nunca o primeiro.
- **Chave:** `KICKOFF_ORIGEM_SECRET` (32 caracteres ou mais). **Em produção é obrigatória e não há reserva** (não usa `HOST_LINK_SECRET` nem `LIVEKIT_API_SECRET`): sem ela, as rotas públicas respondem 503 genérico e registram o motivo no log do servidor, sem ir ao banco. Fora de produção, sem a chave, usa um hash simples (desenvolvimento e testes).

**Exigência externa, NÃO verificada:** `cf-connecting-ip` só é confiável se o servidor **aceitar tráfego apenas da Cloudflare**. Se o IP do servidor puder ser acessado direto (sem passar pela Cloudflare), quem souber esse IP pode mandar qualquer `cf-connecting-ip` e trocar de "origem" a cada pedido. Para fechar isso, uma destas, fora do Meet: firewall do servidor liberando 80/443 só para as faixas de IP da Cloudflare, ou Authenticated Origin Pulls (certificado da Cloudflare exigido no Traefik). **Não foi conferido nesta etapa e não se pode declarar a proteção por origem como validada em produção** até alguém testar um pedido direto ao IP do servidor.

**O que continua valendo mesmo se a origem for contornada:** o limite de 10 agendamentos por convite em 15 minutos, a regra de uma reserva por empresa e o espaço de códigos (~7,9·10¹⁷). Com Cloudflare na frente, as regras de rate limit da própria Cloudflare também podem ser usadas (não configuradas).

### Migration 005

| Arquivo | O que faz | Toca em tabela do Plan? |
|---|---|---|
| [`integracoes/kickoff/005_kickoff_convites.sql`](../../integracoes/kickoff/005_kickoff_convites.sql) | Convites, limite de tentativas, funções públicas e de gestão; coluna `convite_id` em `agenda_kickoff_reservas` | Não altera estrutura. Lê `client_tenants`, `meetings` e `users` (nome e foto do anfitrião). Chave `on delete restrict` para `client_tenants` (como as reservas) |

Depende de `001`, `003` e `004`. **Aplicada; não reaplicar nenhuma delas.**

### Migration 005 aplicada (12/11/2026)

Aplicada **manualmente pelo SQL Editor do Supabase**, pelo responsável pelo projeto, entre 21:17:40 e 21:19:40 UTC de 12/11/2026 (transação `2401113`). O arquivo aplicado é o validado: SHA-256 `0cbb1913282b1d92…`.

**Por ser manual, a `005` não aparece em `supabase_migrations.schema_migrations`** (como a `003` e a `004`). O histórico tem só `kickoff_m1_sessoes_e_permissao` e `comunidade_ponte_sem_kickoff`. A prova do que foi aplicado é a conferência abaixo. O cabeçalho do arquivo ainda diz "NÃO APLICADA": o texto foi mantido, porque é o conteúdo exato que foi aplicado.

**Conferido depois** (só leitura, 21:19 a 21:22 UTC):

- **`agenda_kickoff_convites`:** 9 colunas, como no arquivo; chave primária; `codigo` único e com o check do alfabeto (`^[a-hj-km-np-z2-9]{12}$`); check do motivo (até 500); check `expira_em > criado_em`; chave para `client_tenants` com `on delete restrict`; índice único parcial `agenda_kickoff_convites_empresa_key` (`tenant_id` onde `revogado_em is null`: um convite em vigor por empresa). RLS ligado, sem policies; privilégios só para `service_role`; `anon` e `authenticated` sem leitura nem escrita.
- **Revogação:** gatilhos `agenda_kickoff_convites_imutavel` (antes de update e delete, por linha) e `agenda_kickoff_convites_sem_truncate` (antes de truncate), ambos ativos. A função do gatilho é idêntica ao arquivo: convite não se apaga, revogado não muda, e a única mudança aceita é revogar.
- **`agenda_kickoff_limite_publico`:** 3 colunas, chave primária `chave`, RLS ligado, sem policies, só `service_role`.
- **`agenda_kickoff_reservas.convite_id`:** `uuid`, nulo permitido, chave para `agenda_kickoff_convites` com `on delete restrict`.
- **As 16 funções da `005`:** uma versão de cada, com a assinatura do arquivo e o **corpo idêntico ao arquivo** (md5 do corpo normalizado, uma a uma). Todas pertencem a `postgres`, com `search_path` vazio; todas `SECURITY DEFINER`, menos `_agenda_kickoff_codigo_convite`, como no arquivo. `anon`, `authenticated` e `PUBLIC` não executam nenhuma; `service_role` executa todas. As funções da M2 que a `005` usa (`_agenda_kickoff_participante`, `_fila`, `_exigir_gestor`, `_ocupadas`, `_reservas_regras`) existem.
- **Convite expirado com reserva:** conferido pela definição (corpos idênticos ao arquivo): `agenda_kickoff_publico_convite` só devolve "expirado" quando a empresa não tem reserva ativa nem concluída; com reserva, devolve a consulta com `expirado = true` e sem sessões; `agenda_kickoff_publico_agendar` recusa qualquer agendamento com convite expirado. O comportamento está nos testes isolados (`lib/kickoff/convites.test.ts`). **Sem teste com dados reais, por decisão.**
- **Convite revogado:** `_agenda_kickoff_convite_aberto` (idêntica ao arquivo) devolve "convite revogado" antes de olhar reserva ou validade, e conta a tentativa da origem.
- **Dados:** 0 convites, 0 linhas de tentativas, 0 reservas com convite. Nenhum convite real foi gerado.

**Dados** (foto às 21:17:40 x conferência às 21:19:40 UTC):

- sessões de kickoff, reservas e histórico: 0, idênticos;
- reuniões (3.114) e usuários (581): idênticos (mesmo hash do conteúdo);
- empresas: 253, mesmas linhas; 2 tiveram `updated_at` alterado (21:18:23 e 21:19:58), em transações próprias (`2401117` e `2401140`), diferentes da transação da migration: uso normal do Plan. A `005` não escreve em `client_tenants`.

### Limitações e decisões

- **Zoom:** sem a migration `007`, a confirmação diz que o acesso à reunião será informado pelo time da Legacy. Com ela, mostra o acesso (seção "Zoom E2: acesso individual").
- **Sem avisos automáticos:** nem para a empresa, nem para a equipe, quando alguém agenda pelo link.
- **Troca de horário ou de participante pelo cliente:** não existe; ele fala com a equipe (que remaneja ou corrige na seção).
- **Origem por cabeçalho:** depende de o servidor só aceitar tráfego da Cloudflare (seção "IP do visitante"). Não verificado em produção.
- **Validade de 90 dias:** escolha desta etapa; ajustar se a operação preferir outra.
- **Domínio:** o link sai de `KICKOFF_PUBLIC_BASE_URL`, definida por quem publica; o domínio definitivo não foi escolhido nesta etapa.

## Zoom E1: sala dos kickoffs

**Estado: código local, sem commit. A migration `006` foi aplicada em produção em 13/11/2026, manualmente pelo SQL Editor** (seção "Migration 006 aplicada"). Nenhuma sala foi cadastrada e nenhuma chamada real ao Zoom foi feita; os testes usam um Zoom simulado.

Baseado no Legacy CS ([guia técnico](referencia-cs/kickoff-cs-guia-tecnico.md), seção 6 e Apêndices A e B; [handoff](referencia-cs/kickoff-cs-para-meet-handoff.md), seção 5.5) e nas regras do Legacy Plan para inscrição (`checkMeetingConfig`).

### Objetivo

Os kickoffs acontecem no Zoom, não na sala do Meet. A E1 prepara a base: o Meet passa a conhecer **uma reunião recorrente do Zoom, exclusiva do Impulsão**, que serve todas as sessões. Na E2, cada empresa com reserva vai se inscrever uma vez nessa reunião e receber um link individual.

- **Zoom:** só a videoconferência.
- **Meet:** calendário, disponibilidade, sessões, empresas, reservas, convites e histórico (como nas etapas anteriores). Nada de Zoom é gravado nas sessões.
- **Uma reunião só** (Meeting ID compartilhado). Não se cria reunião por sessão. Cada execução poderá ser identificada depois pelo UUID da instância (E3).

### O que a E1 permite

Na seção **Kickoffs Impulsão**, quadro **Sala Zoom** (só admin ou `kickoff_impulsao.manage`):

- ver a sala ativa (título, ID, última verificação, resumo da configuração, problemas);
- informar um Meeting ID (ou o link de entrada `/j/...`) e **verificar no Zoom**: o resultado mostra se a configuração é compatível, os problemas com a orientação para corrigir e os avisos;
- **ativar** a sala aprovada; **trocar** a sala ativa (com motivo); **verificar de novo** a sala ativa;
- ver o histórico (ativações, trocas, verificações, quem e quando);
- saber quando a integração não está configurada (faltam variáveis) ou quando a migration está pendente.

Abrir a tela **não chama o Zoom** (só lê o banco). O Zoom só é consultado ao clicar em verificar ou ativar, e **só para ler** a reunião (`GET /meetings/{id}`): nada é criado nem alterado na conta Zoom.

### Configuração exigida da sala

| Exigência | Por quê | Se faltar |
|---|---|---|
| Reunião **recorrente com horário fixo** (tipo 8: diária, semanal ou mensal) | Tipo 3 ("sem horário fixo") não aceita inscrição; reunião única acaba | Problema: bloqueia |
| **Inscrição obrigatória** com **aprovação automática** | Com aprovação manual, a empresa ficaria "pendente", sem link | Problema: bloqueia |
| **"Inscrever-se uma vez e participar de qualquer ocorrência"** | É o que permite a mesma inscrição valer em qualquer sessão (reaproveitar o registrante entre sessões, inclusive depois de remanejar) | Problema: bloqueia |
| **Sem "exigir autenticação"** | O cliente entra pelo link individual, sem conta Zoom da Legacy | Problema: bloqueia |
| **Exclusiva do Impulsão** (não pode ser de turma do Plan) | A coleta de presença do Plan passaria a vigiar os kickoffs | Problema: bloqueia (servidor e banco) |
| Não ser a reunião de teste do CS (`88672328525`) | É de uma turma antiga de testes do Plan | Problema: bloqueia (e já cai na regra acima: está em 1 cronograma e 12 sessões de turma do Plan, conferido em 13/11/2026) |
| Ocorrências futuras; última a mais de 30 dias | Sem ocorrências, a sala deixa de servir; o comportamento depois da última ocorrência não foi testado | Aviso |
| Sem sala de espera; sem entrada antes do anfitrião | Recomendação do handoff | Aviso |

**Conta Zoom autorizada:** o app Server-to-Server só lê reuniões da própria conta. Reunião de outra conta responde "não encontrada" (código 3001) ou sem permissão; as duas aparecem como erro e a sala não é aceita.

### Como criar a reunião no Zoom (operação, fora do Meet)

1. Com um usuário da conta Zoom da Legacy (a mesma do app do Plan), **Agendar reunião** com o título, por exemplo, "Kickoff Impulsão".
2. Marcar **Reunião recorrente**, recorrência **semanal** (ou diária/mensal) com horário fixo. O Zoom aceita até 50 ocorrências; o ID expira 365 dias depois do último início.
3. **Inscrição: obrigatória.** Em opções de inscrição: **aprovar automaticamente** e **"os participantes se inscrevem uma vez e podem participar de qualquer ocorrência"**.
4. Desligar **exigir autenticação**, **sala de espera** e **permitir entrar antes do anfitrião**.
5. Não usar essa reunião em nenhuma turma do Plan.
6. Copiar o Meeting ID.

Os horários das ocorrências do Zoom **não precisam coincidir** com cada sessão do Meet: a agenda continua no Meet. Elas existem para manter a reunião válida e a inscrição aberta.

### Validar, ativar e trocar (seção Kickoffs Impulsão)

1. Colar o Meeting ID (ou o link `/j/...`) em **Configurar a sala** e clicar **Verificar no Zoom**.
2. Com "Configuração aprovada", clicar **Ativar esta sala**. O servidor **consulta o Zoom de novo** antes de gravar; o banco exige verificação aprovada há menos de 2 horas e recusa sala de turma do Plan.
3. **Trocar:** verificar a sala nova e clicar **Trocar para esta sala**; o motivo é obrigatório. A anterior fica desativada no histórico (não se apaga). Voltar para uma sala antiga reativa a mesma linha.
4. **Verificar de novo:** confere a sala ativa e grava o resultado. Se o Zoom mudou, a sala continua ativa com os problemas à mostra, e a equipe decide (corrigir no Zoom ou trocar). Falha passageira (rede, limite, instabilidade) e problema de credencial não gravam nada.

**Cuidados com o Meeting ID compartilhado:**

- todas as sessões usam a mesma reunião: quem tem o link genérico entra em qualquer horário que o anfitrião abrir. Por isso o link genérico nunca é guardado nem mostrado; na E2 cada empresa recebe o link individual de inscrição;
- o anfitrião precisa iniciar a reunião em cada sessão; duas sessões não podem acontecer ao mesmo tempo na mesma sala;
- trocar a sala depois que existirem inscrições (E2) obriga a inscrever as empresas de novo na sala nova (o link antigo continua apontando para a sala antiga);
- a separação de várias execuções da mesma sala (presença por sessão) é da E3 e ainda não foi validada com dados reais.

### Modelo (migration 006)

| Objeto | O que é |
|---|---|
| `agenda_kickoff_zoom_salas` | Meeting ID (9 a 12 dígitos, único, **não muda**), título, `ativa` (**uma por vez**, índice único parcial), última verificação (ok, problemas, resumo, quando, quem), ativação e desativação (quando, quem, motivo). **Não se apaga** |
| `agenda_kickoff_zoom_salas_historico` | Cada ativação, reativação, desativação e verificação, com resultado, motivo e quem. **Não muda nem se apaga** |
| `agenda_kickoff_zoom_sala_usada_no_plan(id)` | O Meeting ID aparece em `cohort_schedules`, `cohort_sessions` ou `cohort_zoom_meeting_checks` do Plan? (só leitura) |
| `agenda_kickoff_zoom_sala_ativar(...)` | Ativa, troca (motivo obrigatório) ou reativa; exige gestor; usa a fila das escritas do kickoff |
| `agenda_kickoff_zoom_sala_registrar_verificacao(...)` | Guarda uma nova verificação da sala (aprovada ou não), sem ativar nem desativar |

- **Gatilho:** ativar exige verificação aprovada nas últimas 2 horas e sala fora do Plan, também para escrita direta.
- **Resumo guardado (lista fechada):** tipo, recorrência, aprovação, tipo de inscrição, fuso, duração, ocorrências futuras, próxima e última, sala de espera, autenticação, entrada antes do anfitrião. **Nunca** link do anfitrião, link de entrada, senha ou e-mail.
- **Acesso:** RLS ligado, sem policies; tabelas e funções só para `service_role`. `anon` e `authenticated` não leem nem executam nada (testado).
- **Compatível com a E2:** a inscrição (E2) será da **sala** (Meeting ID + e-mail), como no CS; o modelo das reservas não muda. Nada é duplicado nas sessões.
- **Não altera** nenhuma tabela existente (Meet ou Plan), nem as funções das etapas anteriores.

### Migration 006 aplicada (13/11/2026)

Aplicada **manualmente pelo SQL Editor do Supabase**, pelo responsável pelo projeto, em 13/11/2026. Arquivo validado: `integracoes/kickoff/006_kickoff_zoom_sala.sql`, SHA-256 `fcfb798aee31f617…`.

**Por ser manual, a `006` não aparece no histórico automático de migrations** (`supabase_migrations.schema_migrations`), como a `003`, a `004` e a `005`: a última registrada continua sendo `comunidade_ponte_sem_kickoff`. A prova do que foi aplicado é a conferência abaixo. O cabeçalho do arquivo ainda diz "NÃO APLICADA": o texto foi mantido, porque é o conteúdo exato que foi aplicado.

A aplicação foi uma transação só (`2411177`): as duas tabelas, as 5 funções e os 5 gatilhos nasceram nela.

**Conferido depois** (só leitura, 13/11/2026 às 13:56 UTC, pelo conector do Supabase em modo somente leitura, com a consulta [`integracoes/kickoff/006_conferencia_leitura.sql`](../../integracoes/kickoff/006_conferencia_leitura.sql)):

- **`agenda_kickoff_zoom_salas`:** 16 colunas, como no arquivo; chave primária; Meeting ID único e com o check do formato; checks de título, problemas, resumo, motivo da desativação e `ativa`. **`agenda_kickoff_zoom_salas_historico`:** 8 colunas; chave primária; chave para a sala; checks de ação, motivo e problemas. São 8 restrições na sala e 5 no histórico.
- **Índices:** `agenda_kickoff_zoom_salas_uma_ativa` (`UNIQUE ... (ativa) WHERE ativa`: uma sala ativa por vez) e `agenda_kickoff_zoom_salas_historico_sala_idx`, além dos das chaves.
- **Gatilhos:** os 5, todos ativos: `agenda_kickoff_zoom_salas_guarda` (`BEFORE INSERT OR UPDATE`), `agenda_kickoff_zoom_salas_sem_apagar`, `agenda_kickoff_zoom_salas_sem_truncate`, `agenda_kickoff_zoom_historico_imutavel` e `agenda_kickoff_zoom_historico_sem_truncate`.
- **Acesso:** RLS ligado nas duas tabelas, sem policies; `anon` e `authenticated` sem leitura nem escrita; `service_role` com leitura e escrita.
- **As 5 funções da `006`:** uma versão de cada, com o **corpo idêntico ao arquivo** (md5 do corpo normalizado, uma a uma), `search_path` vazio e `SECURITY DEFINER`. `anon`, `authenticated` e `PUBLIC` não executam nenhuma; `service_role` executa todas.
- **Ativar exige verificação aprovada nas últimas 2 horas:** conferido pela definição (função `_agenda_kickoff_zoom_sala_guarda` idêntica ao arquivo, ligada ao gatilho de inserção e atualização) e pelos testes isolados (`lib/kickoff/zoomSalaBanco.test.ts`). **Sem teste com dados reais, por decisão.**
- **Salas de turmas do Plan:** `agenda_kickoff_zoom_sala_usada_no_plan` é idêntica ao arquivo. O usuário de leitura do conector não pode executá-la (permissão negada, o que confirma a restrição a `service_role`), então as linhas 5a e 5b da consulta foram conferidas com a mesma regra da função, lendo as tabelas: a sala de teste `88672328525` está em 1 cronograma, 12 sessões e 1 verificação de turma do Plan (logo, é recusada); os 3 Meeting IDs de turmas em `cohort_schedules` e `cohort_sessions` têm dígitos e são reconhecidos pela regra.
- **M1, M2 e M3 preservadas:** as 41 funções de `001`, `003`, `004` e `005` continuam com o corpo idêntico aos arquivos, uma versão de cada, e as de `003` a `005` sem execução para `anon` e `authenticated`.
- **Dados:** 0 salas e 0 linhas de histórico de salas. Nenhuma sala foi cadastrada nem ativada.

**Dados** (foto de 12/11/2026, antes da `005`, x conferência de 13/11/2026 às 13:56 UTC):

- sessões de kickoff, reservas, histórico de reservas, convites e tentativas públicas: 0, idênticos;
- usuários: 581, idêntico;
- empresas: 253, nenhuma criada; 30 com `updated_at` depois da foto, pelo uso normal do Plan;
- reuniões: 3.129 (eram 3.114). As 15 novas foram criadas entre 12/11 às 22:11 e 13/11 às 13:55 UTC, pelo uso normal do Meet e do Plan; nenhuma é sessão de kickoff e nenhuma é da organizadora;
- nenhuma reunião, empresa ou usuário foi gravado pela transação da migration (`xmin` diferente de `2411177` em todas as linhas). A `006` não escreve nessas tabelas.

**Para repetir a conferência:** a consulta pronta precisa de um usuário que execute `agenda_kickoff_zoom_sala_usada_no_plan` (SQL Editor). Pelo conector somente leitura, as linhas 5a e 5b falham com "permission denied"; rodar sem elas e conferir as salas de turmas lendo as tabelas, como acima.

### Cliente Zoom (`lib/zoom/api.ts`)

Adaptado do CS (Apêndice A), que veio do Plan; só o que a E1 usa:

- **Token:** Server-to-Server OAuth (`grant_type=account_credentials`, Basic `client_id:secret`). Guardado em memória até `expires_in` − 60 s e reaproveitado; pedidos simultâneos esperam a mesma renovação. Não há refresh token: vencido, pede outro. Pela documentação do Zoom, pedir um token novo não invalida os do Plan.
- **401** da API: descarta o token, renova e repete **uma** vez.
- **Prazo** de 15 s por chamada; rede caída ou prazo esgotado viram "o Zoom não respondeu".
- **429:** mensagem de limite, com o tempo de espera do `Retry-After` quando o Zoom informa. Os limites valem **por conta Zoom**, somados com o Plan.
- **Erros:** status e código do Zoom, separando falha do token (credenciais) de falha da API (reunião não encontrada, sem permissão). Nunca repassa o texto do Zoom, token ou segredo; nunca loga.
- **Um cliente por processo** no servidor (`lib/kickoff/zoomSalaServidor.ts`); trocar as credenciais descarta o cliente e o token.
- Regras da sala em `lib/kickoff/zoomSala.ts` (funções puras); rota `GET`/`POST /api/agenda/kickoffs/zoom` (`verificar`, `ativar`, `verificar_ativa`), só para quem gerencia kickoffs.

### Variáveis (servidor; só nomes)

| Variável | O que é |
|---|---|
| `ZOOM_ACCOUNT_ID` | Account ID do app Server-to-Server OAuth |
| `ZOOM_CLIENT_ID` | Client ID do app |
| `ZOOM_CLIENT_SECRET` | Client Secret do app |

- **App:** o Server-to-Server OAuth do Legacy Plan ("Legacy Plan - Zoom Integration"), como decidido no CS: os mesmos valores do Plan. **Regenerar o secret obriga a atualizar Plan e Meet juntos.**
- **Escopo usado na E1:** `meeting:read:meeting:admin`. Os da E2 são `meeting:write:registrant:admin`, `meeting:read:registrant:admin` e `meeting:read:list_registrants:admin`. Todos constam no token do app (conferido em 13/11/2026, seção "Conexão real com o Zoom").
- **Sem as três:** a tela mostra "Integração Zoom não configurada" com o nome do que falta, e nada é chamado. Os valores ficam só no servidor: nunca no navegador, em log ou neste documento.
- **Ambiente local:** o Meet local usa o mesmo banco de produção. Só configure as variáveis do Zoom no local para testar a verificação (só leitura); **ativar uma sala no local grava na tabela de produção**.

### Testar a conexão com o Zoom real (pede autorização antes)

Não foi feito nesta etapa. Quando autorizado: com as três variáveis no ambiente, abrir a seção e **verificar** a sala definitiva (só `GET`, sem ativar). Resultado esperado: "Configuração aprovada". A sala de teste do CS deve aparecer como recusada ("reunião de teste" e "turma do Plan").

### Conexão real com o Zoom (13/11/2026, só leitura)

Feita com autorização, no ambiente local, com o cliente da E1 e as credenciais do app do Plan. Foram duas chamadas, as duas com resposta 200: o token (`POST /oauth/token`) e a leitura da reunião de teste (`GET /meetings/88672328525`). Nada foi criado nem alterado no Zoom, e nada foi gravado no banco.

- **Autenticação:** funcionou (token `bearer`, validade de 3.600 s).
- **Reunião de teste:** tipo 8, recorrência semanal, inscrição obrigatória com aprovação automática (`approval_type` 0), inscrição única para todas as ocorrências (`registration_type` 1), sem exigir autenticação. O validador da E1 leu tudo corretamente e reprovou a sala só por ser a de teste (`sala_de_teste`), como esperado.
- **Escopos concedidos ao app** (lista devolvida pelo próprio token): `meeting:read:meeting:admin` (E1), `meeting:write:registrant:admin`, `meeting:read:registrant:admin` e `meeting:read:list_registrants:admin` (E2), `meeting:read:list_past_instances:admin`, `report:read:meeting:admin` e `report:read:list_meeting_participants:admin` (E3). **Não há escopo para cancelar ou alterar inscrições.**
- **A sala de teste continua em uso:** tem ocorrências semanais marcadas até 21/12/2026. Nunca usar no Impulsão.
- **Duração:** o Zoom não devolve `duration` no nível da reunião para o tipo 8, então o resumo guarda `duracaoMin` nulo. Não afeta a aprovação.

Os escopos da E2 estão concedidos, mas **nunca foram exercitados**: nenhuma chamada de inscrição (nem de leitura) foi feita ao Zoom real.

## Zoom E2: acesso individual

**Estado: código local, sem commit. A migration `007` foi aplicada em produção em 13/11/2026, manualmente pelo SQL Editor** (seção "Migration 007 aplicada"). Nenhuma inscrição real foi criada: os testes usam um Zoom simulado, e as tabelas estão vazias. Até o código ser publicado, com uma sala ativa e as variáveis do Zoom no servidor, ninguém usa o acesso. Num ambiente sem a `007`, tudo o que existia continua funcionando: a página da empresa mostra a reserva como na M3 e o painel avisa "Acesso Zoom pendente".

Baseado no Legacy CS ([guia técnico](referencia-cs/kickoff-cs-guia-tecnico.md), seção 7 e Apêndices C e D), que por sua vez reaproveita as regras do Legacy Plan para o código da empresa e o nome no Zoom.

### Reserva x inscrição Zoom

| | Reserva (M2) | Inscrição Zoom (E2) |
|---|---|---|
| O que é | A empresa numa **sessão** (data, horário, anfitrião) | Um **e-mail** na **sala** Zoom, que é a mesma para todas as sessões |
| Chave | Empresa (`client_tenants.id`) + sessão | Sala + e-mail |
| Onde vive | `agenda_kickoff_reservas` | `agenda_kickoff_zoom_inscricoes` |
| Quem decide o horário | A reserva | Ninguém: a inscrição não tem data, horário nem anfitrião |
| Se o Zoom falhar | Continua valendo | Fica pendente e pode ser gerada depois |

A inscrição nunca substitui a reserva. É a reserva ativa que diz se a empresa pode entrar e em qual sessão.

### Como funcionam as inscrições

Cada inscrição liga: a sala (e o Meeting ID), o e-mail do participante, a empresa (`tenant_id`), o código da empresa, a primeira e a última reserva atendidas, o id do registrante no Zoom, o nome que o Zoom guardou, o estado (`criando`, `pronta`, `erro`, `conflito`) e o **link individual de entrada**.

- **Nome no Zoom:** `Nome do participante | Empresa #CÓDIGO` (ex.: `Maria Silva | Padaria Pão Bom #1A2B3C4D`). O limite do Zoom é de 64 caracteres por campo: o código nunca é cortado; o sobrenome cede primeiro.
- **Código da empresa:** os 8 primeiros hexadecimais de `client_tenants.id`, em maiúsculas. É a mesma regra do Plan e do CS (um prefixo do id, não um hash). Sai do cadastro, no servidor; o navegador nunca informa. Conferido em 13/11/2026 (só leitura): as 254 empresas têm códigos diferentes entre si.
- **Só reserva ativa tem acesso.** Cancelada, ausente, interrompida e concluída não geram inscrição e não recebem o link.
- **Link individual (`join_url`):** é credencial. Fica só na tabela, lida só pelo servidor. Nenhuma tela e nenhuma resposta JSON o recebe; ele só sai no encaminhamento final, depois do clique em "Entrar na reunião".

### Quando o Zoom é chamado

Só nestes quatro momentos:

1. a empresa acabou de confirmar a reserva pelo link do convite (a reserva já está gravada);
2. a empresa clicou em "Tentar de novo" na página dela (a página também tenta sozinha 3 vezes, a cada 6 segundos, enquanto o acesso está "preparando");
3. a empresa clicou em **Entrar na reunião** dentro do horário da sessão;
4. a equipe clicou em **Gerar acesso Zoom** (ou "Tentar de novo o acesso") na linha da reserva.

Abrir o calendário público, a página do convite, a página da reunião ou a seção Kickoffs Impulsão **nunca** chama o Zoom: qualquer `GET` só lê o banco. Reserva feita pela equipe não gera acesso sozinha: é o clique do item 4 (ou o clique da empresa, item 3).

### Idempotência e pedidos simultâneos

Antes de qualquer chamada ao Zoom, o banco decide (`agenda_kickoff_zoom_inscricao_decidir`), com trava por sala + e-mail:

| Situação | O que acontece |
|---|---|
| Não há inscrição | Cria a linha em `criando` e só então o servidor fala com o Zoom |
| Inscrição pronta da mesma empresa | Reaproveita, sem chamar o Zoom (a cada 6 horas confere se ela ainda existe lá) |
| Outro pedido está criando agora (menos de 2 minutos) | "Preparando": este pedido não chama o Zoom |
| Criação interrompida há mais de 2 minutos (servidor caiu) | Retomada pelo próximo pedido |
| Falhou há menos de 15 segundos | O pedido comum espera; a equipe pode tentar de novo na hora |
| O mesmo e-mail já é de **outra empresa** nesta sala | Conflito, sem chamar o Zoom. O link de uma empresa nunca vai para outra |
| O Zoom respondeu de forma ambígua ao inscrever (erro 4xx comum) | O servidor procura a inscrição pelo e-mail na lista do Zoom e aproveita |
| O Zoom já tinha o e-mail com o código de outra empresa (inscrição feita por fora) | Conflito: o link **não é guardado** |
| O link devolvido não é `https://…zoom.us` | Erro: nunca é guardado nem usado |

Cada pedido, resultado e substituição fica em `agenda_kickoff_zoom_inscricoes_historico`. Inscrição e histórico não se apagam.

### Endereço da reunião: `/impulsao/reuniao/<código>`

É o endereço que a empresa usa para entrar: uma **página de entrada**, com o botão **Entrar na reunião**. O código é o **mesmo do convite**.

**Abrir a página não faz nada além de mostrar.** O `GET` não consulta o banco no servidor, não chama o Zoom, não cria inscrição e não encaminha a lugar nenhum; o HTML não traz dado da empresa nem link de reunião. Isso vale para pré-visualizações de link (WhatsApp, e-mail), pré-carga do navegador e verificadores de segurança, que só fazem `GET`. No navegador, a página lê a reserva pela mesma rota pública do agendamento (`GET /api/impulsao/convites/<código>`, só banco).

**O que a página mostra:**

| Situação | Tela |
|---|---|
| Reserva ativa, dentro do horário | Empresa, data, horário, quem conduz, participante e o botão **Entrar na reunião** |
| Reserva ativa, ainda cedo | A apresentação e "Ainda é cedo: a entrada abre a partir de …" (30 minutos antes) |
| Reserva ativa, depois do horário | "Esta sessão já terminou" |
| Acesso indisponível (sem sala, conflito, sala com problema) ou migration `007` ausente | "O acesso será enviado pelo time da Legacy" |
| Sem reserva | "Nenhum kickoff marcado", com o atalho para agendar |
| Kickoff concluído | "Kickoff concluído" |
| Código inválido, revogado, expirado sem reserva, tentativas demais | O mesmo aviso do agendamento, sem nenhum dado |

O botão aparece e some sozinho conforme o horário. Com o acesso ainda "preparando", o botão aparece do mesmo jeito: a inscrição é criada no clique.

**O que o clique faz (duas etapas, as duas `POST`):**

1. **Passe:** `POST /api/impulsao/convites/<código>/entrada`. O servidor confere, só no banco, o convite, a reserva ativa e o horário, e devolve um **passe de 2 minutos** (HMAC do código com `KICKOFF_ORIGEM_SECRET`, sem estado no servidor). Não chama o Zoom e não devolve link.
2. **Entrada:** o navegador envia o formulário para `POST /impulsao/reuniao/<código>/entrar` com o passe. O servidor confere, nesta ordem:
   - o formato do código;
   - que o pedido veio de uma página da própria aplicação (`Sec-Fetch-Site: same-origin`; `Origin`, quando vem com endereço, tem de ser o nosso);
   - o passe (deste convite, dentro da validade);
   - **tudo de novo, no banco:** convite com as regras da M3 (código errado ou revogado conta tentativa da origem; **expirado com reserva ativa vale**; revogado não), o limite de 30 pedidos por convite em 15 minutos, a reserva **ativa** da empresa do convite, a janela **de 30 minutos antes do início até 30 minutos depois do fim da sessão daquela reserva**, e a inscrição na sala ativa (reaproveita ou cria);
   - só então responde `303` com o link individual no cabeçalho `Location`, sem cache e sem referrer, e conta o acesso.

Qualquer recusa na entrada volta para a página (`?retorno=…`), que relê a situação e explica. A rota de entrada **não tem `GET`**.

| Recusa na entrada | Resposta |
|---|---|
| Passe ausente, adulterado, vencido ou de outro convite | Volta à página: "Clique em Entrar na reunião de novo" (sem ir ao banco) |
| Formulário enviado por outro site | 403, sem ir ao banco nem ao Zoom |
| Fora do horário, sem reserva ativa, acesso sendo criado por outro pedido, conflito, sem sala, Zoom com falha | Volta à página, sem link |
| Convite inválido, revogado, expirado sem reserva, tentativas demais | Volta à página, que mostra o aviso |

**Por que o passe e a conferência de origem (e o que eles não fazem):**

- Trocar `GET` por `POST` evita o acionamento por quem só abre o endereço, mas não basta: outro site poderia enviar um formulário `POST` para a rota. A conferência de origem recusa isso nos navegadores atuais, e o passe recusa em qualquer navegador, porque outro site não consegue ler a resposta que o traz.
- As páginas usam a política `no-referrer` (o endereço com o código não vaza para o Zoom). Com ela, o navegador envia `Origin: null` no formulário; por isso `Origin` vazio não reprova, e o passe é obrigatório.
- O passe **não é credencial**: não substitui convite, reserva nem horário, que são conferidos de novo. Dois minutos bastam porque ele é emitido no clique.
- **O que isso não resolve:** quem tem o código do convite pode abrir a página e clicar. O código continua sendo a credencial da empresa (reemitir o convite invalida o anterior).

O link do Zoom aparece para o navegador da empresa **só no encaminhamento final**, depois do clique, e ela pode guardá-lo. A proteção é não entregar antes da hora, não entregar sem um gesto na página e não entregar a quem não tem reserva ativa (veja "Limitações do Meeting ID compartilhado").

### O que a empresa vê

Na confirmação do agendamento (e sempre que reabrir o link do convite):

| Estado | Tela |
|---|---|
| Pronto | "Como entrar na reunião": o endereço da Legacy (a página de entrada), botão de copiar e, dentro do horário, o mesmo botão "Entrar na reunião". Antes disso, o horário em que a entrada abre |
| Preparando | "Seu agendamento está confirmado. Estamos preparando o seu acesso…", com novas tentativas automáticas e depois o botão "Tentar de novo" |
| Indisponível | "O acesso à reunião será enviado pelo time da Legacy" (sem sala ativa, conflito, sala com problema) |

Erro, conflito e problema de sala nunca são detalhados para a empresa. A reserva aparece confirmada em todos os casos.

### O que a equipe vê (seção Kickoffs Impulsão)

Em cada reserva ativa, abaixo do estado:

| Estado | Significado | O que fazer |
|---|---|---|
| Acesso Zoom pronto | Há inscrição pronta na sala atual | **Endereço da reunião** copia o endereço da Legacy para enviar |
| Acesso Zoom ainda não gerado | Reserva feita pela equipe, e-mail trocado, ou sala trocada | **Gerar acesso Zoom** |
| Preparando o acesso Zoom | Um pedido está em andamento | Atualizar em instantes |
| Falha ao gerar o acesso Zoom | A última tentativa falhou (o motivo aparece) | **Tentar de novo o acesso** |
| Conflito no Zoom | O e-mail já é de outra empresa nesta sala | Corrigir o e-mail do participante e gerar de novo |
| Sem sala Zoom ativa | Não há sala | Ativar a sala no quadro "Sala Zoom" |

- O painel **nunca mostra o link individual do Zoom**, só o endereço da Legacy.
- **Gerar acesso** também cria o convite da empresa, se ela ainda não tiver (é dele que sai o endereço). Sem `KICKOFF_PUBLIC_BASE_URL`, o acesso é gerado, mas o endereço não é montado e o motivo aparece.
- Avisos no alto da seção: migration `007` pendente; integração sem credenciais; sem sala ativa; quantas reservas ativas estão sem acesso pronto.

### Como recuperar uma inscrição

- **A empresa:** "Tentar de novo" na página do agendamento, ou o botão **Entrar na reunião** no horário (o acesso é gerado no clique, se faltar).
- **A equipe:** **Gerar acesso Zoom** ou **Tentar de novo o acesso** na linha da reserva. Uma inscrição pronta não é refeita por esse botão.
- **Inscrição que sumiu do Zoom** (apagada por lá): na conferência seguinte (a cada 6 horas, quando o acesso é pedido), o Meet cria outra sozinho.
- Em nenhum caso a empresa precisa fazer outra reserva.

### Como substituir um participante

Pelo lápis da reserva (como na M2). A reserva nunca é invalidada por isso.

| Mudança | Efeito no Zoom |
|---|---|
| **Só o nome** | A inscrição continua a mesma. **O Zoom não altera o nome de uma inscrição existente**, e o app não tem escopo para cancelar inscrições; o painel avisa: "No Zoom o nome continua …". O código da empresa no nome não muda |
| **O e-mail** | É outra chave: o acesso fica "ainda não gerado" até a equipe clicar em **Gerar acesso Zoom** (ou a empresa clicar em Entrar no horário). A inscrição antiga fica no histórico como **substituída** e nunca mais é entregue por aquela reserva |

Para trocar de pessoa de verdade (outro nome no Zoom), troque também o e-mail.

**Limitação:** a inscrição do e-mail antigo **continua existindo no Zoom** e o link dela continua funcionando para quem o tiver. O Meet só deixa de entregá-la.

### Cancelamento, reagendamento e conclusão

| Evento | Acesso |
|---|---|
| Reserva cancelada | Deixa de ser entregue na hora; a inscrição fica guardada como histórico |
| Não compareceu | Sem acesso até reagendar |
| Participou e não concluiu | Sem acesso até reagendar |
| Reagendada (mesma empresa, mesmo e-mail) | A reserva nova **reaproveita a mesma inscrição**; o endereço passa a abrir no horário da sessão nova |
| Remanejada | A mesma inscrição; só muda o horário em que o endereço abre |
| Kickoff concluído | Sem acesso; o endereço leva à página "Kickoff concluído" |

### Como trocar a sala

Como na E1 (quadro "Sala Zoom", com motivo). Para as inscrições:

- **Nada é migrado sozinho.** As inscrições da sala anterior ficam guardadas, ligadas ao Meeting ID antigo.
- As reservas ativas passam a "Acesso Zoom ainda não gerado", com a nota "O acesso era da sala Zoom anterior". O aviso no alto mostra quantas são.
- Cada reserva recebe o acesso da sala nova quando a equipe clica em **Gerar acesso Zoom** ou quando a empresa clica em **Entrar na reunião** no horário.
- O **endereço da Legacy não muda** (é o do convite): quem já o recebeu continua usando o mesmo.
- O link individual da sala antiga continua funcionando **no Zoom**, apontando para a sala antiga. O Meet não o entrega mais.
- Voltar para uma sala usada antes reaproveita as inscrições que já existiam nela.

### Tratamento de falhas

| Falha | Reserva | Acesso | Mensagem para a equipe |
|---|---|---|---|
| Zoom fora do ar, lento (mais de 15 s) ou com limite de chamadas | Mantida | "Falha", recuperável | "Não foi possível falar com o Zoom agora" / "limitou as chamadas" / "instabilidade" |
| Credenciais recusadas ou sem escopo | Mantida | "Falha" | "O Zoom recusou as credenciais" / "sem permissão para inscrever" |
| Sala apagada ou reconfigurada no Zoom (ex.: aprovação manual) | Mantida | "Falha" | "A sala Zoom deixou de aceitar inscrições: …" |
| Sala ativa reprovada na última verificação | Mantida | Não cria inscrição nova; as prontas continuam valendo | "A sala Zoom ativa está com problemas" |
| Credenciais do Zoom ausentes no servidor | Mantida | Nada é reservado no banco | "Integração Zoom não configurada" |
| Migration `007` ausente | Mantida | Página e painel seguem sem o acesso | "Acesso Zoom pendente" |

- **Nunca** vai para tela, resposta ou log: o texto de erro do Zoom, token, credenciais, senha da reunião ou link individual.
- Ao confirmar o agendamento, o servidor espera o Zoom por até 8 segundos. Passando disso, responde "preparando" e o pedido continua no servidor.
- Conferência periódica com o Zoom fora do ar: o link guardado continua sendo entregue.

### Limitações do Meeting ID compartilhado

Todas as sessões usam a mesma reunião recorrente, com inscrição única para todas as ocorrências. Consequências:

- **O link individual não fica preso a uma ocorrência.** Depois que o Meet encaminha a empresa uma vez, ela tem o link do Zoom (no histórico do navegador, por exemplo) e ele abre a reunião em qualquer horário em que o anfitrião a iniciar. O Zoom não oferece trava por ocorrência nesse modo de inscrição, e o app não tem escopo para cancelar inscrições (decisão desta etapa: não criar essa integração). **O Meet não garante, e não afirma, que um link já entregue deixa de valer em outras ocorrências da sala.**
- **O que o Meet garante:** só entrega o link depois de um clique na página de entrada; não entrega antes de 30 minutos do início da sessão da reserva, nem depois de 30 minutos do fim; não entrega a quem não tem reserva ativa; não entrega com convite revogado; não entrega o link de outra empresa; abrir ou pré-visualizar o endereço não entrega nada.
- **Mitigação operacional (a menor compatível com o modelo):**
  - o anfitrião só inicia a reunião nos horários das sessões;
  - quem entrar numa sessão sem reserva nela aparece com o nome e o código da empresa (`#CÓDIGO`): o anfitrião reconhece e pode remover;
  - a E3 deve marcar esses casos como "presente sem reserva nesta sessão";
  - se for preciso invalidar todos os links de uma vez, trocar a sala.
- Duas sessões não podem acontecer ao mesmo tempo na mesma sala.
- Só o participante principal tem link individual. Outros representantes da empresa usam o mesmo endereço (entram com o mesmo nome) ou são admitidos pelo anfitrião.

### Modelo (migration 007)

| Objeto | O que é |
|---|---|
| `agenda_kickoff_zoom_inscricoes` | A inscrição: sala, Meeting ID, e-mail, empresa, código, primeira e última reserva, nome pedido, estado, id do registrante, **link individual**, nome que o Zoom guardou, tentativas, último erro, quem pediu, conferência, quantas vezes o link foi entregue, substituição. Chave: sala + e-mail. Não se apaga; não troca de sala, e-mail nem empresa |
| `agenda_kickoff_zoom_inscricoes_historico` | `solicitada`, `refeita`, `pronta`, `erro`, `conflito`, `substituida`, com reserva, detalhe, usuário e horário. Não muda nem se apaga |
| `agenda_kickoff_zoom_inscricao_decidir(reserva, modo, usuário)` | Antes do Zoom: reaproveitar, criar, esperar ou recusar. Com usuário, confere a permissão de kickoff. É a única função que devolve o link, e só ao servidor |
| `agenda_kickoff_zoom_inscricao_concluir(...)` | Grava o resultado; só conclui quem está em `criando`; recusa link que não seja `https` |
| `agenda_kickoff_zoom_inscricao_verificada(id)` / `..._entregue(id)` | Marca a conferência no Zoom / conta uma entrega do link |
| `agenda_kickoff_zoom_reserva_do_convite(código, origem, contar)` | Convite → reserva ativa, horário da sessão e estado do acesso, com o limite de tentativas da M3 |
| `agenda_kickoff_zoom_acessos(reservas[])` | Estado do acesso das reservas para o painel. **Sem link** |

- **Acesso:** RLS ligado, sem policies; tabelas e funções só para `service_role`. `anon`, `authenticated` e `PUBLIC` não leem nem executam nada (testado).
- **Aditiva:** não altera nenhuma tabela nem função existente, do Meet ou do Plan. Lê `client_tenants`, `meetings`, as reservas, os convites e a sala. As chaves para reservas, sala e empresa são `on delete restrict`.
- Depende de `001`, `003`, `004`, `005` e `006`. **Aplicada; não reaplicar nenhuma delas.**

### Migration 007 aplicada (13/11/2026)

Aplicada **manualmente pelo SQL Editor do Supabase**, pelo responsável pelo projeto, em 13/11/2026. Arquivo validado: `integracoes/kickoff/007_kickoff_zoom_inscricoes.sql`, SHA-256 `338b8a93aa464ae6…`. A aplicação foi uma transação só (`2415099`): as 2 tabelas, as 8 funções e os 4 gatilhos nasceram nela.

**Por ser manual, a `007` não aparece no histórico automático de migrations** (`supabase_migrations.schema_migrations`), como a `003`, a `004`, a `005` e a `006`: a última registrada continua sendo `comunidade_ponte_sem_kickoff`. A prova do que foi aplicado é a conferência abaixo. O cabeçalho do arquivo ainda diz "NÃO APLICADA": o texto foi mantido, porque é o conteúdo exato que foi aplicado.

**Conferido depois** (só leitura, 13/11/2026 às 23:47 UTC, pelo conector do Supabase em modo somente leitura; nenhuma função foi executada e o Zoom não foi chamado):

- **`agenda_kickoff_zoom_inscricoes`:** 29 colunas, com os tipos, obrigatoriedades e padrões do arquivo.
  - Chave primária e **`unique (sala_id, email)`**: uma inscrição por e-mail em cada sala.
  - 5 chaves estrangeiras, todas `on delete restrict`: sala, empresa (`client_tenants`), primeira reserva, última reserva e a inscrição que a substituiu.
  - 11 checks: formato do Meeting ID, do e-mail (minúsculo, até 254) e do código da empresa (`^[0-9A-F]{8}$`); os 4 estados; link só `https://` e até 2.000 caracteres; id do registrante até 200; erro até 300; tentativas e acessos não negativos; `pronta` exige registrante e link; `criando` se e só se houver `reivindicada_em`.
  - Índices: o da chave, o de sala + e-mail, o único parcial `(sala_id, zoom_registrant_id) where zoom_registrant_id is not null`, o de empresa e o da última reserva.
- **`agenda_kickoff_zoom_inscricoes_historico`:** 7 colunas; chave primária; chaves para a inscrição e para a reserva (`on delete restrict`); checks das 6 ações e do detalhe (até 300); índice por inscrição e data.
- **Gatilhos (4, todos ativos):** `agenda_kickoff_zoom_inscricoes_guarda` (antes de inserir, alterar e apagar, por linha), `agenda_kickoff_zoom_inscricoes_sem_truncate`, `agenda_kickoff_zoom_inscricoes_historico_imutavel` (antes de alterar e apagar) e `agenda_kickoff_zoom_inscricoes_historico_sem_truncate`.
- **Acesso:** RLS ligado nas duas tabelas, sem policies. `anon` e `authenticated` sem nenhum privilégio (leitura, escrita, truncate, references, trigger). As permissões gravadas são só de `postgres` (dono) e `service_role`.
- **As 8 funções da `007`:** uma versão de cada, com a assinatura e o retorno do arquivo e o **corpo idêntico ao arquivo** (md5 do corpo normalizado, uma a uma). Todas de `postgres`, `SECURITY DEFINER`, com `search_path` vazio. `anon`, `authenticated` e `PUBLIC` não executam nenhuma; `service_role` executa todas. Não há nenhuma outra função `agenda_kickoff*` no banco além das 54 conhecidas.
- **Unicidade e conflito entre empresas:** a chave `unique (sala_id, email)` está no banco, e `agenda_kickoff_zoom_inscricao_decidir` (idêntica ao arquivo) devolve "conflito" quando a inscrição daquele e-mail na sala é de outra empresa, sem reaproveitar. O gatilho de guarda (idêntico ao arquivo) impede trocar sala, e-mail ou empresa de uma inscrição. Conferido pela definição e pelos testes isolados (PGlite e PostgreSQL real com conexões simultâneas). **Sem teste com dados reais, por decisão.**
- **M1, M2, M3 e Zoom E1 preservadas:**
  - as 46 funções de `001`, `003`, `004`, `005` e `006` continuam com o corpo idêntico aos arquivos, uma versão de cada, nenhuma tocada pela transação da `007`;
  - as tabelas `agenda_kickoff_sessoes`, `agenda_kickoff_reservas` (26 colunas), `agenda_kickoff_reservas_historico` (9), `agenda_kickoff_convites` (9), `agenda_kickoff_limite_publico` (3), `agenda_kickoff_zoom_salas` (16) e `agenda_kickoff_zoom_salas_historico` (8) não foram alteradas: nenhuma coluna, restrição ou gatilho de regra criado nelas pela `007`, e os gatilhos de cada uma continuam ativos;
  - `meetings`, `client_tenants`, `users` e `meet_user_profile` também não: os três gatilhos de `meetings` (`agenda_kickoff_reuniao_protegida`, `meetings_updated_at_trigger`, `trg_guard_writable`) e os cinco de `client_tenants` continuam os mesmos. As chaves novas que apontam para reservas, sala e empresa pertencem às tabelas da `007`.
- **Dados:** 0 inscrições e 0 linhas de histórico de inscrições. Nenhuma inscrição real foi criada.

**Dados** (conferência da `006`, 13/11/2026 às 13:56 UTC, x conferência da `007`, às 23:47 UTC):

- sessões de kickoff, reservas, histórico de reservas, convites, tentativas públicas, salas e histórico de salas: 0, idênticos;
- reuniões: 3.138 (eram 3.129). As 9 novas foram criadas pelo uso normal do Meet e do Plan; nenhuma é sessão de kickoff e nenhuma é da organizadora;
- empresas: 255 (eram 253; 2 criadas pelo uso normal do Plan); usuários: 583 (eram 581);
- nenhuma reunião, empresa, usuário ou perfil do Meet foi gravado pela transação da migration (`xmin` diferente de `2415099` em todas as linhas). A `007` não escreve nessas tabelas.

**Observação sobre o conector de leitura:** o usuário do conector do Supabase (`supabase_read_only_user`) lê todas as tabelas do projeto, inclusive `agenda_kickoff_zoom_inscricoes`. Hoje ela está vazia; quando houver inscrições, o link individual estará ao alcance de quem usar esse conector. Não é um papel do aplicativo (o navegador continua sem acesso), mas consultas por ele não devem selecionar `join_url`.

### Rotas

| Rota | Login | O que faz |
|---|---|---|
| `GET /impulsao/reuniao/[codigo]` | Não | Página de entrada (apresentação da reunião e botão). Só mostra: não inscreve nem encaminha |
| `POST /api/impulsao/convites/[codigo]/entrada` | Não | Clique no botão, etapa 1: confere convite, reserva e horário (só banco) e devolve o passe de 2 minutos |
| `POST /impulsao/reuniao/[codigo]/entrar` | Não | Clique no botão, etapa 2: confere origem, passe e tudo de novo; encaminha (`303`) ao Zoom. Única rota que entrega o link |
| `POST /api/impulsao/convites/[codigo]/acesso` | Não | "Tentar de novo": garante a inscrição e devolve o estado e o endereço da Legacy |
| `GET /api/impulsao/convites/[codigo]` | Não | Como na M3, mais o campo `acesso` quando há reserva (só leitura do banco) |
| `POST /api/impulsao/convites/[codigo]/agendar` | Não | Como na M3; depois de gravar a reserva, garante a inscrição e devolve `acesso` |
| `POST /api/agenda/kickoffs/reservas/[id]` com `{acao: 'gerarAcesso'}` | Sim (gestor) | Gera ou recupera o acesso da reserva e o endereço da Legacy |
| `GET /api/agenda/kickoffs` | Sim (gestor) | Como antes, mais `zoom` (estrutura, integração, sala) e `acesso` em cada reserva ativa |

Código: `lib/zoom/api.ts` (cliente, com as três operações de inscrição), `lib/kickoff/zoomInscricao.ts` (identidade no Zoom e orquestração, sem rede nem banco), `lib/kickoff/zoomAcessoRegras.ts` (estados e janela de horário, usados pelas telas; não importa o cliente Zoom), `lib/kickoff/zoomAcesso.ts` (servidor), `lib/kickoff/entradaToken.ts` (passe e conferência de origem), `components/impulsao/EntradaNaReuniao.tsx` e `BotaoEntrarNaReuniao.tsx` (página de entrada), `components/impulsao/AcessoDaReuniao.tsx` e `components/agenda-nova/kickoffs/AcessoZoomReserva.tsx` (telas).

### Cuidados para a E3 (presença automática)

- **Quem é quem:** o participante aparece no Zoom com `#CÓDIGO` no nome; o código leva à empresa (`codigo_empresa` da inscrição, 8 primeiros hexadecimais do `tenant_id`). Não identificar por nome, CNPJ ou e-mail.
- **Código repetido:** o prefixo de 8 hexadecimais não tem garantia de ser único. Hoje não há repetição (254 empresas, conferido em 13/11/2026). A E3 deve tratar dois `tenant_id` com o mesmo código na mesma sala como caso para revisão manual.
- **Inscrições que o Meet não entrega mais continuam válidas no Zoom:** reserva cancelada, e-mail trocado (inscrição substituída) e sala antiga. A E3 precisa cruzar o participante com a **reserva ativa da sessão**, e não só com a existência da inscrição.
- **Sessão:** a mesma sala serve todas as sessões. A E3 identifica cada execução pelo UUID da instância e pelo horário, e compara com a sessão da reserva.
- **Nome antigo:** depois de uma correção só de nome, o Zoom mantém o nome anterior; o código da empresa continua certo.
- **Entradas sem inscrição do Meet:** inscrições feitas por fora, ou com o código de outra empresa, ficam como conflito no Meet e devem ser tratadas como desconhecidas.
- Segue pendente e sem validação com dados reais: várias execuções da mesma sala no mesmo dia, e o comportamento depois da última ocorrência.

### Antes de usar de verdade

1. **Feito em 13/11/2026:** `007` aplicada e conferida por leitura. Os passos 2 a 4 não foram feitos.
2. Criar a sala exclusiva do Impulsão no Zoom, verificar e ativar (E1).
3. Definir as três variáveis do Zoom no servidor.
4. **Primeira inscrição real:** fazer com uma reserva de teste controlada, porque os escopos de escrita nunca foram exercitados e o comportamento do Zoom ao inscrever um e-mail já inscrito foi tirado da documentação e do CS, não de um teste real aqui.

## Instalação

1. **Feito em 12/11/2026:** migration `integracoes/kickoff/001_kickoff_m1.sql` aplicada no projeto `eddfdgefrwjxfafkkzls` (histórico `20261112155101`, nome `kickoff_m1_sessoes_e_permissao`).
   - **Conferido depois:**
     - `meet_user_profile.capacidades` criada, com a restrição, e os 33 perfis vazios;
     - `agenda_kickoff_sessoes` criada vazia, com RLS ligado, sem policies e acessível só a `service_role`;
     - `agenda_do_cliente()` com a nova versão e mesmo dono, segurança e permissões;
     - `jornadas_do_cliente()` e `agenda_tenant_do_usuario()` sem mudança;
     - quatro logins reais de clientes recebem exatamente o mesmo resultado de antes (contagem e hash).
   - O cabeçalho do arquivo ainda diz "NÃO APLICADA": o texto foi mantido como estava, porque é o conteúdo exato que foi aplicado.
2. **Feito em 12/11/2026:** empresa "Customer Success" criada (`f7249ca9-78cb-49f7-9621-e81f871527a3`), pelo [procedimento-customer-success.md](procedimento-customer-success.md). Conferências na seção "Empresa organizadora".
3. **Feito em 12/11/2026:** `integracoes/kickoff/002_comunidade_ponte_sem_kickoff.sql` aplicada. A `comunidade_ponte` não manda mais as sessões de kickoff ao Hub (seção acima).
4. **Parcial:** `MEET_KICKOFF_TENANT_ID` definida só no ambiente local. **Pendente no servidor de produção** (seção "Configuração").
5. **Pendente:** conceder a permissão a quem vai operar. O responsável por Customer Success já foi identificado no Meet (perfil da equipe, ainda sem a permissão). Até 12/11/2026, nenhum perfil tem `kickoff_impulsao.manage`; os admins do Meet já gerenciam kickoffs por serem admins.

6. **Feito em 12/11/2026:** `integracoes/kickoff/003_kickoff_reservas.sql` aplicada pelo SQL Editor (sem registro em `schema_migrations`; conferências em "Migrations aplicadas").
7. **Feito em 12/11/2026:** `integracoes/kickoff/004_kickoff_reuniao_protegida.sql` aplicada pelo SQL Editor, com autorização específica para o gatilho em `public.meetings` (mesmas observações).
8. **Feito em 12/11/2026:** `integracoes/kickoff/005_kickoff_convites.sql` aplicada pelo SQL Editor (sem registro em `schema_migrations`; conferências em "Migration 005 aplicada").
9. **Obrigatório antes de publicar a M3** (variáveis do servidor de produção):
   - `KICKOFF_PUBLIC_BASE_URL`: endereço oficial `https` dos links (sem ela, não se gera convite);
   - `KICKOFF_ORIGEM_SECRET`: chave aleatória de 32+ caracteres, só desta função (sem ela, as rotas públicas ficam fechadas em produção);
   - `MEET_KICKOFF_TENANT_ID` (passo 4);
   - `KICKOFF_IP_CABECALHO` e `KICKOFF_PROXIES_CONFIAVEIS` só se o deploy deixar de usar a Cloudflare.
10. **Recomendado antes de publicar a M3 (fora do Meet):** garantir que o servidor só aceita tráfego da Cloudflare e testar um pedido direto ao IP do servidor (seção "IP do visitante").
11. **Feito em 13/11/2026:** `integracoes/kickoff/006_kickoff_zoom_sala.sql` aplicada pelo SQL Editor (sem registro no histórico automático de migrations; conferências em "Migration 006 aplicada").
12. **Antes de publicar a E1:** definir `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID` e `ZOOM_CLIENT_SECRET` no servidor (mesmos valores do app do Plan); criar a sala exclusiva do Impulsão no Zoom; com autorização, verificar e ativar na seção. Em 13/11/2026 as três variáveis foram definidas **só no ambiente local**, para a validação de leitura (seção "Conexão real com o Zoom").
13. **Feito em 13/11/2026:** `integracoes/kickoff/007_kickoff_zoom_inscricoes.sql` aplicada pelo SQL Editor (sem registro no histórico automático de migrations; conferências em "Migration 007 aplicada").
14. **Antes de publicar a E2:** os passos 9 e 12 (os endereços da reunião usam `KICKOFF_PUBLIC_BASE_URL`, e as rotas públicas usam `KICKOFF_ORIGEM_SECRET`); uma sala ativa; e a primeira inscrição real feita com uma reserva de teste controlada (seção "Antes de usar de verdade").

Enquanto o passo 4 não for feito no servidor, nenhuma sessão de kickoff pode ser criada em produção: a criação é recusada, com mensagem clara. Até 12/11/2026, nenhuma sessão, reserva ou convite foi criado. O código da M2 e da M3 também ainda não foi publicado (sem commit).

## Testes

- `lib/kickoff/migracao.test.ts`: a migration num Postgres em memória (PGlite), sobre as migrations reais da agenda.
- `lib/kickoff/agendaDoCliente.test.ts`: a nova `agenda_do_cliente()` devolve exatamente o mesmo que a atual (todas as colunas, todos os tipos de login e de reunião). Só a sessão de kickoff sai, e só para quem a via. Assinatura, dono, segurança e permissões não mudam.
- `lib/kickoff/regras.test.ts`, `lib/kickoff/agenda.test.ts`, `lib/meetingsCore.test.ts`.
- `app/api/agenda/eventos/route.test.ts`, `app/api/agenda/eventos/[id]/route.test.ts`, `app/api/agenda/kickoffs/route.test.ts`, `app/api/meetings/start/route.test.ts`, `app/api/admin/users/route.test.ts`.
- `app/agenda/page.test.tsx`, `app/agenda/kickoffs/page.test.tsx`.

Reservas (M2):

- `lib/kickoff/reservas.test.ts`: as migrations reais (`001`, `003`, `004`) num Postgres em memória (PGlite). Cobre:
  - cinco empresas entram e a sexta é recusada;
  - mesma empresa duas vezes; empresa organizadora;
  - sessões passada, cancelada e bloqueada;
  - e-mail obrigatório na função e na tabela;
  - cancelar libera a vaga; remanejar mantém o id e grava o histórico;
  - capacidade abaixo das inscritas;
  - quem não gerencia não faz nada; `anon` e `authenticated` sem acesso;
  - sessão com reservas não muda nem se apaga; cancelar com as reservas;
  - reuniões comuns sem mudança.
- `lib/kickoff/reservasConcorrencia.test.ts`: **concorrência real**, com várias conexões ao mesmo tempo num Postgres descartável. Pulado sem `KICKOFF_PG_URL` (só aceita `localhost`; cria e apaga um banco próprio). Cobre: 12 empresas numa sessão de 5 (pela função e por escrita direta); mesma empresa em duas sessões; reduzir a capacidade durante reservas; mover a sessão durante uma reserva; **concluir o kickoff enquanto outra conexão tenta cancelar e reservar de novo, e uma terceira insere direto** (sempre sobra uma só reserva viva da empresa: a concluída ou a nova).
  - Em 12/11/2026 rodou contra um PostgreSQL 18.3 local descartável: 6 de 6, três vezes seguidas.
  - Controle feito à parte: sem a trava da sessão, a mesma corrida aceitou 12 empresas numa sessão de 5.
- `lib/kickoff/convites.test.ts` (M3, PGlite, migrations reais até a `005`): gerar (código de 12 caracteres, reaproveita o em vigor, validade de 90 dias), reemitir e revogar (o antigo para de abrir); organizadora, empresa concluída e inexistente sem convite; quem não gerencia não mexe; convite não se apaga nem muda; página só com o nome da empresa e sessões abertas, futuras e com vaga (fora passada, cancelada, bloqueada e reunião comum); **nenhum id da empresa, do convite ou e-mail na resposta**; código inválido, revogado e expirado; **expirado com reserva só consulta (não agenda, nem em outra sessão), expirado de empresa que concluiu mostra "concluída", expirado sem reserva conta tentativa até bloquear, revogado bloqueia mesmo com reserva, válido não vem como expirado; foto do anfitrião só do bucket público `avatars`**; agendamento pela regra da M2, com `convite_id` e histórico; pedido repetido não duplica; o convite só agenda a própria empresa; empresa concluída; sessão lotada, bloqueada, passada, cancelada, inexistente ou que não é kickoff; participante validado no banco; reagendamento depois de ausência; **10 tentativas erradas bloqueiam a origem, inclusive para o código certo**; 10 pedidos por convite; `anon`/`authenticated` sem acesso; reuniões comuns sem mudança.
- `lib/kickoff/reservasConcorrencia.test.ts` também cobre a M3: seis empresas pelo link, ao mesmo tempo, na última vaga: só uma leva (Postgres real).
- `app/api/impulsao/convites/route.test.ts` (rotas públicas: formato do código sem ir ao banco, normalização, origem só em hash, origem pela Cloudflare (trocar `x-forwarded-for` não muda a chave), produção sem `KICKOFF_ORIGEM_SECRET` fecha as rotas sem ir ao banco, resposta só com o contrato público (inclui `expirado`; foto fora do bucket público descartada), cabeçalhos, falha genérica, empresa do corpo ignorada), `app/api/agenda/kickoffs/convites/route.test.ts` (gestão: sem login, equipe sem permissão e cliente do Plan barrados; usuário da sessão; empresas internas recusadas; sem `KICKOFF_PUBLIC_BASE_URL` ou com endereço local, gerar e reemitir dão 409 sem ir ao banco; link montado com o endereço oficial), `lib/kickoff/middlewarePublico.test.ts` (só `/impulsao` e `/api/impulsao` abrem sem login), `lib/kickoff/publico.test.ts` (código, links, datas, calendário, origem: `cf-connecting-ip` padrão, modo `x-forwarded-for` pela direita, HMAC, chave obrigatória em produção sem reserva; endereço oficial: recusa `http`, localhost, IPs privados, `.local`, credenciais, parâmetros).
- `lib/kickoff/kickoffUnico.test.ts`: a regra de kickoff único (PGlite, migrations reais). Concluiu e tenta reservar de novo; concluiu e tenta cancelar, remanejar ou reabrir (pela função e por SQL direto, também como admin); ausência e reagendamento (reserva nova, ligada à ausência, uma vez); cancelou antes de participar e reserva de novo; sessão terminou sem registro (continua ativa, não conclui); concluir sem presença (função e check); presença só depois do início e ausência só depois do fim; quem não gerencia não registra nem conclui; histórico intocável; capacidade com empresas diferentes; sessão com presença não se cancela. **Participação não concluída:** compareceu e tenta cancelar (recusado, função e SQL direto); interrupção com motivo obrigatório e reagendamento preservando a participação; interrupção só de quem compareceu, nunca de concluída. **Correção de presença:** "compareceu" por engano volta a "sem registro" ou vira ausência, e "não compareceu" por engano volta a valer, sempre na mesma reserva e com antes/depois/motivo no histórico; sem motivo, sem permissão ou por SQL direto, recusada; concluída e interrompida não se corrigem; ausência que já gerou reagendamento não se corrige (nem depois de cancelar a reserva nova).
- `lib/kickoff/reuniaoProtegida.test.ts`: compatibilidade da `004` com os gatilhos reais de `meetings` e RLS do Plan (seção "Compatibilidade da 004").
- `lib/kickoff/reservasRegras.test.ts`, `lib/kickoff/rotasProtegidas.test.ts` (rotas antigas e "Desfazer"), `app/api/agenda/kickoffs/reservas/route.test.ts` (rotas novas: autorização, usuário da sessão, empresa interna, tradução dos erros), `app/api/agenda/eventos/[id]/route.test.ts` (mover e cancelar sessão com reservas).
- **Zoom E1:**
  - `lib/zoom/api.test.ts` (cliente, fetch e relógio falsos): token com `account_credentials` e Basic; token reaproveitado e renovado perto de vencer; pedidos simultâneos com uma renovação; 401 renova e repete uma vez (dois seguidos desistem); credenciais recusadas (origem `oauth`, sem segredo na mensagem); 404/3001, 429 com `Retry-After` e 503 sem o texto do Zoom; rede caída e prazo esgotado.
  - `lib/kickoff/zoomSala.test.ts` (regras): credenciais ausentes; Meeting ID e links aceitos ou recusados (link de inscrição explicado); tipo incorreto (instantânea, única, sem horário fixo); inscrição desligada; aprovação manual; inscrição por ocorrência; login exigido; sala de teste do CS; avisos que não bloqueiam; resumo em lista fechada, sem links nem senha; cada falha do Zoom com mensagem própria.
  - `lib/kickoff/zoomSalaBanco.test.ts` (PGlite, migrations reais até a `006`): quem não gerencia não ativa; formato, verificação velha ou no futuro recusados; sala de turma do Plan recusada (função e escrita direta); ativar, registrar de novo, trocar (motivo obrigatório, anterior no histórico) e reativar a mesma linha; nunca duas ativas; Meeting ID imutável; sala e histórico não se apagam; verificação reprovada mantém a sala ativa; `anon`/`authenticated` sem acesso; **reuniões, sessões, reservas e empresas idênticas antes e depois**.
- **Zoom E2** (Zoom sempre simulado; nenhuma chamada real de escrita):
  - `lib/kickoff/zoomInscricaoBanco.test.ts` (PGlite, migrations reais até a `007`, orquestração de verdade): inscrição nova com `Nome | Empresa #CÓDIGO`; inscrição existente reaproveitada sem chamar o Zoom; pedidos simultâneos (um só fala com o Zoom); criação interrompida retomada depois de 2 minutos; falha temporária (reserva continua ativa, erro guardado sem o texto do Zoom, recuperação); espera de 15 s; erro de autenticação e de autorização; sala reconfigurada no Zoom; resposta ambígua resolvida pelo e-mail; mesmo e-mail em outra empresa (conflito sem chamar o Zoom); e-mail já no Zoom com o código de outra empresa (link não é guardado); link que não é do Zoom recusado; inscrição que sumiu refeita, e Zoom fora do ar sem derrubar o acesso guardado; troca de e-mail (inscrição antiga substituída) e de nome; reserva cancelada, concluída, ausente e interrompida sem acesso; reagendamento e remanejamento reaproveitando a inscrição; convite válido, sem reserva, revogado, expirado com e sem reserva; 10 códigos errados bloqueiam a origem; 30 pedidos por convite; troca de sala (nada migra, cada reserva gera outra, a antiga fica guardada, voltar reaproveita); sala reprovada; quem não gerencia não pede acesso; nada se apaga; `anon`/`authenticated` sem acesso; **reuniões, sessões, reservas, empresas e convites idênticos antes e depois**.
  - `lib/kickoff/zoomInscricao.test.ts` (regras puras): código da empresa, nome no Zoom e limite de 64 caracteres, mensagens sem texto do Zoom, só `https://…zoom.us` como destino, estados para a empresa e para a equipe, janela de 30 minutos antes e depois.
  - `lib/zoom/api.test.ts`: inscrever, ler e procurar pelo e-mail (paginação), erros sem o texto do Zoom, 401 renova e repete uma vez.
  - `app/impulsao/reuniao/entrada.test.ts` (página de entrada e botão, sem login): **abrir a página não consulta o banco no servidor, não chama o Zoom, não encaminha e não traz link**; a rota de entrada não tem `GET`; o passe sai só dentro do horário, sem Zoom e sem inscrição; pedido de outro site não recebe passe; clique com passe válido encaminha (`303`) com o link só no cabeçalho `Location`; a inscrição é criada no clique, nunca antes; **cliques repetidos não duplicam registrantes**; passe ausente, adulterado, vencido ou de outro convite; **formulário de outro site (CSRF) recusado mesmo com passe válido**; convite inválido ou revogado recusado; **expirado com reserva ativa entra**; fora da janela não entrega; sem reserva elegível; **falha do Zoom preserva a reserva**; conflito, sala ausente e link que não é do Zoom; sem credenciais, banco fora, `007` ausente e produção sem `KICKOFF_ORIGEM_SECRET`; nada sensível em log.
  - `app/impulsao/reuniao/route.test.ts` (outras rotas públicas): recuperação pelo `POST …/acesso` sem link do Zoom na resposta; agendamento que devolve o acesso; **reserva devolvida normalmente quando o Zoom falha**; sem a `007` tudo segue como na M3; abrir a página do convite nunca chama o Zoom.
  - `app/api/agenda/kickoffs/reservas/acessoZoom.test.ts` (equipe): sem login, sem permissão e cliente do Plan barrados; usuário da sessão; convite criado ou reaproveitado; falhas com explicação; sem credenciais, `007` pendente e permissão recusada pelo banco; painel só lê o banco e nunca traz o link.
  - `lib/kickoff/reservasConcorrencia.test.ts` ganhou um caso da E2, com conexões simultâneas de verdade: oito pedidos de acesso da mesma reserva ao mesmo tempo (um só fica com a inscrição para criar; os outros sete recebem "aguardar") e o mesmo e-mail disputado por duas empresas (uma inscrição só; a outra recebe conflito). **Em 13/11/2026 rodou contra um PostgreSQL 18.3 local descartável: 8 de 8** (os 7 casos da M2/M3 e o da E2), com as migrations reais de `001` a `007`. Sem `KICKOFF_PG_URL` o arquivo é pulado; no PGlite a mesma regra é testada com os pedidos intercalados.
- **Zoom E1 (rota):**
  - `app/api/agenda/kickoffs/zoom/route.test.ts` (Zoom e banco simulados; qualquer URL inesperada falha): sem login, equipe sem permissão e cliente do Plan barrados sem banco nem Zoom; admin entra; abrir a tela não chama o Zoom e não devolve credencial; credenciais ausentes e migration pendente; sala válida, inexistente, limite, instabilidade, tipo errado, inscrição desligada, aprovação manual, sala do Plan; token reaproveitado; ativar verifica de novo e grava com o usuário da sessão; sala com problema nunca é gravada; troca com motivo; Zoom fora ou sem credenciais não grava; verificar a sala ativa grava aprovada, reprovada e "não encontrada", mas não grava falha passageira.
