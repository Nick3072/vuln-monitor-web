import type { Bindings } from '../types'

export type RematchResult = { ok: true } | { ok: false; error: string }

export async function triggerRematch(
  env: Bindings,
  solutionId: number,
  windowDays: number = 365,
): Promise<RematchResult> {
  const url = env.N8N_REMATCH_WEBHOOK_URL
  const secret = env.N8N_REMATCH_SECRET
  if (!url || !secret) {
    return { ok: false, error: 'N8N webhook not configured' }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rematch-secret': secret,
      },
      body: JSON.stringify({ solution_id: solutionId, window_days: windowDays }),
    })
    if (!res.ok) {
      return { ok: false, error: `n8n status ${res.status}` }
    }
    return { ok: true }
  } catch {
    // Do not leak error.message — may contain the webhook URL or hostname.
    return { ok: false, error: 'n8n webhook request failed' }
  }
}

export async function triggerFullBackfill(env: Bindings): Promise<RematchResult> {
  const url = env.N8N_BACKFILL_WEBHOOK_URL
  const secret = env.N8N_REMATCH_SECRET
  if (!url || !secret) {
    return { ok: false, error: 'N8N backfill webhook not configured' }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rematch-secret': secret,
      },
      body: JSON.stringify({ window_days: 365, full: true }),
    })
    if (!res.ok) return { ok: false, error: `n8n status ${res.status}` }
    return { ok: true }
  } catch {
    return { ok: false, error: 'n8n backfill request failed' }
  }
}
