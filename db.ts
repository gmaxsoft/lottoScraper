import mysql from "mysql2/promise";
import type { ResultSetHeader } from "mysql2";
import type { DrawRecord } from "./types.js";

const host = process.env.DB_HOST ?? "localhost";
const user = process.env.DB_USER ?? "root";
const password = process.env.DB_PASSWORD ?? "";
const database = process.env.DB_DATABASE ?? "";

export const pool = mysql.createPool({
  host,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function testConnection(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

export async function ensureResultsTable(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS results (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_name VARCHAR(128) NOT NULL,
      draw_date DATE NOT NULL,
      numbers_json JSON NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_game_draw_date (game_name, draw_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

/** UPSERT: duplikat (gra + data) jest pomijany — nie nadpisujemy istniejącego wiersza */
export async function upsertDrawRecords(rows: DrawRecord[]): Promise<number> {
  if (rows.length === 0) return 0;
  const sql = `
    INSERT INTO results (game_name, draw_date, numbers_json)
    VALUES (?, ?, CAST(? AS JSON))
    ON DUPLICATE KEY UPDATE game_name = game_name
  `;
  let inserted = 0;
  for (const r of rows) {
    const numsLabel = r.numbers.join(", ");
    const [res] = await pool.execute(sql, [
      r.gameName,
      r.drawDate,
      JSON.stringify(r.numbers),
    ]);
    const info = res as ResultSetHeader;
    const isNew = info.affectedRows === 1;
    if (isNew) inserted += 1;

    if (isNew) {
      console.log(
        `[baza] ZAPISANO → ${r.gameName} | ${r.drawDate} | liczby: ${numsLabel}`,
      );
    } else {
      console.log(
        `[baza] POMINIĘTO (już jest w bazie) → ${r.gameName} | ${r.drawDate} | liczby: ${numsLabel}`,
      );
    }
  }
  return inserted;
}
