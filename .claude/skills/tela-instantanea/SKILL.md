---
name: tela-instantanea
description: Regras para toda tela nova (ou mudada) da Cozinha Doce abrir na hora, sem esperar o banco. Use sempre que criar ou alterar uma tela, rota, lista, detalhe ou formulário em js/app.js.
---

# Tela instantânea

Premissa do usuário: **ao tocar num ícone ou link, a tela abre na hora**. Toda tela que busca dados no
banco desenha primeiro com o que ficou guardado da última vez e só redesenha se o banco trouxer algo
diferente. Os ajudantes ficam no começo de `js/app.js` ("Telas instantâneas").

## Como fazer

**Lista ou detalhe** — `screenShow(ctx, nome, fetcher, draw)`:

```js
async function viewCoisas(ctx) {
  await screenShow(ctx, 'coisas', () => api.listCoisas(), drawCoisas);
}
function drawCoisas(rows) {
  $view.innerHTML = `...`; // só desenha; pode ser chamada duas vezes (guardado e banco)
}
```

- Toda view recebe `ctx` (`ctx.alive()` diz se a pessoa ainda está nesta tela).
- O nome do guardado é por tela; para um item, `'coisa:<id>'`.
- Detalhe que vem de uma lista: semeie com `screenUpdate('coisa:<id>', item)` quando ainda não houver
  guardado próprio (veja `viewProduct`, que usa `knownProduct`).
- **Doces:** use o cardápio guardado (`homeCached()`, nome `'inicio'`) em vez de buscar de novo.
  Busca, favoritos e "Você também vai amar" filtram esse cardápio no aparelho.

**Formulário** — `screenShow(..., { guard: true })`: depois que a pessoa começa a mexer, o banco não
troca nada na tela.

**Pedaços que chegam depois** (contadores, interruptor de notificação): desenhe a tela inteira na hora
e atualize só o elemento quando o dado chegar (veja `viewMenu`).

**Tela muito usada:** acrescente a busca em `prefetchScreens()` (roda em segundo plano no Início).

## Depois de mudar dados

- Mudou e já sabe o resultado: `screenUpdate(nome, dados)`. Não espere o banco para redesenhar.
- Criou, publicou, editou ou apagou um doce: `refreshProducts(id)` (confere o cardápio e os
  rascunhos em segundo plano) e, se a tela seguinte depende disso, `screenForget(nome)`.

## Segurança (repositório público)

- O guardado fica no aparelho (localStorage), separado por conta (`PUBLIC_SCREENS` é o que é igual para
  todos: cardápio, aparência, categorias) e é apagado ao sair (`screenForgetUser`).
- Dados de outras pessoas (conversas, lista de e-mails) ficam só na memória: `PRIVATE_SCREENS`.
- As permissões continuam no banco (RLS): o guardado nunca libera nada.
- Todo texto vindo do banco passa por `esc()` no `draw`.

## Teste

Abra o Início, espere `networkidle`, faça o banco demorar 4 s com `page.route('**/rest/v1/**', ...)`
e confira que a tela aparece em até 1 s (`{ timeout: 1000 }`).

## Leve no celular (medido com processador 4× mais lento)

- Grades de doces: use `fillGrid(el, lista)` (12 cartões na hora, o resto em lotes). Nunca desenhe
  ~100 cartões de uma vez.
- O Início pronto é guardado em `homeDom` e recolocado ao voltar; a rolagem volta pelo ponto de
  referência (`scrollAnchor`/`restoreScroll`). Rolar só depois de desenhar a tela nova.
- Nada de `backdrop-filter` em itens repetidos (cartões, corações): cada um vira uma camada.
- Nada de animação de entrada longa nas telas.
