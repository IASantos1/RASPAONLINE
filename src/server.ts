import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { MODELS, PRICES_EUR, type GameModel } from "./config.js";
import {
  pool, persistIssue, listIssues, getIssue,
  createDemoAccount, findDemoUser, getDemoWallet, purchaseDemoTicket,
  getOwnedDemoTicket, revealOwnedDemoTicket, DemoWalletError
} from "./db.js";
import { generateIssue } from "./engine/issue-generator.js";

const PORT = Number(process.env.PORT ?? 3000);
const DEMO_MODE = process.env.DEMO_MODE === "true";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? "";
const PUBLIC_DIR = resolve(process.cwd(), "public");
const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp"
};

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const relative = path === "/" ? "index.html" : decodeURIComponent(path).replace(/^\\/+/, "");
  const filePath = resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + sep) && filePath !== resolve(PUBLIC_DIR, "index.html")) {
    return false;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "content-type": STATIC_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": filePath.endsWith(".html") ? "no-cache" : "public, max-age=3600",
      "x-content-type-options": "nosniff"
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

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


function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

async function authenticatedDemoUser(req: IncomingMessage): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const user = await findDemoUser(tokenHash);
  return user?.id ?? null;
}

function walletError(res: ServerResponse, error: unknown): void {
  if (error instanceof DemoWalletError) {
    const status = error.code === "NOT_FOUND" ? 404
      : error.code === "INSUFFICIENT_FUNDS" || error.code === "SOLD" ? 409 : 403;
    const messages = {
      NOT_FOUND: "Conta, carteira ou bilhete não encontrado.",
      INSUFFICIENT_FUNDS: "Saldo demo insuficiente.",
      SOLD: "Não existem bilhetes disponíveis nesta emissão.",
      NOT_OWNER: "Este bilhete não pertence à tua conta."
    };
    send(res, status, { error: messages[error.code] });
    return;
  }
  throw error;
}

function validModel(value: unknown): value is GameModel {
  return typeof value === "string" && Object.hasOwn(MODELS, value);
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/" || path.startsWith("/assets/") || path === "/styles.css" || path === "/app.js")) {
    if (await serveStatic(path, res)) return;
    return send(res, 404, { error: "Ficheiro não encontrado." });
  }

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


  if (req.method === "POST" && path === "/api/demo/wallet/accounts") {
    let body: Record<string, unknown>;
    try { body = await readJson(req); }
    catch (error) { return send(res, 400, { error: error instanceof Error ? error.message : "JSON inválido." }); }
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "Jogador Demo";
    if (!displayName || displayName.length > 40) {
      return send(res, 400, { error: "O nome deve ter entre 1 e 40 caracteres." });
    }
    const token = randomBytes(32).toString("hex");
    const userId = randomUUID();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await createDemoAccount({ userId, displayName, tokenHash });
    return send(res, 201, {
      mode: "DEMO", userId, displayName, accessToken: token,
      initialBalanceCents: 5000,
      warning: "Guarda este token. Só é mostrado uma vez e dá acesso à carteira demo."
    });
  }

  if (req.method === "GET" && path === "/api/demo/wallet") {
    const userId = await authenticatedDemoUser(req);
    if (!userId) return send(res, 401, { error: "Sessão demo inválida." });
    try { return send(res, 200, { mode: "DEMO", ...(await getDemoWallet(userId)) }); }
    catch (error) { return walletError(res, error); }
  }

  if (req.method === "POST" && path === "/api/demo/wallet/purchase") {
    const userId = await authenticatedDemoUser(req);
    if (!userId) return send(res, 401, { error: "Sessão demo inválida." });
    let body: Record<string, unknown>;
    try { body = await readJson(req); }
    catch (error) { return send(res, 400, { error: error instanceof Error ? error.message : "JSON inválido." }); }
    if (typeof body.issueId !== "string" || body.issueId.length > 100) {
      return send(res, 400, { error: "issueId inválido." });
    }
    try { return send(res, 201, { mode: "DEMO", ...(await purchaseDemoTicket(userId, body.issueId)) }); }
    catch (error) { return walletError(res, error); }
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


  const revealMatch = path.match(/^\/api\/demo\/tickets\/([^/]+)\/reveal$/);
  if (req.method === "POST" && revealMatch) {
    const userId = await authenticatedDemoUser(req);
    if (!userId) return send(res, 401, { error: "Sessão demo inválida." });
    try {
      const ticket = await revealOwnedDemoTicket(userId, decodeURIComponent(revealMatch[1]!));
      return send(res, 200, { mode: "DEMO", ...ticket });
    } catch (error) { return walletError(res, error); }
  }

  const ticketMatch = path.match(/^\/api\/demo\/tickets\/([^/]+)$/);
  if (req.method === "GET" && ticketMatch) {
    const userId = await authenticatedDemoUser(req);
    if (!userId) return send(res, 401, { error: "Sessão demo inválida." });
    const ticket = await getOwnedDemoTicket(userId, decodeURIComponent(ticketMatch[1]!));
    return ticket ? send(res, 200, ticket) : send(res, 404, { error: "Bilhete não encontrado." });
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
