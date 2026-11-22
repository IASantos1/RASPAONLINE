import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  BATCH_SIZE,
  getModelConfig,
  ISSUE_SIZE,
  type GameModel,
  type PrizeTier,
  validatePrice
} from "../config.js";

export interface ScratchTicket {
  id: string;
  issueId: string;
  model: GameModel;
  priceCents: number;
  batchNumber: number;
  grid: string[][];
  prizeMultiplier: number;
  prizeCents: number;
  winningSymbolId: string | null;
  ticketHash: string;
}

export interface ScratchBatch {
  number: number;
  firstTicket: number;
  lastTicket: number;
  ticketCount: number;
  winningTickets: number;
  salesCents: number;
  prizesCents: number;
}

export interface ScratchIssue {
  id: string;
  mode: "DEMO";
  model: GameModel;
  priceEur: number;
  ticketCount: number;
  batchSize: number;
  targetRtpPercent: number;
  salesCents: number;
  prizesCents: number;
  actualRtpPercent: number;
  generatedAt: string;
  tickets: ScratchTicket[];
  batches: ScratchBatch[];
  manifestHash: string;
}

function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

function chooseFillerSymbols(
  count: number,
  model: GameModel,
  winningSymbolId: string | null
): string[] {
  const config = getModelConfig(model);
  const fillerPool = config.symbols
    .map((symbol) => symbol.id)
    .filter((id) => id !== winningSymbolId);

  const result: string[] = [];
  const counts = new Map<string, number>();
  while (result.length < count) {
    const eligible = fillerPool.filter((id) => (counts.get(id) ?? 0) < 2);
    if (eligible.length === 0) {
      throw new Error("Não existem símbolos suficientes para gerar uma grelha válida.");
    }
    const selected = eligible[randomInt(eligible.length)]!;
    result.push(selected);
    counts.set(selected, (counts.get(selected) ?? 0) + 1);
  }
  return result;
}

function createGrid(model: GameModel, tier: PrizeTier | null): string[][] {
  const config = getModelConfig(model);
  const cellCount = config.rows * config.columns;
  const winningSymbolId = tier?.symbolId ?? null;
  const symbols = tier
    ? [winningSymbolId!, winningSymbolId!, winningSymbolId!]
    : [];
  const fillers = chooseFillerSymbols(cellCount - symbols.length, model, winningSymbolId);
  const cells = secureShuffle([...symbols, ...fillers]);

  return Array.from({ length: config.rows }, (_, row) =>
    cells.slice(row * config.columns, (row + 1) * config.columns)
  );
}

function hashTicket(ticket: Omit<ScratchTicket, "ticketHash">): string {
  return createHash("sha256").update(JSON.stringify(ticket)).digest("hex");
}

function selectTierMap(model: GameModel): Map<number, PrizeTier> {
  return new Map(getModelConfig(model).tiers.map((tier) => [tier.multiplier, tier]));
}

export function evaluateGrid(grid: string[][]): { multiplier: number; symbolId: string | null } {
  const counts = new Map<string, number>();
  for (const row of grid) {
    for (const symbolId of row) counts.set(symbolId, (counts.get(symbolId) ?? 0) + 1);
  }
  const match = [...counts.entries()].find(([, count]) => count >= 3);
  return match ? { multiplier: 1, symbolId: match[0] } : { multiplier: 0, symbolId: null };
}

