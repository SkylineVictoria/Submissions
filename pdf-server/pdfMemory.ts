export function logMemory(label: string): void {
  const m = process.memoryUsage();
  console.log(`[MEMORY] ${label}`, {
    rss: `${Math.round(m.rss / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(m.heapUsed / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(m.heapTotal / 1024 / 1024)} MB`,
    external: `${Math.round(m.external / 1024 / 1024)} MB`,
    arrayBuffers: `${Math.round(m.arrayBuffers / 1024 / 1024)} MB`,
  });
}
