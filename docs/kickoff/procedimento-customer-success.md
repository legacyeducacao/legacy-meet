# Procedimento: criar a empresa interna "Customer Success"

Empresa organizadora das sessões de kickoff do Impulsão (ver [README.md](README.md), "Empresa organizadora e empresas participantes").

**Status:** **executado em 12/11/2026 às 17:43 UTC.** Empresa criada: `f7249ca9-78cb-49f7-9621-e81f871527a3`. Antes, a conferência do passo 1 não voltou nenhuma linha e o ensaio do passo 2 bateu com o esperado. Não executar de novo: o passo 1 agora acha a empresa e o bloco para.

## Antes de começar

- A migration `integracoes/kickoff/001_kickoff_m1.sql` já está aplicada (versão `20261112155101`, 12/11/2026). Não é pré-requisito para criar a empresa, mas é para usá-la.
- Rodar no projeto `eddfdgefrwjxfafkkzls`: Editor SQL do Supabase, ou outra ferramenta com o papel `postgres`.
- **Não** criar logins (`users.tenant_id`) para essa empresa e **não** preencher e-mail, telefone, CNPJ ou responsável. Sem contato, os lembretes do Hub não têm para quem ir.

## Passo 1: conferir se já existe

```sql
select id, name, produto, requires_billing, executor_id, status
from public.client_tenants
where lower(btrim(name)) in ('customer success', 'cs', 'sucesso do cliente', 'legacy customer success', 'legacy cs')
   or name ilike '%customer%success%' or name ilike '%sucesso do cliente%'
   or (requires_billing = false and produto is null and nullif(btrim(coalesce(cnpj, '')), '') is null);
```

- **Esperado:** nenhuma linha. Em 12/11/2026, não voltou nenhuma.
- **Se voltar uma linha:** não criar outra. Avaliar se ela serve e usar o `id` dela.

## Passo 2: ensaio (desfaz tudo no fim)

Rodar o bloco abaixo **terminando em `rollback`**. Os gatilhos rodam, as conferências aparecem, e nada fica gravado.

```sql
begin;

-- 1. Para tudo se já existir uma empresa equivalente.
do $$
begin
  if exists (
    select 1 from public.client_tenants
    where lower(btrim(name)) in ('customer success', 'cs', 'sucesso do cliente', 'legacy customer success', 'legacy cs')
       or name ilike '%customer%success%' or name ilike '%sucesso do cliente%'
  ) then
    raise exception 'Já existe uma empresa equivalente a Customer Success. Use o id dela; não crie outra.';
  end if;
end $$;

-- 2. Empresa interna com os campos recomendados.
insert into public.client_tenants
  (name, sector, sector_type, status, requires_billing, produto, executor_id, email, phone, cnpj, owner)
values
  ('Customer Success', 'Educação', 'Serviço', 'Concluido', false, null, null, null, null, null, null)
returning id;

-- 3. Conferência (esperado ao lado).
select
  t.id,
  t.requires_billing,                                                                  -- false
  t.access_blocked, t.inativo,                                                         -- false, false
  t.produto, t.executor_id, t.email, t.phone, t.cnpj, t.owner,                         -- todos nulos
  t.onboarding_data,                                                                   -- {}
  (select count(*) from public.client_reports r where r.client_id = t.id)            as materiais,  -- 4 (gatilho de modelos)
  (select count(*) from public.client_onboarding_answers a where a.client_id = t.id) as respostas,  -- 0
  (select count(*) from public.users u where u.tenant_id = t.id)                     as logins      -- 0
from public.client_tenants t
where t.name = 'Customer Success';

rollback;
```

## Passo 3: criação

Mesmo bloco do passo 2, trocando a última linha `rollback;` por `commit;`. Antes de rodar, conferir que a conferência do ensaio bateu com o esperado. **Anotar o `id` devolvido.**

## O que muda ao criar (verificado em 12/11/2026)

| Onde | Efeito |
|---|---|
| Gatilho `apply_default_comercial_templates` (depois de inserir) | Grava 4 links de materiais em PDF em `client_reports`. Sem aviso a ninguém |
| Gatilho `sync_onboarding_to_rows` (depois de inserir) | Nada: `onboarding_data` vazio |
| Gatilhos `carimba_inativacao`, `client_tenants_autosave_guard`, `guard_client_tenants_writable` | Rodam só em atualizações; não rodam na criação |
| Automação de cobrança | Não age: `requires_billing = false` |
| Plan | Aparece nas listas de clientes da equipe (como a "Legacy Executoria"); sem executor, não entra em carteira |
| Meet | Aparece na escolha de cliente do admin |
| Hub (`comunidade_ponte.enviar`, a cada 15 min) | A empresa vai como "conta", sem pessoas, telefones ou e-mails |

## Depois de criar (não fazer antes dos pré-requisitos)

1. **Pré-requisito obrigatório:** a ponte `comunidade_ponte` do Plan precisa deixar de mandar as sessões de kickoff para o Hub. **Feito em 12/11/2026** (`002_comunidade_ponte_sem_kickoff.sql`; ver README, "Integração comunidade_ponte").
2. Definir `MEET_KICKOFF_TENANT_ID=<id anotado>` no servidor do Meet e reiniciar o app. **Feito só no ambiente local em 12/11/2026; pendente em produção.**
3. Conceder a permissão `kickoff_impulsao.manage` a quem vai operar (tela Usuários). **Pendente.**

## Desfazer (se preciso, antes de existir qualquer sessão)

```sql
-- Conferir que nada depende da empresa.
select
  (select count(*) from public.meetings where tenant_id = '<id>') as reunioes,  -- esperado 0
  (select count(*) from public.users where tenant_id = '<id>')    as logins;    -- esperado 0
-- Apaga a empresa; os 4 materiais de client_reports vão junto (chave em cascata).
delete from public.client_tenants where id = '<id>';
```

A conta já enviada ao Hub pode continuar lá: a ponte manda a lista sem apagar contas antigas. Avisar o dono do Hub, se for o caso.
