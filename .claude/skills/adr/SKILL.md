---
name: adr
description: Cria ADRs (Architecture Decision Records) curtos e diretos no padrão Michael Nygard. Use quando o usuário pedir para registrar, documentar ou justificar uma decisão de arquitetura/tecnologia (ex. "cria uma ADR", "documenta a decisão de usar Kafka", "/adr").
---

# Criação de ADRs

ADR registra **uma** decisão de arquitetura e **por que** ela foi tomada. Quem lê deve entender a escolha em 2 minutos. Curto, técnico, justificado.

## Onde e como nomear

- Pasta: `docs/adr/` na raiz do monorepo (criar se não existir).
- Arquivo: `NNNN-titulo-em-kebab-case.md` (ex. `0003-outbox-para-eventos-de-produto.md`).
- Numeração: próximo número sequencial com 4 dígitos, olhando os arquivos existentes em `docs/adr/`. Nunca reaproveitar número.
- Idioma: português.

## Processo

1. **Levantar o contexto real.** Ler o código, `CLAUDE.md` e configs relevantes para a decisão (ex. `docker-compose.yaml`, `package.json`, `pom.xml`). Usar dados do projeto, nunca os exemplos do template.
2. **Esclarecer todos os pontos antes de escrever (obrigatório).** Não começar a ADR enquanto houver qualquer ponto em dúvida ou mal explicado. Antes de escrever, confirmar que estão claros:
   - o problema e as forças em jogo (necessidade, escala, time, prazo, restrições);
   - a decisão tomada e o motivo principal;
   - as alternativas consideradas (mínimo 3) e por que cada uma foi descartada;
   - as consequências, inclusive as negativas;
   - status, autor e data.

   Se algum item estiver vago, contraditório ou ausente, **parar e pedir ao usuário para aprofundar**, com perguntas objetivas e específicas sobre o ponto em aberto (ex. "Por que Kafka e não RabbitMQ neste cenário?" em vez de "Pode dar mais detalhes?"). Repetir até não restar dúvida. Nunca preencher lacunas com suposições nem inventar restrições de negócio.
3. **Escrever a ADR** seguindo o template abaixo, só depois do passo 2 concluído.
4. **Revisar contra as regras** (seção "Regras de escrita") e cortar tudo que não justifica a decisão.

## Template

Copie exatamente esta estrutura. Remova os textos de instrução (`>` blocos) na ADR final — eles existem só para guiar.

```markdown
# ADR-NNNN: [Título da Decisão]

## Status

`Proposto` | `Aceito` — escolha um e apague o outro.

**Data:** YYYY-MM-DD
**Autor:** Nome do(a) decisor(a)

## Contexto

> Descreva as **forças em jogo** em poucos bullets: o que o produto precisa, restrições de negócio/prazo/equipe, o que não pode dar errado.

- **Produto:** ...
- **Escala alvo:** ...
- **Time:** ...
- **Restrição:** ...

## Decisão

> **Uma frase clara** com a escolha feita.

Adotaremos X, por Y.

## Alternativas consideradas

> Compare **pelo menos 2 alternativas** com prós/contras.

| Alternativa | Prós | Contras |
|---|---|---|
| **X** (escolhida) | ... | ... |
| Y | ... | ... |
| Z | ... | ... |

## Consequências

**Positivas:** o que melhora com essa escolha.
**Negativas:** o que fica mais difícil ou arriscado.

## Referências

> Pelo menos **2 fontes confiáveis**: doc oficial da tecnologia + 1 outra (post de engenharia validado, paper, livro técnico). Cite autor/fonte, não só um link solto.

- Autor/Organização. *Título*. Fonte/URL.
- Autor (ano). *Título*. Editora/Periódico.
```

### Exemplo ilustrativo (não copiar os dados)

Contexto: app de agendamento para barbearia, ~500 agendamentos/mês, time de 2 devs web, lançar em 2 meses com orçamento apertado.
Decisão: "Adotaremos PWA, por ser o mais rápido de lançar sem loja de app."

| Alternativa | Prós | Contras |
|---|---|---|
| **PWA** (escolhida) | Lança direto no navegador, sem loja de app, 1 dev mantém | Sem acesso a hardware avançado |
| React Native | Ecossistema grande, app "de verdade" na loja | Overhead de manter build iOS/Android pra time de 2 |
| Nativo (Kotlin + Swift) | Melhor performance/UX possível | 2 codebases — inviável pro prazo de 2 meses |

## Regras de escrita

1. **1 página é o alvo.** Curto e objetivo > longo e genérico. Se passou de ~60 linhas, cortar.
2. **Só detalhe técnico que sustenta a decisão.** Nada de tutorial, histórico do projeto ou explicação de conceito básico.
3. **Contexto em bullets**, cada um com um fato concreto (número, prazo, restrição). Sem prosa.
4. **Decisão em uma frase**: o quê + por quê principal.
5. **Não pule alternativas.** Mínimo 3, incluindo a escolhida. Sem comparar, vira justificativa pós-facto, não decisão.
6. **Prós/contras curtos** (uma linha por célula) e específicos ao cenário — "inviável pro prazo de 2 meses" > "mais complexo".
7. **Seja honesto nas consequências negativas.** ADR que só tem lado bom não convence ninguém. Mínimo 1 negativa real.
8. **Referências citam autor/fonte**, não só link solto. Mínimo 2: doc oficial + 1 outra fonte confiável. Não inventar referências; se não tiver certeza da fonte, verificar ou perguntar.
9. **Uma decisão por ADR.** Se surgirem duas, criar duas ADRs.
10. **ADR aceita não se edita.** Para mudar a decisão, criar nova ADR e marcar a antiga como `Substituído por ADR-NNNN`.

## Checklist final

- [ ] Nenhum ponto da decisão ficou em dúvida antes de começar a escrever
- [ ] Arquivo em `docs/adr/NNNN-titulo.md`, número sequencial
- [ ] Status escolhido (um só), data e autor preenchidos
- [ ] Contexto com dados do projeto real
- [ ] Decisão em uma frase
- [ ] ≥ 3 alternativas com prós e contras
- [ ] ≥ 1 consequência negativa honesta
- [ ] ≥ 2 referências com autor/fonte
- [ ] Blocos de instrução (`>`) removidos
- [ ] Cabe em ~1 página
