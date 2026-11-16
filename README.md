# AchoFiliado

Plataforma para afiliados: garimpo de ofertas, espelhamento de grupos de WhatsApp e conversão de links de Shopee, Mercado Livre e Amazon.

## Status

Módulo 1 pronto: **conversor de links** (`src/links`), com uma página de testes em `web/`.

- Amazon: gera o link limpo com a sua tag de associado.
- Shopee e Mercado Livre: dependem de um provedor com a conta do afiliado conectada (API da Shopee Affiliate Open Platform e sessão do Mercado Livre). Enquanto não houver provedor, o link é listado como pendente, sem ser alterado.
- Links curtos da Amazon (`amzn.to`) precisam ser seguidos antes da conversão.

## Estrutura

```
src/links/
  detect.js       identifica a loja pelo domínio
  extract.js      acha e substitui links dentro de um texto
  converters.js   conversão por loja
  index.js        API pública: convertLink() e convertMessage()
web/              página de testes (HTML, CSS e JS sem build)
scripts/serve.js servidor estático de desenvolvimento
test/             testes com o test runner nativo do Node
```

## Uso

Requer Node.js 22 ou superior. Não há dependências externas.

```sh
npm test          # roda os testes
npm run dev       # sobe a página em http://localhost:3000/web/
```

A página `web/` é a versão de testes da interface: cole uma mensagem e veja a conversão, com a lista dos links trocados e dos que ficaram pendentes.

```js
import { convertMessage } from './src/links/index.js';

const { text, changes, failed } = await convertMessage(mensagem, {
  amazonTag: 'minhatag-20',
  // shopeeProvider: async (url) => ({ status: 'ok', url: '...' }),
  // mercadoLivreProvider: async (url) => ({ status: 'ok', url: '...' }),
});
```

## Próximos módulos

1. Espelhamento de grupos (leitura de grupos de origem e reenvio com o link convertido)
2. Garimpo de ofertas
3. Fila de disparos e painel
4. Métricas
