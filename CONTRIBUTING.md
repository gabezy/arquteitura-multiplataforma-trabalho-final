# Como contribuir

O omni-market é um monorepo e o time trabalha em gitflow: cada atividade sai de uma issue, vira uma branch a partir da `dev` e volta para a `dev` por pull request. A `main` só recebe releases e hotfixes. Para subir o ambiente local, veja o [README](README.md); os comandos e a arquitetura de cada serviço estão no `CLAUDE.md` dele.

## Branches

| Branch | Sai de | Volta para | Uso |
| --- | --- | --- | --- |
| `main` | — | — | O que foi entregue. Só recebe release e hotfix, e o push nela dispara o CD |
| `dev` | `main` | `main` (release) | Integração e branch padrão do repositório |
| `feature/<issue>-<slug>` | `dev` | `dev` | Funcionalidade ou atividade de uma issue |
| `fix/<issue>-<slug>` | `dev` | `dev` | Correção de bug |
| `docs/<issue>-<slug>` | `dev` | `dev` | Só documentação (ADR, README, C4) |
| `chore/<issue>-<slug>` | `dev` | `dev` | Manutenção: CI, dependências, configuração |
| `hotfix/<slug>` | `main` | `main`, depois `dev` | Correção urgente do que já está na `main` |

O `<slug>` é curto e em kebab-case, e o número da issue vem primeiro: `feature/15-bootstrap-order-service`. Uma branch que cobre mais de uma issue lista as duas (`feature/12-17-adr-e-bootstrap-marketplace-gateway`), e `chore` ou `hotfix` sem issue levam só o slug.

## Passo a passo

1. Tenha uma issue para a atividade. Se não houver, abra uma pelo template **Tarefa** (veja [Issues](#issues)).
2. Crie a branch a partir da `dev` atualizada:

   ```bash
   git switch dev && git pull
   git switch -c feature/<issue>-<slug>
   ```

3. Faça commits pequenos, um por assunto, no padrão de [Commits](#commits).
4. Antes de abrir o PR, rode os testes do que você alterou (os comandos estão no `CLAUDE.md` do serviço) e atualize o que a mudança afeta: `CLAUDE.md`, ADR em `docs/adr/` e tópicos novos em `docker/kafka/create-topics.sh`.
5. Suba a branch (`git push -u origin <branch>`) e abra o PR **para a `dev`**. O template já traz a issue (`Closes #N`), o que mudou, como testar e o checklist.
6. Espere o CI e a revisão. Os ajustes pedidos entram como novos commits na mesma branch.
7. Com 1 aprovação e o CI verde, o PR é mergeado por squash: o título do PR vira o commit na `dev`, então ele também segue Conventional Commits (ex.: `feat(order): bootstrap do order-service`). A branch é apagada automaticamente depois do merge.

## Revisão e CI

- Todo PR precisa de **1 aprovação** antes do merge. Nada de push direto na `dev` nem na `main`: tudo entra por PR.
- Os donos listados em [`.github/CODEOWNERS`](.github/CODEOWNERS) são pedidos como revisores dos PRs que alteram o diretório deles. Mudou o diretório de outra pessoa? Conte com a revisão dela.
- O CI de cada serviço roda quando o PR altera o diretório do serviço ou os workflows dele (filtro de `paths`, [ADR-0001](docs/adr/0001-monorepo-para-os-servicos.md)). Por causa desse filtro os checks dos serviços não são obrigatórios no GitHub: um PR que não toca o serviço ficaria esperando um check que nunca roda. Por isso, confira se o CI do que você alterou está verde antes de pedir a revisão.

## Release

No fim de cada [milestone](https://github.com/gabezy/arquteitura-multiplataforma-trabalho-final/milestones) a `dev` vai para a `main`:

1. Abra um PR `dev` → `main` com o título `release: <o que entra>` (ex.: `release: equipe no README e skill tlc-spec-driven`) e peça 1 aprovação.
2. Faça o merge com **merge commit**, não com squash nem com rebase, para a `main` e a `dev` não divergirem.
3. O push na `main` dispara o CD dos serviços que mudaram: build e publicação da imagem no `ghcr.io`.

## Hotfix

Para uma correção urgente em algo que já está na `main`:

1. Crie `hotfix/<slug>` a partir da `main` e abra um PR para a `main`, com 1 aprovação.
2. Depois do merge, abra um PR `main` → `dev`, com merge commit, para a `dev` também receber a correção e a próxima release não conflitar com ela.

## Commits

Conventional Commits em português: `tipo(escopo): descrição`.

- Tipos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore` (manutenção e configuração), `ci` (workflows) e, quando couber, `build`, `perf` e `style`.
- O escopo é opcional: o serviço (`catalog`, `order`, `billing`, `marketplace`, `bff`, `compliance`) ou o assunto (`c4`, `eventos`).
- A descrição começa em minúscula, no presente (`adiciona`, `corrige`), sem ponto final, e a primeira linha tem até 72 caracteres.
- O corpo, quando houver, explica o porquê da mudança e cita a issue com `Refs #<número>`.

```text
feat(order): adiciona health check com verificação do banco
fix(order): não loga o corpo da requisição em erros 4xx
ci(order): adiciona o pipeline do order-service
docs: adiciona ADR-0004 de dono do estoque e reserva no pedido
```

## Issues

Abra as atividades pelo template **Tarefa** (aba Issues, New issue), com contexto, tarefas e critérios de aceite. O título leva o serviço ou a área entre colchetes, como `[billing-service] ...` e `[plataforma] ...`. Depois de criar, aplique a label e o milestone e atribua ao responsável; prioridade, tamanho e status ficam no [board](https://github.com/users/gabezy/projects/2).

## Segredos

Nunca versione senha, token ou chave. Os arquivos `.env` e as chaves (`*.pem`, `*.key`) estão no `.gitignore`; só o `.env.example` vai para o repositório.
