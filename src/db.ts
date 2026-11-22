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

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export type PersistedTicket = ScratchTicket;
