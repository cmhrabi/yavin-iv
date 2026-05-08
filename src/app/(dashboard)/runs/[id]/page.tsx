import { notFound } from "next/navigation";
import { findMockRun, stagesForRun, eventsForRun, repoForId } from "@/lib/mock-data";
import { RunDetailClient } from "./run-detail-client";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = findMockRun(id);
  if (!run) notFound();

  const stages = stagesForRun(run.id);
  const events = eventsForRun(run.id);
  const repo = repoForId(run.repoConfigId);

  return (
    <RunDetailClient run={run} repo={repo ?? null} stages={stages} events={events} />
  );
}
