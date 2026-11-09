import BotForm from '../../_components/BotForm';

// The id comes from the address. Reading it here (on the server) means the first HTML already has it.
export default async function EditBotPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  return <BotForm key={botId} botId={botId} />;
}
