# RaspaOnline Demo API

Todas as rotas de jogo estão limitadas a DEMO. Não existe carteira, pagamento, levantamento ou valor resgatável nesta versão.

## Preparação

1. Criar uma base PostgreSQL.
2. Executar `db/schema.sql`.
3. Copiar `.env.example` para `.env` e preencher `DATABASE_URL` e `ADMIN_API_KEY`.
4. Definir `DEMO_MODE=true`.
5. Executar `npm install`, `npm run build` e `npm start`.

## Rotas

- `GET /health` — estado da API e ligação à base de dados.
- `GET /api/demo/config` — modelos, preços, grelhas e símbolos.
- `POST /api/demo/issues` — cria emissão de 1.000 bilhetes. Requer cabeçalho `x-admin-key`.
- `GET /api/demo/issues` — lista emissões.
- `GET /api/demo/issues/:issueId` — resumo da emissão e dos 10 lotes.
- `GET /api/demo/tickets/:ticketId` — estado do bilhete, sem revelar grelha ou prémio.
- `POST /api/demo/tickets/:ticketId/reveal` — revela o resultado pré-atribuído. Repetir a chamada devolve o mesmo resultado.

## Criar uma emissão

```bash
curl -X POST http://localhost:3000/api/demo/issues \
  -H 'content-type: application/json' \
  -H 'x-admin-key: replace-with-a-long-random-secret' \
  -d '{"model":"sorte","priceEur":1}'
```

## Revelar um bilhete

```bash
curl -X POST http://localhost:3000/api/demo/tickets/ISSUE_ID-0001/reveal
```

## Segurança e limitações

- A rota de criação é protegida por chave administrativa. Não expor essa chave no browser.
- A grelha e o prémio ficam na base de dados antes de qualquer revelação.
- O hash deteta alterações aos dados, mas não prova por si só a imparcialidade da emissão.
- Antes de uso público, acrescentar autenticação de utilizador, autorização por bilhete, rate limiting, registos de auditoria append-only, backups, monitorização e revisão de segurança.
- A versão é DEMO e não deve aceitar depósitos nem emitir prémios resgatáveis.


## Carteira DEMO

- `POST /api/demo/wallet/accounts` — cria uma conta demo e devolve um token de sessão. O token é apresentado apenas uma vez.
- `GET /api/demo/wallet` — consulta saldo e os últimos 50 movimentos. Requer `Authorization: Bearer TOKEN`.
- `POST /api/demo/wallet/purchase` — compra um bilhete disponível de uma emissão. Requer sessão e JSON `{"issueId":"..." }`.
- `GET /api/demo/tickets/:ticketId` — consulta o estado de um bilhete pertencente à conta.
- `POST /api/demo/tickets/:ticketId/reveal` — revela o bilhete da conta e credita o prémio demo uma única vez.

### Criar conta e consultar saldo

```bash
curl -X POST http://localhost:3000/api/demo/wallet/accounts \
  -H 'content-type: application/json' \
  -d '{"displayName":"Jogador Demo"}'
```

Guarda o campo `accessToken` e envia-o nas chamadas autenticadas:

```bash
curl http://localhost:3000/api/demo/wallet \
  -H 'Authorization: Bearer TOKEN'
```

### Comprar e revelar

```bash
curl -X POST http://localhost:3000/api/demo/wallet/purchase \
  -H 'Authorization: Bearer TOKEN' \
  -H 'content-type: application/json' \
  -d '{"issueId":"ID_DA_EMISSAO"}'

curl -X POST http://localhost:3000/api/demo/tickets/ID_DO_BILHETE/reveal \
  -H 'Authorization: Bearer TOKEN'
```

Cada conta começa com €50 fictícios. O saldo só pode ser utilizado nesta demonstração. Compras e créditos de prémios são processados em transações PostgreSQL; o crédito do prémio é idempotente, mesmo que a revelação seja repetida. As vendas e movimentos financeiros ficam registados em tabelas append-only.
