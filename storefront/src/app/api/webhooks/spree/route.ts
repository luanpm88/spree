import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createWebhookHandler } from "@/lib/spree/webhooks";
import {
  CATALOGUE_EVENTS,
  handleCatalogueChange,
} from "@/lib/webhooks/catalogue-cache";
import {
  handleOrderCanceled,
  handleOrderCompleted,
  handleOrderShipped,
  handlePasswordReset,
} from "@/lib/webhooks/handlers";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.SPREE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook endpoint not configured" },
      { status: 503 },
    );
  }

  const handler = createWebhookHandler({
    secret: webhookSecret,
    handlers: {
      "order.completed": handleOrderCompleted,
      "order.canceled": handleOrderCanceled,
      "order.shipped": handleOrderShipped,
      "customer.password_reset_requested": handlePasswordReset,
      // Every catalogue event maps to the same purge. Built from the list rather
      // than written out eighteen times, so adding an event is one line there and
      // cannot be half-registered here.
      ...Object.fromEntries(
        CATALOGUE_EVENTS.map((name) => [name, handleCatalogueChange]),
      ),
    },
  });

  return handler(request);
}
