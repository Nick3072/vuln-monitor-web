export async function writeAudit(
  db: D1Database,
  action: string,
  targetTable: string,
  targetId: number,
  actor: string,
  payload: unknown,
): Promise<void> {
  try {
    const payloadJson = payload === null || payload === undefined ? null : JSON.stringify(payload)
    await db
      .prepare(
        'INSERT INTO audit_log (action, target_table, target_id, actor, payload_json) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(action, targetTable, targetId, actor, payloadJson)
      .run()
  } catch {
    // Audit-log failures must never break the main operation.
  }
}
