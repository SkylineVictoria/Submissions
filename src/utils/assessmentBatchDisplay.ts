export const NO_BATCH_ASSIGNED_LABEL = 'No batch assigned';

export function getAssessmentBatchName(row: { batch_name?: string | null }): string {
  return String(row.batch_name ?? '').trim() || NO_BATCH_ASSIGNED_LABEL;
}

export function groupAssessmentsByBatch<T extends { batch_id?: number | null; batch_name?: string | null }>(
  rows: T[],
): Array<{ batchId: number | null; batchName: string; rows: T[] }> {
  const groups = new Map<string, { batchId: number | null; batchName: string; rows: T[] }>();
  for (const row of rows) {
    const batchId = row.batch_id != null ? Number(row.batch_id) : null;
    const batchName = getAssessmentBatchName(row);
    const key = batchId != null && Number.isFinite(batchId) ? `id:${batchId}` : `name:${batchName}`;
    const group = groups.get(key) ?? { batchId, batchName, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.batchName.localeCompare(b.batchName, undefined, { sensitivity: 'base' }),
  );
}
