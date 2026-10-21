import type { BadgeTone } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { ORDER_PAYMENT_LABELS, PAYMENT_STATUS_LABELS, type OrderPaymentState, type PaymentStatusName } from "@/lib/payments/state";

const STATUS_TONES: Record<PaymentStatusName, BadgeTone> = { PENDING: "warning", PROCESSING: "info", SUCCEEDED: "success", FAILED: "danger", CANCELLED: "neutral", PARTIALLY_REFUNDED: "accent", REFUNDED: "neutral" };
const ORDER_TONES: Record<OrderPaymentState, BadgeTone> = { UNPAID: "warning", PARTIALLY_PAID: "info", PAID: "success", PARTIALLY_REFUNDED: "accent", REFUNDED: "neutral" };

export function PaymentStatusBadge({ status }: { status: PaymentStatusName }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot data-testid="payment-status" data-status={status}>
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function OrderPaymentBadge({ state }: { state: OrderPaymentState }) {
  return (
    <Badge tone={ORDER_TONES[state]} dot data-testid="order-payment-state" data-state={state}>
      {ORDER_PAYMENT_LABELS[state]}
    </Badge>
  );
}
