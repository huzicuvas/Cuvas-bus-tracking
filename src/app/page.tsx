'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import type { Bus, Driver, Route } from '@/lib/types'
import AdminForms from '@/components/AdminForms'
import DriversSection from '@/components/DriversSection'
import RoutesSection from '@/components/RoutesSection'
import ConfirmDialog from '@/components/ConfirmDialog'

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

export default function Home() {
  const [buses, setBuses] = useState<Bus[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [busError, setBusError] = useState('')
  const [deletingBus, setDeletingBus] = useState<Bus | null>(null)
  const [busDeleteBusy, setBusDeleteBusy] = useState(false)

  const fetchBuses = useCallback(async () => {
    const { data, error } = await supabase
      .from('buses')
      // drivers!buses_driver_id_fkey: two FKs link buses and drivers
      // (drivers.bus_id AND buses.driver_id), so the FK must be named.
      .select('*, routes(name), drivers!buses_driver_id_fkey(name)')
      .order('last_updated', { ascending: false, nullsFirst: false })
    if (!error && data) {
      setBuses(data as Bus[])
      setLastRefresh(new Date())
    }
    setLoading(false)
  }, [])

  const fetchRoutes = useCallback(async () => {
    const { data, error } = await supabase
      .from('routes')
      .select('*')
      .order('name', { ascending: true })
    if (!error && data) {
      setRoutes(data as Route[])
    }
  }, [])

  const fetchDrivers = useCallback(async () => {
    const { data, error } = await supabase
      .from('drivers')
      .select('*, routes(name), buses!drivers_bus_id_fkey(plate_number)')
      .order('name', { ascending: true })
    if (!error && data) {
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
    setBusError('')
    // Update the UI instantly, roll back if Supabase rejects it
    setBuses((prev) => prev.map((b) => (b.id === bus.id ? { ...b, status: next } : b)))
    const { error } = await supabase.from('buses').update({ status: next }).eq('id', bus.id)
    if (error) {
      setBuses((prev) => prev.map((b) => (b.id === bus.id ? { ...b, status: bus.status } : b)))
      setBusError(error.message)
    }
  }

  async function confirmDeleteBus() {
    if (!deletingBus) return
    setBusDeleteBusy(true)
    setBusError('')
    const { error } = await supabase.from('buses').delete().eq('id', deletingBus.id)
    setBusDeleteBusy(false)
    if (error) {
      setBusError(error.message)
      setDeletingBus(null)
      return
    }
    // Remove it from the UI instantly (its location history is deleted too)
    setBuses((prev) => prev.filter((b) => b.id !== deletingBus.id))
    setDeletingBus(null)
  }

  useEffect(() => {
    fetchBuses()
    fetchRoutes()
    fetchDrivers()
    const id = setInterval(fetchBuses, 10000)
    return () => clearInterval(id)
  }, [fetchBuses, fetchRoutes, fetchDrivers])

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold sm:text-3xl">CUVAS Bus Tracking</h1>
        <p className="text-sm text-zinc-500">
          Live bus locations, refreshed every 10 seconds
          {lastRefresh ? ` · Last refresh ${lastRefresh.toLocaleTimeString()}` : ''}
        </p>
      </header>

      <BusMap buses={buses} />

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Buses ({buses.length})</h2>
        {busError && <p className="mb-3 text-sm text-red-600">{busError}</p>}
        {loading ? (
          <p className="text-zinc-500">Loading buses...</p>
        ) : buses.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
            No buses on the road right now
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {buses.map((bus) => (
              <li key={bus.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{bus.plate_number}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      bus.status === 'running'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-zinc-100 text-zinc-600'
                    }`}
                  >
                    {bus.status}
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
    </main>
  )
}
