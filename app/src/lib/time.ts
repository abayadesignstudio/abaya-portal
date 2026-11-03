import { supabase } from './supabase'
import { must } from './useQuery'

export const ACTIVITIES = ['Administration', 'Basic Services', 'Change Order', 'Internal Staff Meeting', 'Meeting (office)', 'Meeting (site)', 'Past Hours', 'Renderings', 'Research', 'RFP/RFQ', 'Travel']
export const OVERHEAD = ['Equipment', 'Insurance', 'Meetings', 'Office Admin.', 'Personal Days', 'Rent', 'Sick Leave']
export const ROLES = ['Principal', 'Project Architect', 'Designer']

export type Proj = { id: string; number: string; name: string; sector: string | null; status: string; phases: { id: string; code: string }[] }
export const loadProjects = async () =>
  must(await supabase.from('projects').select('id, number, name, sector, status, phases(id, code)').in('status', ['active', 'paused']).order('number', { ascending: false })) as unknown as Proj[]

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
export const hrs = (min: number) => { const h = Math.round(min / 60 * 100) / 100; return String(h) }

// a timer change anywhere tells the timesheet to refresh
export const TIME_CHANGED = 'abaya:time-changed'
export const announceTimeChange = () => window.dispatchEvent(new Event(TIME_CHANGED))
