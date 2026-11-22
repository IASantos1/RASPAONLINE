import { Pool, type PoolClient } from "pg";
import type { ScratchIssue } from "./engine/issue-generator.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL não configurada.");
}

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  ...(process.env.PGSSLMODE === "require"
    ? { ssl: { rejectUnauthorized: true } }
    : {})
});

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistIssue(issue: ScratchIssue): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO scratch_issues
       (id, mode, model, price_eur, ticket_count, batch_size, target_rtp_percent,
        sales_cents, prizes_cents, actual_rtp_percent, generated_at, manifest_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        issue.id, issue.mode, issue.model, issue.priceEur, issue.ticketCount,
        issue.batchSize, issue.targetRtpPercent, issue.salesCents, issue.prizesCents,
        issue.actualRtpPercent, issue.generatedAt, issue.manifestHash
      ]
    );

    for (const batch of issue.batches) {
      await client.query(
        `INSERT INTO scratch_batches
         (issue_id, batch_number, first_ticket, last_ticket, ticket_count,
          winning_tickets, sales_cents, prizes_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          issue.id, batch.number, batch.firstTicket, batch.lastTicket,
          batch.ticketCount, batch.winningTickets, batch.salesCents, batch.prizesCents
        ]
      );
    }

    const statement = `INSERT INTO scratch_tickets
      (id, issue_id, model, price_cents, batch_number, grid, prize_multiplier,
       prize_cents, winning_symbol_id, ticket_hash)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`;
    for (const ticket of issue.tickets) {
      await client.query(statement, [
        ticket.id, ticket.issueId, ticket.model, ticket.priceCents,
        ticket.batchNumber, JSON.stringify(ticket.grid), ticket.prizeMultiplier,
        ticket.prizeCents, ticket.winningSymbolId, ticket.ticketHash
      ]);
    }
  });
}

export async function listIssues(limit = 50) {
  const result = await pool.query(
    `SELECT id, mode, model, price_eur, ticket_count, batch_size,
            target_rtp_percent, sales_cents, prizes_cents, actual_rtp_percent,
            generated_at, manifest_hash
     FROM scratch_issues ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );
  return result.rows;
}

export async function getIssue(issueId: string) {
  const issue = await pool.query(
    `SELECT id, mode, model, price_eur, ticket_count, batch_size,
            target_rtp_percent, sales_cents, prizes_cents, actual_rtp_percent,
            generated_at, manifest_hash
     FROM scratch_issues WHERE id = $1`,
    [issueId]
  );
  if (issue.rowCount === 0) return null;
  const batches = await pool.query(
    `SELECT batch_number, first_ticket, last_ticket, ticket_count,
            winning_tickets, sales_cents, prizes_cents
     FROM scratch_batches WHERE issue_id = $1 ORDER BY batch_number`,
    [issueId]
  );
  return { ...issue.rows[0], batches: batches.rows };
}

export async function getTicketStatus(ticketId: string) {
  const result = await pool.query(
    `SELECT id, issue_id, model, price_cents, batch_number,
            (revealed_at IS NOT NULL) AS revealed
     FROM scratch_tickets WHERE id = $1`,
    [ticketId]
  );
  return result.rows[0] ?? null;
}

export async function revealTicket(ticketId: string) {
  return inTransaction(async (client) => {
    const result = await client.query(
      `UPDATE scratch_tickets SET revealed_at = COALESCE(revealed_at, NOW())
       WHERE id = $1
       RETURNING id, issue_id, model, price_cents, batch_number, grid,
                 prize_multiplier, prize_cents, winning_symbol_id, ticket_hash,
                 revealed_at`,
      [ticketId]
    );
    return result.rows[0] ?? null;
  });
}


export class DemoWalletError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INSUFFICIENT_FUNDS" | "SOLD" | "NOT_OWNER") {
    super(code);
  }
}

export async function createDemoAccount(input: {
  userId: string;
  displayName: string;
  tokenHash: string;
}): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      "INSERT INTO demo_wallet_users (id, display_name, token_hash) VALUES ($1,$2,$3)",
      [input.userId, input.displayName, input.tokenHash]
    );
    await client.query(
      "INSERT INTO demo_wallets (user_id, balance_cents) VALUES ($1,5000)",
      [input.userId]
    );
    await client.query(
      `INSERT INTO demo_wallet_transactions
       (id,user_id,type,amount_cents,balance_after_cents,description)
       VALUES (gen_random_uuid(),$1,'demo_credit',5000,5000,'Crédito inicial fictício')`,
      [input.userId]
    );
  });
}

export async function findDemoUser(tokenHash: string) {
  const result = await pool.query(
    "SELECT id, display_name FROM demo_wallet_users WHERE token_hash = $1",
    [tokenHash]
  );
  return result.rows[0] ?? null;
}

