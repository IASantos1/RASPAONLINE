import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { MODELS, PRICES_EUR, type GameModel } from "./config.js";
import { pool, persistIssue, listIssues, getIssue, getTicketStatus, revealTicket } from "./db.js";
import { generateIssue } from "./engine/issue-generator.js";

const PORT = Number(process.env.PORT ?? 3000);
const DEMO_MODE = process.env.DEMO_MODE === "true";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "";

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage): boolean {
  const provided = req.headers["x-admin-key"];
  if (typeof provided !== "string" || !ADMIN_API_KEY) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_API_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 8_192) throw new Error("Pedido demasiado grande.");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("O corpo deve ser um objeto JSON.");
  }
  return parsed as Record<string, unknown>;
}

function validModel(value: unknown): value is GameModel {
  return typeof value === "string" && Object.hasOwn(MODELS, value);
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    await pool.query("SELECT 1");
    return send(res, 200, { ok: true, mode: "DEMO", database: "connected" });
  }

  if (!DEMO_MODE) {
    return send(res, 503, { error: "A API está desativada. Defina DEMO_MODE=true para testes." });
  }

  if (req.method === "GET" && path === "/api/demo/config") {
    return send(res, 200, {
      mode: "DEMO",
      pricesEur: PRICES_EUR,
      models: Object.entries(MODELS).map(([id, config]) => ({
        id, name: config.name, rows: config.rows, columns: config.columns,
        symbols: config.symbols
      })),
      issueSize: 1000,
      batchSize: 100,
      targetRtpPercent: 40
    });
  }

  if (req.method === "POST" && path === "/api/demo/issues") {
    if (!authorized(req)) return send(res, 401, { error: "Não autorizado." });
    let body: Record<string, unknown>;
    try { body = await readJson(req); }
    catch (error) { return send(res, 400, { error: error instanceof Error ? error.message : "JSON inválido." }); }

    if (!validModel(body.model)) return send(res, 400, { error: "Modelo inválido." });
    if (typeof body.priceEur !== "number" || !PRICES_EUR.includes(body.priceEur as typeof PRICES_EUR[number])) {
      return send(res, 400, { error: "Preço inválido." });
    }

    const issue = generateIssue({ model: body.model, priceEur: body.priceEur });
    await persistIssue(issue);
    return send(res, 201, {
      id: issue.id,
      mode: issue.mode,
      model: issue.model,
      priceEur: issue.priceEur,
      ticketCount: issue.ticketCount,
      batchSize: issue.batchSize,
      salesCents: issue.salesCents,
      prizesCents: issue.prizesCents,
      actualRtpPercent: issue.actualRtpPercent,
      manifestHash: issue.manifestHash,
      batches: issue.batches
    });
  }

  if (req.method === "GET" && path === "/api/demo/issues") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    return send(res, 200, { issues: await listIssues(Number.isFinite(limit) ? limit : 50) });
  }

  const issueMatch = path.match(/^\/api\/demo\/issues\/([^/]+)$/);
  if (req.method === "GET" && issueMatch) {
    const issue = await getIssue(decodeURIComponent(issueMatch[1]!));
    return issue ? send(res, 200, issue) : send(res, 404, { error: "Emissão não encontrada." });
  }

  const ticketMatch = path.match(/^\/api\/demo\/tickets\/([^/]+)$/);
  if (req.method === "GET" && ticketMatch) {
    const ticket = await getTicketStatus(decodeURIComponent(ticketMatch[1]!));
    return ticket ? send(res, 200, ticket) : send(res, 404, { error: "Bilhete não encontrado." });
  }

  const revealMatch = path.match(/^\/api\/demo\/tickets\/([^/]+)\/reveal$/);
  if (req.method === "POST" && revealMatch) {
    const ticket = await revealTicket(decodeURIComponent(revealMatch[1]!));
    if (!ticket) return send(res, 404, { error: "Bilhete não encontrado." });
    return send(res, 200, {
      id: ticket.id,
      issueId: ticket.issue_id,
      model: ticket.model,
      priceCents: Number(ticket.price_cents),
      grid: ticket.grid,
      prizeMultiplier: Number(ticket.prize_multiplier),
      prizeCents: Number(ticket.prize_cents),
      winningSymbolId: ticket.winning_symbol_id,
      ticketHash: ticket.ticket_hash,
      revealedAt: ticket.revealed_at
    });
  }

  return send(res, 404, { error: "Rota não encontrada." });
}

const server = createServer((req, res) => {
  void handler(req, res).catch((error: unknown) => {
    console.error("API error:", error);
    if (!res.headersSent) send(res, 500, { error: "Erro interno." });
    else res.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`RaspaOnline API DEMO ativa na porta ${PORT}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}
process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
