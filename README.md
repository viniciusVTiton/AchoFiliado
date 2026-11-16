# AchoFiliado

Plataforma para afiliados: garimpo de ofertas, espelhamento de grupos de WhatsApp e conversão de links de Shopee, Mercado Livre e Amazon.

## Status

| Módulo | Situação |
|---|---|
| Conversor de links | Amazon pronta; Shopee pronta via API oficial (precisa das credenciais no `.env`); Mercado Livre pendente |
| Backend (API) | Pronto: `/api/status`, `/api/convert`, `/api/mirror/preview` |
| Motor de espelhamento | Pronto (regras, limpeza de @ e site, deduplicação, horário, etiqueta por grupo) |
| Conexão com o WhatsApp | Próximo passo |
| Garimpo, fila de disparos, métricas | A fazer |

## Como rodar

Requer Node.js 22 ou superior. Não há dependências externas.

```sh
cp .env.example .env   # preencha AMAZON_TAG, SHOPEE_APP_ID e SHOPEE_APP_SECRET
npm run dev            # abre em http://localhost:3000
npm test               # roda os testes
```

O `.env` fica fora do git. O Secret da Shopee só é usado no servidor e nunca vai para o navegador.

Sem o servidor (por exemplo, na página publicada), a interface roda em modo demonstração: só a Amazon converte.

## Estrutura

```
src/links/       detecção de loja, extração e conversão de links (roda no navegador e no servidor)
src/providers/   integrações com APIs das lojas (Shopee), só no servidor
src/mirror/      motor de espelhamento: regras, limpeza, deduplicação (roda nos dois)
src/server/      servidor HTTP: API e arquivos da interface
web/             interface (HTML, CSS e JS sem build)
scripts/serve.js inicia o servidor
test/            testes com o test runner nativo do Node
```

## Regras do espelhamento

- Só espelha mensagens dos grupos de origem configurados, para os grupos de destino escolhidos.
- Filtra por loja e, opcionalmente, ignora mensagens sem link de loja.
- Troca ou remove o @ e o site de quem postou; links de loja viram os seus.
- **Se algum link de loja não puder ser convertido, a oferta não é enviada**, para nunca postar o link de afiliado de outra pessoa.
- Não repete a mesma oferta no mesmo grupo por 24 horas (identifica o produto pelo código, não pelo texto).
- Janela de horário (inclusive passando da meia-noite), rodapé, troca de textos e etiqueta de afiliado por grupo.
