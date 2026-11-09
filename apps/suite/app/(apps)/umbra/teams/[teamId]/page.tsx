import TeamChat from '../../_components/TeamChat';

// The id comes from the address. Reading it here (on the server) means the first HTML already has it.
export default async function TeamChatPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  return <TeamChat key={teamId} teamId={teamId} />;
}
