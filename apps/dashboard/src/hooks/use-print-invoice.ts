import { adminClient, useResourceMutation } from '@spree/dashboard'

// The printable invoice for one order, from our own Admin API endpoint
// (app/controllers/spree/api/v3/admin/orders/invoices_controller.rb in the
// Rails app). It answers the finished document, the same one the 5.6 Rails
// admin printed: the shop's identity and bank details come from the shop's
// wording file, which only the server holds.

export interface InvoiceResponse {
  number: string
  html: string
}

/** The ⋯ menu is shared by every detail page; the invoice item belongs on orders. */
export function isOrderResource(context: { resource?: { id?: string } }): boolean {
  return typeof context.resource?.id === 'string' && context.resource.id.startsWith('or_')
}

export function invoicePath(orderId: string): string {
  return `/orders/${encodeURIComponent(orderId)}/invoice`
}

/** Anything with the slice of `Window` the invoice is written into. */
export interface InvoiceWindow {
  closed: boolean
  close(): void
  document: { open(): unknown; write(html: string): void; close(): void }
}

/**
 * Puts the document into the window opened for it. The window has to be
 * opened in the click itself, before the request: opened after an await,
 * browsers treat it as a popup nobody asked for and block it.
 */
export function writeInvoice(win: InvoiceWindow | null, html: string): boolean {
  if (!win || win.closed) return false
  win.document.open()
  win.document.write(html)
  win.document.close()
  return true
}

/**
 * `print()` opens a window at once, then fills it with the invoice; on a
 * failure the window closes again and the dashboard's error toast says so.
 */
export function usePrintInvoice(orderId: string) {
  const mutation = useResourceMutation<InvoiceResponse, Error, InvoiceWindow | null>({
    mutationFn: () => adminClient.request<InvoiceResponse>('GET', invoicePath(orderId)),
    successMessage: false,
    onSuccess: (data, win) => {
      writeInvoice(win, data.html)
    },
    onError: (_error, win) => {
      if (win && !win.closed) win.close()
    },
  })

  return {
    print: () => mutation.mutate(window.open('', '_blank') as InvoiceWindow | null),
    isPending: mutation.isPending,
  }
}
