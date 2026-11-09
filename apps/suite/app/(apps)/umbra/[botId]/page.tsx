import BotChat from '../_components/BotChat';

// The id comes from the address. Reading it here (on the server) means the first HTML already has it.
export default async function BotChatPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  return <BotChat key={botId} botId={botId} />;
}
