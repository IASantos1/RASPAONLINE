import test from "node:test";
import assert from "node:assert/strict";
import { PRICES_EUR, MODELS, type GameModel } from "../config.js";
import { generateIssue, summarizePrizeTable, verifyIssue } from "./issue-generator.js";

test("configuração contém 4 modelos e 9 preços", () => {
  assert.equal(Object.keys(MODELS).length, 4);
  assert.deepEqual(PRICES_EUR, [1, 2, 4, 6, 8, 10, 15, 20, 50]);
});

for (const model of Object.keys(MODELS) as GameModel[]) {
  test(`${model}: tabela matemática totaliza RTP de 40%`, () => {
    const summary = summarizePrizeTable(model, 1);
    assert.equal(summary.salesCents, 100_000);
    assert.equal(summary.totalPayoutCents, 40_000);
    assert.equal(summary.rtpPercent, 40);
    assert.equal(summary.losingTickets + summary.rows.reduce((sum, row) => sum + row.ticketCount, 0), 1_000);
  });

  test(`${model}: emissão tem 1.000 bilhetes, 10 lotes e passa auditoria`, () => {
    const issue = generateIssue({ model, priceEur: 2, issueId: `test-${model}` });
    assert.equal(issue.tickets.length, 1_000);
    assert.equal(issue.batches.length, 10);
    assert.equal(issue.batches.reduce((sum, batch) => sum + batch.ticketCount, 0), 1_000);
    assert.equal(issue.prizesCents, 80_000);
    assert.equal(issue.actualRtpPercent, 40);
    assert.deepEqual(verifyIssue(issue), { valid: true, errors: [] });
  });
}

test("rejeita preço não configurado", () => {
  assert.throws(() => generateIssue({ model: "sorte", priceEur: 3 }));
});

test("detecta alteração posterior num bilhete", () => {
  const issue = generateIssue({ model: "sorte", priceEur: 1, issueId: "tamper-test" });
  issue.tickets[0]!.prizeCents += 100;
  assert.equal(verifyIssue(issue).valid, false);
});
