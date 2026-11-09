import BotTasks from '../../_components/BotTasks';

// The id comes from the address. Reading it here (on the server) means the first HTML already has it.
export default async function BotTasksPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  return <BotTasks key={botId} botId={botId} />;
}
