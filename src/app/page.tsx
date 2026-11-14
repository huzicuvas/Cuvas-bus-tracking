'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/toast'
import type { Bus, Driver, Route } from '@/lib/types'
import AdminForms from '@/components/AdminForms'
import DriversSection from '@/components/DriversSection'
import RoutesSection from '@/components/RoutesSection'
import ConfirmDialog from '@/components/ConfirmDialog'
import Toasts from '@/components/Toasts'

// Leaflet touches window/document on import, so the map must load
// client-side only — a direct import in an App Router page crashes the build.
const BusMap = dynamic(() => import('@/components/BusMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] w-full items-center justify-center rounded-xl bg-zinc-100 text-zinc-500">
      Loading map...
    </div>
  ),
})

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return new Date(iso).toLocaleString()
}

// A bus counts as live ("Running") only when it is marked running AND its
// location was updated in the last 60 seconds.
function isBusLive(bus: Bus): boolean {
  if (bus.status !== 'running' || !bus.last_updated) return false
  return Date.now() - new Date(bus.last_updated).getTime() < 60_000
}

export default function Home() {
  const [buses, setBuses] = useState<Bus[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [deletingBus, setDeletingBus] = useState<Bus | null>(null)
  // Buses refresh every 10s — only toast a load failure once, on first load
  const firstBusLoad = useRef(true)
  const [busDeleteBusy, setBusDeleteBusy] = useState(false)
  const [routeFilter, setRouteFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const fetchBuses = useCallback(async () => {
    const { data, error } = await supabase
      .from('buses')
      // drivers!buses_driver_id_fkey: two FKs link buses and drivers
      // (drivers.bus_id AND buses.driver_id), so the FK must be named.
      .select('*, routes(name), drivers!buses_driver_id_fkey(name)')
      .order('last_updated', { ascending: false, nullsFirst: false })
    if (error) {
      if (firstBusLoad.current) {
        showToast('Could not load buses. Check your connection and refresh.', 'error')
      }
    } else if (data) {
      setBuses(data as Bus[])
      setLastRefresh(new Date())
    }
    setLoading(false)
    firstBusLoad.current = false
  }, [])

  const fetchRoutes = useCallback(async () => {
    const { data, error } = await supabase
      .from('routes')
      .select('*')
      .order('name', { ascending: true })
    if (error) {
      showToast('Could not load routes.', 'error')
    } else if (data) {
      setRoutes(data as Route[])
    }
  }, [])

  const fetchDrivers = useCallback(async () => {
    const { data, error } = await supabase
      .from('drivers')
      .select('*, routes(name), buses!drivers_bus_id_fkey(plate_number)')
      .order('name', { ascending: true })
    if (error) {
      showToast('Could not load drivers.', 'error')
    } else if (data) {
      setDrivers(data as Driver[])
    }
  }, [])

  const refreshAll = useCallback(() => {
    fetchBuses()
    fetchRoutes()
    fetchDrivers()
  }, [fetchBuses, fetchRoutes, fetchDrivers])

  async function toggleBusStatus(bus: Bus) {
    const next = bus.status === 'running' ? 'offline' : 'running'
    // Update the UI instantly, roll back if Supabase rejects it
    setBuses((prev) => prev.map((b) => (b.id === bus.id ? { ...b, status: next } : b)))
    const { error } = await supabase.from('buses').update({ status: next }).eq('id', bus.id)
    if (error) {
      setBuses((prev) => prev.map((b) => (b.id === bus.id ? { ...b, status: bus.status } : b)))
      showToast(error.message, 'error')
      return
    }
    showToast(`Bus ${bus.plate_number} marked ${next}.`)
  }

  async function confirmDeleteBus() {
    if (!deletingBus) return
    setBusDeleteBusy(true)
    const { error } = await supabase.from('buses').delete().eq('id', deletingBus.id)
    setBusDeleteBusy(false)
    if (error) {
      showToast(error.message, 'error')
      setDeletingBus(null)
      return
    }
    // Remove it from the UI instantly (its location history is deleted too)
    setBuses((prev) => prev.filter((b) => b.id !== deletingBus.id))
    setDeletingBus(null)
    showToast(`Bus ${deletingBus.plate_number} deleted.`)
  }

  useEffect(() => {
    fetchBuses()
    fetchRoutes()
    fetchDrivers()
    const id = setInterval(fetchBuses, 10000)
    return () => clearInterval(id)
  }, [fetchBuses, fetchRoutes, fetchDrivers])

  // Summary counts (recomputed on every refresh, so the 60-second
  // running/offline line moves as locations go stale)
  const busesRunning = buses.filter(isBusLive).length
  const routesActive = routes.filter((r) =>
    buses.some((b) => b.route_id === r.id && isBusLive(b)),
  ).length
  const driversOnDuty = drivers.filter((d) => d.status === 'on_duty').length

  const query = searchQuery.trim().toLowerCase()
  const filteredBuses = buses.filter((b) => {
    if (routeFilter && b.route_id !== routeFilter) return false
    if (!query) return true
    return (
      b.plate_number.toLowerCase().includes(query) ||
      (b.drivers?.name ?? '').toLowerCase().includes(query)
    )
  })
  const filtersActive = routeFilter !== '' || query !== ''

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold sm:text-3xl">CUVAS Bus Tracking</h1>
        <p className="text-sm text-zinc-500">
          Live bus locations, refreshed every 10 seconds
          {lastRefresh ? ` · Last refresh ${lastRefresh.toLocaleTimeString()}` : ''}
        </p>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold text-green-700">{busesRunning}</p>
          <p className="text-xs text-zinc-500">Buses running</p>
        </div>
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold">{routesActive}</p>
          <p className="text-xs text-zinc-500">Routes active</p>
        </div>
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold">{driversOnDuty}</p>
          <p className="text-xs text-zinc-500">Drivers on duty</p>
        </div>
      </section>

      <BusMap buses={buses} />

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">
          Buses ({filteredBuses.length}
          {filtersActive ? ` of ${buses.length}` : ''})
        </h2>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <select
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
            aria-label="Filter by route"
          >
            <option value="">All routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            type="search"
            placeholder="Search by driver name or plate number"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {filtersActive && (
            <button
              onClick={() => {
                setRouteFilter('')
                setSearchQuery('')
              }}
              className="rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50"
            >
              Clear filters
            </button>
          )}
        </div>
        {loading ? (
          <p className="text-zinc-500">Loading buses...</p>
        ) : buses.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
            No buses on the road right now
          </p>
        ) : filteredBuses.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
            No buses match your filter
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {filteredBuses.map((bus) => (
              <li
                key={bus.id}
                className={`rounded-xl border p-4 ${
                  isBusLive(bus) ? 'border-green-300' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{bus.plate_number}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      isBusLive(bus)
                        ? 'bg-green-100 text-green-800'
                        : 'bg-zinc-100 text-zinc-600'
                    }`}
                  >
                    {isBusLive(bus) ? 'Running' : 'Offline'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-600">
                  {bus.drivers?.name ?? 'No driver'} · {bus.routes?.name ?? 'No route'}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Last updated: {timeAgo(bus.last_updated)}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => toggleBusStatus(bus)}
                    className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50"
                  >
                    {bus.status === 'running' ? 'Mark offline' : 'Mark running'}
                  </button>
                  <button
                    onClick={() => setDeletingBus(bus)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DriversSection
        drivers={drivers}
        routes={routes}
        buses={buses}
        onUpdated={refreshAll}
      />

      <RoutesSection routes={routes} onUpdated={refreshAll} />

      <AdminForms routes={routes} onAdded={refreshAll} />

      {deletingBus && (
        <ConfirmDialog
          title="Delete bus?"
          message={`Are you sure? Bus "${deletingBus.plate_number}" will be deleted, along with its location history.`}
          busy={busDeleteBusy}
          onConfirm={confirmDeleteBus}
          onCancel={() => setDeletingBus(null)}
        />
      )}

      <Toasts />
    </main>
  )
}
