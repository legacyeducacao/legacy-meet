# Agenda do cliente no Legacy Plan

O Legacy Meet é o dono da agenda (reuniões, encontros do Impulsão e jornadas). O Plan só mostra. Para isso existem duas funções no mesmo banco (Supabase `eddfdgefrwjxfafkkzls`), chamadas com o usuário logado no Plan.

## Quem vê o quê

- Só usuários com `users.role` = `CLIENT` ou `COLLABORATOR` e `users.tenant_id` preenchido.
- Cada um vê apenas a empresa dele (`tenant_id`), mais os encontros em grupo do Impulsão em que a empresa está matriculada.
- Não sai nada interno: bloqueios, motivos, justificativas, outras empresas.
- Qualquer outro usuário recebe lista vazia. Sem login: permissão negada.

## 1. Reuniões: `agenda_do_cliente(p_de, p_ate)`

```ts
const { data, error } = await supabase.rpc('agenda_do_cliente', {
  p_de: '2026-11-01', // opcional, padrão: hoje - 30 dias
  p_ate: '2026-12-31', // opcional, padrão: hoje + 120 dias
});
```

Uma linha por reunião (canceladas não vêm), em ordem de data:

| coluna | tipo | observação |
|---|---|---|
| `reuniao_id` | uuid | |
| `titulo` | text | |
| `inicio`, `fim` | timestamptz | em UTC; mostrar em `America/Sao_Paulo` |
| `status` | text | `scheduled`, `live`, `ended`, `no_show` |
| `produto` | text | `impulsao`, `legado` ou `outro` |
| `rotulo` | text | conteúdo do encontro do Impulsão (`F1`, `F2`, `C1`, `C2`), ou nulo |
| `executor` | text | nome de quem conduz |
| `em_grupo` | boolean | encontro em grupo do Impulsão |
| `link_sala` | text | link para entrar; só vem quando `status` é `scheduled` ou `live` |
| `tem_gravacao` | boolean | a reunião foi gravada |

## 2. Jornadas: `jornadas_do_cliente()`

```ts
const { data } = await supabase.rpc('jornadas_do_cliente');
```

| coluna | tipo | observação |
|---|---|---|
| `jornada_id` | uuid | |
| `produto` | text | `impulsao` ou `legado` |
| `grupo` | text | nome do grupo do Impulsão (ex.: "Grupo Terça"), ou nulo |
| `status` | text | `ativa`, `concluida`, `pausada` |
| `inicio`, `fim_previsto` | date | |
| `encontros_previstos` | int | |
| `encontros_realizados` | int | presença marcada, reunião encerrada ou gravada |
| `encontros` | jsonb | `[{ numero, rotulo, data, presenca, reposicao }]`, `presenca` = `pendente`, `presente` ou `faltou` |

Sugestão de tela: "Seu próximo encontro" no topo (primeira linha futura de `agenda_do_cliente` com o botão do `link_sala`), a barra de progresso da jornada (`encontros_realizados / encontros_previstos`, ex.: Impulsão 2/4) e a lista dos encontros.

## Onde estão as definições

`integracoes/agenda/003_agenda_cliente.sql` no repositório do Legacy Meet. Se precisar de outro campo, peça para o time do Meet ajustar a função: o Plan não deve ler as tabelas `agenda_*` diretamente (elas têm RLS fechado).
