// Dependency injection lets lifecycle tests exercise failures without providers,
// credentials, timers, or a persistent queue.
export async function supervise({ cycle, pause, stopping, report }) {
  let failures = 0;
  while (!stopping()) {
    const code = await cycle();
    failures = code === 0 ? 0 : failures + 1;
    report({ exit: code, consecutiveFailures: failures, alert: failures >= 3 });
    if (failures >= 3) return 1;
    if (!stopping()) await pause();
  }
  return 0;
}