export function generateIssue(input: {
  model: GameModel;
  priceEur: number;
  issueId?: string;
}): ScratchIssue {
  validatePrice(input.priceEur);
  const config = getModelConfig(input.model);
  const issueId = input.issueId ?? randomUUID();
  const priceCents = Math.round(input.priceEur * 100);

  const tiers: (PrizeTier | null)[] = [];
  for (const tier of config.tiers) {
    for (let i = 0; i < tier.ticketCount; i++) tiers.push(tier);
  }
  const configuredWinners = tiers.length;
  const noPrizeCount = ISSUE_SIZE - configuredWinners;
  if (noPrizeCount < 0) throw new Error("A tabela de prémios excede a emissão.");
  for (let i = 0; i < noPrizeCount; i++) tiers.push(null);
  const shuffledTiers = secureShuffle(tiers);

  const tickets = shuffledTiers.map((tier, index) => {
    const grid = createGrid(input.model, tier);
    const ticketWithoutHash: Omit<ScratchTicket, "ticketHash"> = {
      id: `${issueId}-${String(index + 1).padStart(4, "0")}`,
      issueId,
      model: input.model,
      priceCents,
      batchNumber: Math.floor(index / BATCH_SIZE) + 1,
      grid,
      prizeMultiplier: tier?.multiplier ?? 0,
      prizeCents: (tier?.multiplier ?? 0) * priceCents,
      winningSymbolId: tier?.symbolId ?? null
    };
    const evaluated = evaluateGrid(grid);
    if (evaluated.multiplier !== (tier ? 1 : 0) ||
        (tier && evaluated.symbolId !== tier.symbolId)) {
      throw new Error("A grelha gerada não corresponde ao resultado atribuído.");
    }
    return { ...ticketWithoutHash, ticketHash: hashTicket(ticketWithoutHash) };
  });

  const salesCents = tickets.length * priceCents;
  const prizesCents = tickets.reduce((sum, ticket) => sum + ticket.prizeCents, 0);
  const batches: ScratchBatch[] = Array.from(
    { length: ISSUE_SIZE / BATCH_SIZE },
    (_, batchIndex) => {
      const start = batchIndex * BATCH_SIZE;
      const group = tickets.slice(start, start + BATCH_SIZE);
      return {
        number: batchIndex + 1,
        firstTicket: start + 1,
        lastTicket: start + BATCH_SIZE,
        ticketCount: group.length,
        winningTickets: group.filter((ticket) => ticket.prizeCents > 0).length,
        salesCents: group.length * priceCents,
        prizesCents: group.reduce((sum, ticket) => sum + ticket.prizeCents, 0)
      };
    }
  );

  const manifest = {
    id: issueId,
    model: input.model,
    priceEur: input.priceEur,
    ticketHashes: tickets.map((ticket) => ticket.ticketHash),
    batches
  };
  const manifestHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

  return {
    id: issueId,
    mode: "DEMO",
    model: input.model,
    priceEur: input.priceEur,
    ticketCount: tickets.length,
    batchSize: BATCH_SIZE,
    targetRtpPercent: 40,
    salesCents,
    prizesCents,
    actualRtpPercent: Number(((prizesCents / salesCents) * 100).toFixed(4)),
    generatedAt: new Date().toISOString(),
    tickets,
    batches,
    manifestHash
  };
}

export function summarizePrizeTable(model: GameModel, priceEur: number) {
  validatePrice(priceEur);
  const config = getModelConfig(model);
  const priceCents = Math.round(priceEur * 100);
  const rows = config.tiers.map((tier) => ({
    multiplier: tier.multiplier,
    ticketCount: tier.ticketCount,
    prizeCents: tier.multiplier * priceCents,
    totalPayoutCents: tier.multiplier * priceCents * tier.ticketCount
  }));
  const totalPayoutCents = rows.reduce((sum, row) => sum + row.totalPayoutCents, 0);
  return {
    rows,
    losingTickets: ISSUE_SIZE - rows.reduce((sum, row) => sum + row.ticketCount, 0),
    totalPayoutCents,
    salesCents: ISSUE_SIZE * priceCents,
    rtpPercent: Number(((totalPayoutCents / (ISSUE_SIZE * priceCents)) * 100).toFixed(4))
  };
}

export function verifyIssue(issue: ScratchIssue): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (issue.mode !== "DEMO") errors.push("Emissão fora do modo DEMO.");
  if (issue.tickets.length !== ISSUE_SIZE) errors.push("Número de bilhetes incorreto.");
  if (issue.batches.length !== ISSUE_SIZE / BATCH_SIZE) errors.push("Número de lotes incorreto.");

  let computedPrizes = 0;
  issue.tickets.forEach((ticket, index) => {
    const { ticketHash, ...body } = ticket;
    if (hashTicket(body) !== ticketHash) errors.push(`Hash inválido no bilhete ${index + 1}.`);
    const evaluated = evaluateGrid(ticket.grid);
    const expectedMultiplier = ticket.prizeMultiplier > 0 ? 1 : 0;
    if (evaluated.multiplier !== expectedMultiplier) errors.push(`Regra de símbolos inválida no bilhete ${index + 1}.`);
    if (ticket.prizeCents !== ticket.prizeMultiplier * ticket.priceCents) errors.push(`Prémio incorreto no bilhete ${index + 1}.`);
    computedPrizes += ticket.prizeCents;
  });
  if (computedPrizes !== issue.prizesCents) errors.push("Total de prémios não corresponde à emissão.");
  const manifest = {
    id: issue.id,
    model: issue.model,
    priceEur: issue.priceEur,
    ticketHashes: issue.tickets.map((ticket) => ticket.ticketHash),
    batches: issue.batches
  };
  const computedManifestHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  if (computedManifestHash !== issue.manifestHash) errors.push("Hash do manifesto inválido.");
  return { valid: errors.length === 0, errors };
}
