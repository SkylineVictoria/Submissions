/** When true, the SPA shows a maintenance screen and does not load Supabase or the app shell. */
export function isMaintenanceMode(): boolean {
  const raw = import.meta.env.VITE_MAINTENANCE_MODE;
  return String(raw ?? '').trim().toLowerCase() === 'true';
}
