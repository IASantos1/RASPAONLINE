# RaspaOnline

Motor matemático inicial para a plataforma RaspaOnline. Esta versão é **exclusivamente DEMO**: não inclui contas, carteira, pagamentos, levantamentos nem venda de bilhetes.

## Configuração inicial

- Modelos: Sorte, Cofre Cheio, Semana e Fortuna.
- Preços: €1, €2, €4, €6, €8, €10, €15, €20 e €50.
- Emissão: 1.000 bilhetes por modelo/preço, divididos em 10 lotes de 100.
- RTP teórico por emissão: 40% (400%? Não: 40 cêntimos de prémio por cada euro vendido, em média ao nível da emissão completa).

## Motor

Cada emissão atribui os resultados antes de qualquer raspagem, baralha a distribuição com o gerador criptográfico do Node.js e cria grelhas que correspondem ao prémio atribuído. A regra da versão inicial é: **três ou mais símbolos iguais em qualquer posição**. Os bilhetes e o manifesto recebem hashes SHA-256 para detetar alterações posteriores.

A distribuição é exata ao nível de cada emissão de 1.000 bilhetes; não é garantido que cada lote de 100 tenha exatamente 40% de retorno.

## Executar testes

Requer Node.js 20 ou superior.

```bash
npm install
npm test
npm run typecheck
```

## Limites importantes

- Os resultados e hashes devem ser persistidos no servidor numa base de dados append-only antes de disponibilizar os bilhetes.
- Os hashes ajudam a detetar alterações, mas não substituem auditoria independente, certificação, controlo de acesso ou prova criptográfica pública de pré-compromisso.
- Não ativar dinheiro real, depósitos, prémios resgatáveis ou venda pública sem validação jurídica e regulatória aplicável em Portugal.
