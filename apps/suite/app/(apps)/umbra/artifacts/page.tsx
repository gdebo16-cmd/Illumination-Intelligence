import Artifacts from '../_components/Artifacts';

// /umbra/artifacts, or /umbra/artifacts?source=<Flicker or team id> for just that one's.
// Reading the filter here (on the server) means the first HTML already has it.
export default async function ArtifactsPage({ searchParams }: { searchParams: Promise<{ source?: string | string[] }> }) {
  const { source } = await searchParams;
  const only = typeof source === 'string' && source ? source : undefined;
  return <Artifacts key={only ?? 'all'} source={only} />;
}
