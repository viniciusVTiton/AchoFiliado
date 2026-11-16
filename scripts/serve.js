/**
 * Sobe o AchoFiliado localmente.
 *   npm run dev   ->   http://localhost:3000
 *
 * Lê as credenciais do arquivo .env (copie de .env.example).
 */
import { createApp, createAccounts } from '../src/server/app.js';

const port = Number(process.env.PORT) || 3000;
const accounts = createAccounts();

createApp({ accounts }).listen(port, () => {
  const on = (v) => (v ? 'conectada' : 'não configurada');
  console.log(`AchoFiliado rodando em http://localhost:${port}`);
  console.log(`  Amazon:        ${on(accounts.amazonTag)}`);
  console.log(`  Shopee:        ${on(accounts.shopeeProvider)}`);
  console.log(`  Mercado Livre: ${on(accounts.mercadoLivreProvider)}`);
});