export async function getDemoWallet(userId: string) {
  const [wallet, transactions] = await Promise.all([
    pool.query(
      "SELECT balance_cents, updated_at FROM demo_wallets WHERE user_id = $1",
      [userId]
    ),
    pool.query(
      `SELECT id, type, amount_cents, balance_after_cents, reference_id,
              description, created_at
       FROM demo_wallet_transactions WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    )
  ]);
  if (wallet.rowCount === 0) throw new DemoWalletError("NOT_FOUND");
  return { balanceCents: Number(wallet.rows[0].balance_cents), updatedAt: wallet.rows[0].updated_at, transactions: transactions.rows };
}

export async function purchaseDemoTicket(userId: string, issueId: string) {
  return inTransaction(async (client) => {
    const wallet = await client.query(
      "SELECT balance_cents FROM demo_wallets WHERE user_id = $1 FOR UPDATE",
      [userId]
    );
    if (wallet.rowCount === 0) throw new DemoWalletError("NOT_FOUND");

    const ticket = await client.query(
      `SELECT t.id, t.issue_id, t.price_cents, t.model
       FROM scratch_tickets t
       JOIN scratch_issues i ON i.id = t.issue_id
       WHERE t.issue_id = $1 AND i.mode = 'DEMO'
         AND NOT EXISTS (SELECT 1 FROM demo_ticket_sales s WHERE s.ticket_id = t.id)
       ORDER BY t.id
       LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,
      [issueId]
    );
    if (ticket.rowCount === 0) throw new DemoWalletError("SOLD");

    const balance = Number(wallet.rows[0].balance_cents);
    const price = Number(ticket.rows[0].price_cents);
    if (balance < price) throw new DemoWalletError("INSUFFICIENT_FUNDS");

    const nextBalance = balance - price;
    await client.query(
      "UPDATE demo_wallets SET balance_cents = $2, updated_at = NOW() WHERE user_id = $1",
      [userId, nextBalance]
    );
    await client.query(
      "INSERT INTO demo_ticket_sales (ticket_id,user_id,purchase_price_cents) VALUES ($1,$2,$3)",
      [ticket.rows[0].id, userId, price]
    );
    await client.query(
      `INSERT INTO demo_wallet_transactions
       (id,user_id,type,amount_cents,balance_after_cents,reference_id,description)
       VALUES (gen_random_uuid(),$1,'ticket_purchase',$2,$3,$4,$5)`,
      [userId, -price, nextBalance, ticket.rows[0].id, `Compra demo de bilhete ${ticket.rows[0].id}`]
    );
    return {
      ticketId: ticket.rows[0].id,
      issueId: ticket.rows[0].issue_id,
      model: ticket.rows[0].model,
      priceCents: price,
      balanceCents: nextBalance
    };
  });
}

export async function revealOwnedDemoTicket(userId: string, ticketId: string) {
  return inTransaction(async (client) => {
    const result = await client.query(
      `SELECT t.id, t.issue_id, t.model, t.price_cents, t.batch_number,
              t.grid, t.prize_multiplier, t.prize_cents, t.winning_symbol_id,
              t.ticket_hash, t.revealed_at, s.user_id
       FROM scratch_tickets t
       JOIN demo_ticket_sales s ON s.ticket_id = t.id
       WHERE t.id = $1
       FOR UPDATE OF t`,
      [ticketId]
    );
    if (result.rowCount === 0) throw new DemoWalletError("NOT_FOUND");
    const ticket = result.rows[0];
    if (ticket.user_id !== userId) throw new DemoWalletError("NOT_OWNER");

    if (!ticket.revealed_at) {
      await client.query(
        "UPDATE scratch_tickets SET revealed_at = NOW() WHERE id = $1",
        [ticketId]
      );
      const prize = Number(ticket.prize_cents);
      if (prize > 0) {
        const wallet = await client.query(
          "SELECT balance_cents FROM demo_wallets WHERE user_id = $1 FOR UPDATE",
          [userId]
        );
        const nextBalance = Number(wallet.rows[0].balance_cents) + prize;
        await client.query(
          "UPDATE demo_wallets SET balance_cents = $2, updated_at = NOW() WHERE user_id = $1",
          [userId, nextBalance]
        );
        await client.query(
          `INSERT INTO demo_wallet_transactions
           (id,user_id,type,amount_cents,balance_after_cents,reference_id,description)
           VALUES (gen_random_uuid(),$1,'prize_credit',$2,$3,$4,$5)`,
          [userId, prize, nextBalance, ticketId, `Prémio demo do bilhete ${ticketId}`]
        );
      }
      ticket.revealed_at = new Date();
    }

    const wallet = await client.query(
      "SELECT balance_cents FROM demo_wallets WHERE user_id = $1",
      [userId]
    );
    return {
      id: ticket.id,
      issueId: ticket.issue_id,
      model: ticket.model,
      priceCents: Number(ticket.price_cents),
      grid: ticket.grid,
      prizeMultiplier: Number(ticket.prize_multiplier),
      prizeCents: Number(ticket.prize_cents),
      winningSymbolId: ticket.winning_symbol_id,
      ticketHash: ticket.ticket_hash,
      revealedAt: ticket.revealed_at,
      balanceCents: Number(wallet.rows[0].balance_cents)
    };
  });
}

export async function getOwnedDemoTicket(userId: string, ticketId: string) {
  const result = await pool.query(
    `SELECT t.id, t.issue_id, t.model, t.price_cents, t.batch_number,
            (t.revealed_at IS NOT NULL) AS revealed
     FROM scratch_tickets t
     JOIN demo_ticket_sales s ON s.ticket_id = t.id
     WHERE t.id = $1 AND s.user_id = $2`,
    [ticketId, userId]
  );
  return result.rows[0] ?? null;
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

