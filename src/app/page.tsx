'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/toast'
import { isBusLive, timeAgo } from '@/lib/live'
import { computeStopProgress } from '@/lib/geo'
import type { Bus, Driver, Route } from '@/lib/types'
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

export default function Home() {
  const [buses, setBuses] = useState<Bus[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  // True while the Realtime channel is connected; false means the page
  // fell back to refreshing every 10 seconds (see the subscribe callback)
  const [live, setLive] = useState(false)
  // Clock tick: set on mount, then re-renders every 10s so "Running /
  // Offline" and "x min ago" go stale on time even though no data is
  // fetched anymore. (Next 16 forbids Date.now() during the first render.)
  const [now, setNow] = useState<number | null>(null)
  // Buses now arrive over Realtime — only toast a load failure once, on first load
  const firstBusLoad = useRef(true)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
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

  // Re-fetch a single bus with its route/driver names joined in.
  // Realtime payloads carry the raw row only (no joins), so a changed bus
  // is refreshed this way instead of trusting payload.new.
  const fetchOneBus = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from('buses')
      .select('*, routes(name), drivers!buses_driver_id_fkey(name)')
      .eq('id', id)
      .single()
    if (error || !data) return
    const row = data as Bus
    setBuses((prev) => {
      const exists = prev.some((b) => b.id === row.id)
      if (exists) return prev.map((b) => (b.id === row.id ? row : b))
      return [row, ...prev]
    })
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

  useEffect(() => {
    fetchBuses()
    fetchRoutes()
    fetchDrivers()
    // Live updates: Supabase pushes every buses change the moment it happens.
    // If Realtime can't connect (or isn't enabled for the buses table),
    // fall back to the old 10-second refresh so the page never goes stale.
    let pollId: ReturnType<typeof setInterval> | undefined
    const channel = supabase
      .channel('buses-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buses' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setBuses((prev) =>
              prev.filter((b) => b.id !== (payload.old as { id: string }).id),
            )
          } else if (
            payload.new &&
            typeof payload.new === 'object' &&
            'id' in payload.new
          ) {
            fetchOneBus((payload.new as { id: string }).id)
          }
          setLastRefresh(new Date())
        },
      )
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') {
          if (pollId) {
            clearInterval(pollId)
            pollId = undefined
          }
        } else if (!pollId) {
          pollId = setInterval(fetchBuses, 10000)
        }
      })
    return () => {
      if (pollId) clearInterval(pollId)
      supabase.removeChannel(channel)
    }
  }, [fetchBuses, fetchRoutes, fetchDrivers, fetchOneBus])

  // Clock tick only — no fetching, just re-renders so freshness re-evaluates
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(id)
  }, [])

  // Summary counts (recomputed on every render, so the 60-second
  // running/offline line moves as locations go stale)
  const busesRunning = buses.filter((b) => isBusLive(b, now)).length
  const routesActive = routes.filter((r) =>
    buses.some((b) => b.route_id === r.id && isBusLive(b, now)),
  ).length
  const driversOnDuty = drivers.filter((d) => d.status === 'on_duty').length

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) ?? null
  const routeBuses = selectedRoute ? buses.filter((b) => b.route_id === selectedRoute.id) : []
  // Prefer the live bus on this route; fall back to the first bus on it
  const routeBus =
    routeBuses.find((b) => isBusLive(b, now)) ?? routeBuses[0] ?? null
  const routeDrivers = selectedRoute
    ? drivers.filter((d) => d.route_id === selectedRoute.id)
    : []
  const progress = selectedRoute
    ? computeStopProgress(routeBus?.current_lat ?? null, routeBus?.current_lng ?? null, selectedRoute.stops ?? [])
    : null

  const query = searchQuery.trim().toLowerCase()
  const filteredRoutes = routes.filter((r) => {
    if (!query) return true
    const routeDrivers = drivers.filter((d) => d.route_id === r.id)
    return (
      r.name.toLowerCase().includes(query) ||
      (r.start_point ?? '').toLowerCase().includes(query) ||
      (r.end_point ?? '').toLowerCase().includes(query) ||
      routeDrivers.some((d) => d.name.toLowerCase().includes(query))
    )
  })

  return (
    <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">CUVAS Bus Tracking</h1>
          <p className="text-sm text-zinc-500">
            {live
              ? 'Live bus locations, updated in real time'
              : 'Live bus locations, refreshed every 10 seconds'}
            {lastRefresh ? ` · Last update ${lastRefresh.toLocaleTimeString()}` : ''}
          </p>
        </div>
        <Link href="/admin" className="shrink-0 rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50">
          Admin
        </Link>
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

      {selectedRoute == null ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Choose your route</h2>
          <input
            className="mb-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            type="search"
            placeholder="Search by route, place or driver name"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {loading ? (
            <p className="text-zinc-500">Loading routes...</p>
          ) : routes.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
              No routes yet — the admin adds them.
            </p>
          ) : filteredRoutes.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
              No routes match your search
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {filteredRoutes.map((r) => {
                const rDrivers = drivers.filter((d) => d.route_id === r.id)
                const rBuses = buses.filter((b) => b.route_id === r.id)
                const liveBus = rBuses.find((b) => isBusLive(b, now))
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedRouteId(r.id)}
                      className="w-full rounded-xl border p-4 text-left hover:border-blue-400 hover:bg-blue-50/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{r.name}</span>
                        {liveBus ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Running now
                          </span>
                        ) : rBuses.length > 0 ? (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                            Offline
                          </span>
                        ) : (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                            No bus
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">
                        {r.start_point ?? '—'} → {r.end_point ?? '—'}
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        Driver: {rDrivers.length ? rDrivers.map((d) => d.name).join(', ') : 'Not assigned'}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {r.stops?.length ?? 0} stops
                        {liveBus ? ` · Bus ${liveBus.plate_number}` : rBuses.length ? ` · Bus ${rBuses[0].plate_number}` : ''}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : (
        <section>
          <button
            onClick={() => setSelectedRouteId(null)}
            className="mb-3 rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            ← All routes
          </button>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold">{selectedRoute.name}</h2>
              <p className="text-sm text-zinc-600">
                {selectedRoute.start_point ?? '—'} → {selectedRoute.end_point ?? '—'}
                {' · '}Driver: {routeDrivers.length ? routeDrivers.map((d) => d.name).join(', ') : 'Not assigned'}
              </p>
            </div>
            {routeBus ? (
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  isBusLive(routeBus, now)
                    ? 'bg-green-100 text-green-800'
                    : 'bg-zinc-100 text-zinc-600'
                }`}
              >
                Bus {routeBus.plate_number} · {isBusLive(routeBus, now) ? 'Running' : 'Offline'}
                {' · '}updated {timeAgo(routeBus.last_updated, now)}
              </span>
            ) : (
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm font-medium text-zinc-600">
                No bus on this route right now
              </span>
            )}
          </div>

          <BusMap key={selectedRoute.id} buses={routeBuses} stops={selectedRoute.stops ?? []} />

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Previous stop</p>
              <p className="mt-1 text-lg font-semibold">
                {progress == null || (progress.prevIndex == null && !progress.atStop)
                  ? routeBus == null
                    ? 'No bus on this route'
                    : routeBus.current_lat == null
                      ? 'Waiting for live location…'
                      : 'Journey not started'
                  : selectedRoute.stops[progress.prevIndex!].name}
              </p>
              {progress?.atStop && progress.prevIndex != null && (
                <p className="text-sm text-green-700">Bus is here now</p>
              )}
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Next stop</p>
              <p className="mt-1 text-lg font-semibold">
                {progress == null || progress.nextIndex == null
                  ? routeBus == null
                    ? 'No bus on this route'
                    : routeBus.current_lat == null
                      ? 'Waiting for live location…'
                      : 'End of route'
                  : selectedRoute.stops[progress.nextIndex].name}
              </p>
              {progress?.nextDistanceKm != null && (
                <p className="text-sm text-zinc-600">
                  {progress.nextDistanceKm < 1
                    ? `${Math.round(progress.nextDistanceKm * 1000)} m away`
                    : `${progress.nextDistanceKm.toFixed(1)} km away`}
                </p>
              )}
            </div>
          </div>

          <h3 className="mt-6 mb-3 text-lg font-semibold">All stops</h3>
          {(selectedRoute.stops?.length ?? 0) === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
              No stops added for this route yet.
            </p>
          ) : (
            <ol className="space-y-2">
              {selectedRoute.stops.map((s, i) => {
                const isNext = progress?.nextIndex === i
                const passed = progress?.nextIndex != null && i < progress.nextIndex
                return (
                  <li
                    key={`${s.name}-${i}`}
                    className={`flex items-center gap-3 rounded-xl border p-3 ${
                      isNext ? 'border-blue-300 bg-blue-50/60' : passed ? 'opacity-60' : ''
                    }`}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isNext ? 'bg-blue-600 text-white' : passed ? 'bg-green-100 text-green-800' : 'bg-zinc-100 text-zinc-600'
                      }`}
                    >
                      {passed ? '✓' : i + 1}
                    </span>
                    <span className="font-medium">{s.name}</span>
                    {isNext && (
                      <span className="ml-auto rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">
                        Next
                      </span>
                    )}
                    {passed && <span className="ml-auto text-xs text-zinc-500">Passed</span>}
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      )}

      <Toasts />
    </main>
  )
}
