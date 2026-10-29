import { DropdownMenuItem, i18n, usePermissions } from '@spree/dashboard'
import { PrinterIcon } from '@spree/dashboard-ui/icons'
import { usePrintInvoice } from '../hooks/use-print-invoice'

interface Props {
  resource: { id: string }
}

// "Print invoice" in the order page's ⋯ menu, where the 5.6 Rails admin had it.
// The order header hands the slot only { id, number }, so the order's state is
// not known here: like 5.6, the item is on every order.
export function PrintInvoiceItem({ resource }: Props) {
  const { permissions } = usePermissions()
  const { print, isPending } = usePrintInvoice(resource.id)

  if (!permissions.can('read', 'order')) return null

  return (
    <DropdownMenuItem
      // onClick, not the onSelect of Spree's page-action recipe: the 6.0 menu
      // is Base UI, which has no onSelect, so the item rendered and did nothing.
      onClick={() => print()}
      disabled={isPending}
    >
      <PrinterIcon className="size-4" />
      {i18n.t('admin.invoice.print')}
    </DropdownMenuItem>
  )
}
