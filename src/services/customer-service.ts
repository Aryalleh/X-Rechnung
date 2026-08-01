import type { z } from 'zod';
import { customerSchema } from '../lib/schemas';
import {
  getCustomerByCode, insertCustomer, updateCustomer, nextCustomerCode, getCustomerById,
  type Customer, type CustomerInput,
} from '../db/repositories/customer-repo';
import { AppError } from '../lib/errors';
import { audit } from './audit-service';

type CustomerBody = z.infer<typeof customerSchema>;

function toInput(body: CustomerBody, code: string): CustomerInput {
  return {
    customer_code: code,
    customer_type: body.customer_type,
    company_name: body.company_name ?? null,
    first_name: body.first_name ?? null,
    last_name: body.last_name ?? null,
    contact_person: body.contact_person ?? null,
    street: body.street ?? null,
    postal_code: body.postal_code ?? null,
    city: body.city ?? null,
    country: body.country,
    email: body.email || null,
    phone: body.phone ?? null,
    ust_idnr: body.ust_idnr ?? null,
    steuernummer: body.steuernummer ?? null,
    leitweg_id: body.leitweg_id ?? null,
    buyer_reference: body.buyer_reference ?? null,
    order_reference: body.order_reference ?? null,
    payment_days: body.payment_days ?? null,
    invoice_language: body.invoice_language,
    delivery_method: body.delivery_method,
    internal_note: body.internal_note ?? null,
    is_active: body.is_active ? 1 : 0,
  };
}

export async function createCustomer(db: D1Database, body: CustomerBody, actorEmail: string): Promise<Customer> {
  const code = body.customer_code?.trim() || (await nextCustomerCode(db));
  const clash = await getCustomerByCode(db, code);
  if (clash) throw new AppError('CUSTOMER_CODE_TAKEN', `code ${code} exists`);
  const customer = await insertCustomer(db, toInput(body, code));
  await audit(db, { entityType: 'customer', entityId: customer.id, eventType: 'CUSTOMER_CREATED', actorEmail, newValue: { code } });
  return customer;
}

export async function editCustomer(db: D1Database, id: string, body: CustomerBody, actorEmail: string): Promise<Customer> {
  const current = await getCustomerById(db, id);
  if (!current) throw new AppError('NOT_FOUND');
  const code = body.customer_code?.trim() || current.customer_code;
  if (code !== current.customer_code) {
    const clash = await getCustomerByCode(db, code);
    if (clash && clash.id !== id) throw new AppError('CUSTOMER_CODE_TAKEN');
  }
  const updated = await updateCustomer(db, id, toInput(body, code));
  await audit(db, { entityType: 'customer', entityId: id, eventType: 'CUSTOMER_UPDATED', actorEmail });
  return updated;
}

/** Snapshot of a customer stored inside a draft/issued invoice. */
export function snapshotCustomer(c: Customer): Record<string, unknown> {
  return {
    customer_code: c.customer_code,
    customer_type: c.customer_type,
    company_name: c.company_name,
    contact_person: c.contact_person,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
    street: c.street,
    postal_code: c.postal_code,
    city: c.city,
    country: c.country,
    email: c.email,
    ust_idnr: c.ust_idnr,
    leitweg_id: c.leitweg_id,
    buyer_reference: c.buyer_reference,
  };
}
