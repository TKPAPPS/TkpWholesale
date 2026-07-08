// Server-only data access for scheduled orders (Supabase service-role).
import { createServerClient } from '@/lib/supabase'
import type { ScheduledOrderItem, ScheduledOrderView, ScheduleStatus } from '@/lib/scheduled-orders'

export interface ScheduledOrderRow {
  id: string
  partner_id: number
  commercial_partner_id: number
  shipping_address_id: number
  po_ref: string
  note: string
  lang: 'en' | 'he'
  items: ScheduledOrderItem[]
  frequency: 'daily' | 'weekly'
  interval_weeks: number
  excluded_weekdays: number[]
  anchor_date: string
  end_date: string | null
  next_run_date: string
  status: ScheduleStatus
  paused_reason: string | null
  consecutive_failures: number
  last_run_date: string | null
  last_run_at: string | null
  last_order_id: number | null
  last_order_name: string | null
  last_status: string | null
  last_error: string | null
}

export function scheduleConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  return !!(url && key && !url.includes('your-project') && key !== 'your-service-role-key')
}

export async function countActiveSchedules(commercialPartnerId: number): Promise<number> {
  const supabase = createServerClient()
  const { count } = await supabase
    .from('scheduled_orders')
    .select('id', { count: 'exact', head: true })
    .eq('commercial_partner_id', commercialPartnerId)
    .in('status', ['active', 'paused'])
  return count ?? 0
}

export async function insertSchedule(row: Omit<ScheduledOrderRow, 'id' | 'consecutive_failures' | 'paused_reason' | 'last_run_date' | 'last_run_at' | 'last_order_id' | 'last_order_name' | 'last_status' | 'last_error'>): Promise<string> {
  const supabase = createServerClient()
  const { data, error } = await supabase.from('scheduled_orders').insert(row).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function listSchedulesForOwner(commercialPartnerId: number): Promise<ScheduledOrderView[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('scheduled_orders')
    .select('*')
    .eq('commercial_partner_id', commercialPartnerId)
    .in('status', ['active', 'paused'])
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data as ScheduledOrderRow[]).map(toView)
}

// Update a schedule the caller owns. Returns true if a row matched (ownership +
// id), false otherwise (404). Ownership is enforced in the WHERE clause.
export async function updateOwnedSchedule(
  id: string,
  commercialPartnerId: number,
  patch: Partial<ScheduledOrderRow>,
): Promise<boolean> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('scheduled_orders')
    .update(patch)
    .eq('id', id)
    .eq('commercial_partner_id', commercialPartnerId)
    .select('id')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}

function toView(r: ScheduledOrderRow): ScheduledOrderView {
  return {
    id: r.id,
    frequency: r.frequency,
    interval_weeks: r.interval_weeks,
    excluded_weekdays: r.excluded_weekdays,
    anchor_date: r.anchor_date,
    end_date: r.end_date,
    next_run_date: r.next_run_date,
    status: r.status,
    paused_reason: r.paused_reason,
    consecutive_failures: r.consecutive_failures,
    items: r.items,
    po_ref: r.po_ref,
    last_order_id: r.last_order_id,
    last_order_name: r.last_order_name,
    last_status: r.last_status,
  }
}
