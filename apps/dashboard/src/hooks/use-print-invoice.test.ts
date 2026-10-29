import { describe, expect, it, vi } from 'vitest'
import { type InvoiceWindow, invoicePath, isOrderResource, writeInvoice } from './use-print-invoice'

function fakeWindow(closed = false) {
  const written: string[] = []
  const win: InvoiceWindow = {
    closed,
    close: vi.fn(),
    document: { open: vi.fn(), write: (html: string) => written.push(html), close: vi.fn() },
  }
  return { win, written }
}

describe('invoicePath', () => {
  it('is the order invoice under the Admin API', () => {
    expect(invoicePath('or_gbHJdmfrXB')).toBe('/orders/or_gbHJdmfrXB/invoice')
  })

  it('cannot be steered to another path by the id', () => {
    expect(invoicePath('or_1/../../customers')).toBe('/orders/or_1%2F..%2F..%2Fcustomers/invoice')
  })
})

describe('writeInvoice', () => {
  it('writes the whole document into the window opened for it', () => {
    const { win, written } = fakeWindow()
    expect(writeInvoice(win, '<!DOCTYPE html><p>Invoice</p>')).toBe(true)
    expect(written).toEqual(['<!DOCTYPE html><p>Invoice</p>'])
    expect(win.document.close).toHaveBeenCalled()
  })

  // A blocked popup comes back as null, and a staff member may close the
  // window before the request returns. Neither is an error to throw.
  it('does nothing when the popup was blocked or already closed', () => {
    expect(writeInvoice(null, '<p>x</p>')).toBe(false)
    const { win, written } = fakeWindow(true)
    expect(writeInvoice(win, '<p>x</p>')).toBe(false)
    expect(written).toEqual([])
  })
})

describe('isOrderResource', () => {
  it('puts the item on order pages only', () => {
    expect(isOrderResource({ resource: { id: 'or_gbHJdmfrXB' } })).toBe(true)
    expect(isOrderResource({ resource: { id: 'prod_86Rf07xd4z' } })).toBe(false)
    expect(isOrderResource({})).toBe(false)
  })
})
