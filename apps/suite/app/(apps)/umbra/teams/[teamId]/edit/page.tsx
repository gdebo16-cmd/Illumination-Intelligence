import TeamForm from '../../../_components/TeamForm';

// The id comes from the address. Reading it here (on the server) means the first HTML already has it.
export default async function EditTeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  return <TeamForm key={teamId} teamId={teamId} />;
}
