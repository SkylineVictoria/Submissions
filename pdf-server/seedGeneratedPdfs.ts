import type { SupabaseClient } from '@supabase/supabase-js';

/** Completed instances eligible for background PDF queue. */
export function isCompletedInstanceForPdfSeed(row: {
  status?: string | null;
  workflow_status?: string | null;
}): boolean {
  return String(row.status ?? '').trim() === 'locked' && String(row.workflow_status ?? '').trim() === 'completed';
}

export type SeedCompletedPdfsResult = {
  ok: boolean;
  message?: string;
  scanned: number;
  seeded: number;
  skipped: number;
  instanceIds: number[];
  dryRun: boolean;
};

/**
 * Queue pending skyline_generated_pdfs rows for completed locked instances
 * missing a queue row. Uses DB RPC `skyline_seed_completed_instance_pdfs` (same logic as trigger backfill).
 */
export async function seedCompletedInstancePdfJobs(
  supabase: SupabaseClient,
  options: { role?: string; limit?: number; dryRun?: boolean } = {},
): Promise<SeedCompletedPdfsResult> {
  const role = String(options.role ?? 'office').trim() || 'office';
  const limit = Math.min(500, Math.max(1, Number(options.limit ?? 100) || 100));
  const dryRun = Boolean(options.dryRun);

  if (dryRun) {
    const { data: instances, error } = await supabase
      .from('skyline_form_instances')
      .select('id, status, workflow_status')
      .eq('status', 'locked')
      .eq('workflow_status', 'completed')
      .order('id', { ascending: true })
      .limit(limit * 3);

    if (error) {
      return {
        ok: false,
        message: error.message,
        scanned: 0,
        seeded: 0,
        skipped: 0,
        instanceIds: [],
        dryRun,
      };
    }

    const completed = ((instances ?? []) as Array<{ id: number; status: string; workflow_status: string }>).filter(
      (row) => isCompletedInstanceForPdfSeed(row),
    );
    const instanceIds = completed.map((r) => r.id).filter((id) => Number.isFinite(id) && id > 0);

    if (instanceIds.length === 0) {
      return { ok: true, scanned: 0, seeded: 0, skipped: 0, instanceIds: [], dryRun };
    }

    const { data: existing } = await supabase
      .from('skyline_generated_pdfs')
      .select('instance_id')
      .eq('role', role)
      .in('instance_id', instanceIds);

    const hasRow = new Set(((existing ?? []) as Array<{ instance_id: number }>).map((r) => r.instance_id));
    const toSeed = instanceIds.filter((id) => !hasRow.has(id)).slice(0, limit);

    return {
      ok: true,
      scanned: instanceIds.length,
      seeded: toSeed.length,
      skipped: instanceIds.length - toSeed.length,
      instanceIds: toSeed,
      dryRun,
    };
  }

  const { data, error } = await supabase.rpc('skyline_seed_completed_instance_pdfs', {
    p_role: role,
    p_limit: limit,
  });

  if (error) {
    return {
      ok: false,
      message: error.message,
      scanned: 0,
      seeded: 0,
      skipped: 0,
      instanceIds: [],
      dryRun,
    };
  }

  const instanceIds = ((data ?? []) as Array<{ instance_id: number } | number>)
    .map((row) => (typeof row === 'number' ? row : row.instance_id))
    .filter((id): id is number => Number.isFinite(id) && id > 0);

  console.log('[pdf-worker] seeded completed instances', instanceIds.length, 'role', role);
  return {
    ok: true,
    scanned: instanceIds.length,
    seeded: instanceIds.length,
    skipped: 0,
    instanceIds,
    dryRun,
  };
}
