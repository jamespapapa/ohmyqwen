import OntologyFullscreenPage from "@/components/ontology-fullscreen-page";

export default async function Page({ params }) {
  const { projectId } = await params;
  return <OntologyFullscreenPage projectId={projectId} />;
}
