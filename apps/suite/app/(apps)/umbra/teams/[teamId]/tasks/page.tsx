import BotTasks from '../../../_components/BotTasks';

// The id comes from the address. Reading it here (on the server) means the first HTML already has it.
export default async function TeamTasksPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  return <BotTasks key={teamId} teamId={teamId} />;
}
