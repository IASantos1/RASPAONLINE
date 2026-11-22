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
