'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/toast'
import { isBusLive, timeAgo } from '@/lib/live'
import type { Bus, Driver, Route } from '@/lib/types'
import AdminForms from '@/components/AdminForms'
import DriversSection from '@/components/DriversSection'
import RoutesSection from '@/components/RoutesSection'
import ConfirmDialog from '@/components/ConfirmDialog'
import Toasts from '@/components/Toasts'

// Admin dashboard: routes, drivers and buses are managed here.
// The student tracker on the home page is read-only.
export default function Admin() {
  const [buses, setBuses] = useState<Bus[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState<number | null>(null)
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
    }
    setLoading(false)
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
  }, [fetchBuses, fetchRoutes, fetchDrivers])

  // Clock tick only — no fetching, just re-renders so freshness re-evaluates
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(id)
  }, [])

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Admin</h1>
          <p className="text-sm text-zinc-500">
            Manage routes, drivers and buses. The tracker on the home page is read-only.
          </p>
        </div>
        <Link href="/" className="shrink-0 rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50">
          ← Tracker
        </Link>
      </header>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Buses ({buses.length})</h2>
        {loading ? (
          <p className="text-zinc-500">Loading buses...</p>
        ) : buses.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
            No buses yet — add one below.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {buses.map((bus) => (
              <li
                key={bus.id}
                className={`rounded-xl border p-4 ${
                  isBusLive(bus, now) ? 'border-green-300' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{bus.plate_number}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      isBusLive(bus, now)
                        ? 'bg-green-100 text-green-800'
                        : 'bg-zinc-100 text-zinc-600'
                    }`}
                  >
                    {isBusLive(bus, now) ? 'Running' : 'Offline'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-600">
                  {bus.drivers?.name ?? 'No driver'} · {bus.routes?.name ?? 'No route'}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Last updated: {timeAgo(bus.last_updated, now)}
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
