import type { Bus } from './types'

export function timeAgo(iso: string | null, now: number | null): string {
  if (!iso) return 'Never'
  if (!now) return '…'
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(iso).toLocaleString()
}

// A bus counts as live ("Running") only when it is marked running AND its
// location was updated in the last 60 seconds.
export function isBusLive(bus: Bus, now: number | null): boolean {
  if (!now || bus.status !== 'running' || !bus.last_updated) return false
  return now - new Date(bus.last_updated).getTime() < 60_000
}

// "07:00" -> "7:00 AM", "13:45" -> "1:45 PM". Returns the input unchanged
// when it isn't a valid HH:MM time.
export function formatTime12(time: string | null | undefined): string {
  if (!time) return '—'
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return time
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return time
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${period}`
}
