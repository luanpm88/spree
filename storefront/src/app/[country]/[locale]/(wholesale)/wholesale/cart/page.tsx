import { WholesaleGate } from "../_components/WholesaleGate";
import { WholesaleCartView } from "./WholesaleCartView";
import { basePathFor } from "@/lib/routing";

interface WholesaleCartPageProps {
  params: Promise<{ country: string; locale: string }>;
}

export default async function WholesaleCartPage({
  params,
}: WholesaleCartPageProps) {
  const { country, locale } = await params;
  return (
    <WholesaleGate basePath={basePathFor(country, locale)}>
      {() => <WholesaleCartView />}
    </WholesaleGate>
  );
}
