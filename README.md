# RaspaOnline

Motor matemático inicial para a plataforma RaspaOnline. Esta versão é **exclusivamente DEMO**: não inclui contas, carteira, pagamentos, levantamentos nem venda de bilhetes.

## Configuração inicial

- Modelos: Sorte, Cofre Cheio, Semana e Fortuna.
- Preços: €1, €2, €4, €6, €8, €10, €15, €20 e €50.
- Emissão: 1.000 bilhetes por modelo/preço, divididos em 10 lotes de 100.
- RTP teórico por emissão: 40% (40 cêntimos em prémios por cada euro vendido, ao nível da emissão completa).

## Motor

Cada emissão atribui os resultados antes de qualquer raspagem, baralha a distribuição com o gerador criptográfico do Node.js e cria grelhas que correspondem ao prémio atribuído. A regra da versão inicial é: **três ou mais símbolos de prémio iguais em qualquer posição**. Os símbolos decorativos/de preenchimento não são símbolos premiados. Os bilhetes e o manifesto recebem hashes SHA-256 para detetar alterações posteriores.

A distribuição é exata ao nível de cada emissão de 1.000 bilhetes; não é garantido que cada lote de 100 tenha exatamente 40% de retorno.

## Executar testes

Requer Node.js 20 ou superior.

```bash
npm install
npm test
npm run typecheck
npm run build
```

## API DEMO com PostgreSQL

A API de emissões, carteira demo, compras e revelação de bilhetes está documentada em [docs/API.md](docs/API.md). Configura a base de dados com [db/schema.sql](db/schema.sql) e usa `.env.example` como referência.

## Limites importantes

- Os resultados e hashes devem ser persistidos no servidor numa base de dados append-only antes de disponibilizar os bilhetes.
- Os hashes ajudam a detetar alterações, mas não substituem auditoria independente, certificação, controlo de acesso ou prova criptográfica pública de pré-compromisso.
- Não ativar dinheiro real, depósitos, prémios resgatáveis ou venda pública sem validação jurídica e regulatória aplicável em Portugal.


## Interface web

A interface responsiva está em `public/` e é servida pelo mesmo servidor HTTP:

- `/` — página inicial RaspaOnline.
- Edição especial sazonal **Magia de Natal**, apresentada visualmente como tema da Fortuna Dourada.
- Criação de conta demo com €50 fictícios, sessão por token, carteira, movimentos, compra e revelação de bilhetes.
- Interface adaptada a telemóvel e computador.

A edição de Natal reutiliza a tabela matemática do modelo Fortuna (RTP teórico de 40%); não altera probabilidades nem resultados. Para aparecerem bilhetes compráveis, é necessário criar previamente emissões DEMO através da API administrativa. A interface não ativa pagamentos reais nem levantamentos.
