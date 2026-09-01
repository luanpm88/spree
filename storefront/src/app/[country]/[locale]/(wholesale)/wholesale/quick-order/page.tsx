import { WholesaleGate } from "../_components/WholesaleGate";
import { QuickOrderView } from "./QuickOrderView";
import { basePathFor } from "@/lib/routing";

interface QuickOrderPageProps {
  params: Promise<{ country: string; locale: string }>;
}

export default async function WholesaleQuickOrderPage({
  params,
}: QuickOrderPageProps) {
  const { country, locale } = await params;
  return (
    <WholesaleGate basePath={basePathFor(country, locale)}>
      {() => <QuickOrderView />}
    </WholesaleGate>
  );
}
