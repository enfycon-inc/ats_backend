// Queue jobs still need Prisma while they finish. Nest's destroy hooks disconnect
// Prisma before Bull's application-shutdown hook, so drain workers first.
export async function closeAfterJobs(
  workers: { close(): Promise<void> }[],
  closeApplication: () => Promise<void>,
): Promise<void> {
  await Promise.all(workers.map(worker => worker.close()));
  await closeApplication();
}
