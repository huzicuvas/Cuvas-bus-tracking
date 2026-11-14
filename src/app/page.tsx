'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/toast'
import { isBusLive, timeAgo } from '@/lib/live'
import { computeStopProgress, haversineKm } from '@/lib/geo'
import type { Bus, Driver, Route } from '@/lib/types'
import Toasts from '@/components/Toasts'

// Leaflet touches window/document on import, so the map must load
// client-side only — a direct import in an App Router page crashes the build.
const BusMap = dynamic(() => import('@/components/BusMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] w-full items-center justify-center rounded-xl bg-slate-900 text-slate-400">
      Loading map...
    </div>
  ),
})

type SpeedInfo = { speed: number | null; recorded_at: string | null }
type Filter = 'all' | 'live' | 'offline'

function formatEta(distanceKm: number, speedKmh: number): string {
  if (speedKmh <= 0) return '—'
  const mins = Math.round((distanceKm / speedKmh) * 60)
  if (mins < 1) return 'Arriving'
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

// Status of one bus — Moving / Stationary / Live / Offline / No bus.
// Speed comes from the driver's GPS (location_history); a live bus with no
// speed row yet shows as Live, and 0 km/h means it is standing at a stop.
function busStatus(bus: Bus | null, speed: number | null, now: number | null) {
  if (!bus) return { label: 'No bus', badge: 'bg-slate-700/60 text-slate-300' }
  if (!isBusLive(bus, now)) return { label: 'Offline', badge: 'bg-slate-700/60 text-slate-300' }
  if (speed != null && speed === 0) return { label: 'Stationary', badge: 'bg-amber-500/15 text-amber-400' }
  if (speed != null && speed > 0) return { label: 'Moving', badge: 'bg-green-500/15 text-green-400' }
  return { label: 'Live', badge: 'bg-green-500/15 text-green-400' }
}

function BusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 20v-2M17 20v-2" />
      <circle cx="8" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function Home() {
  const [buses, setBuses] = useState<Bus[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [speeds, setSpeeds] = useState<Record<string, SpeedInfo>>({})
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
  const [filter, setFilter] = useState<Filter>('all')
  // Full-screen map (Live Position section on the tracking page)
  const mapWrapRef = useRef<HTMLDivElement | null>(null)
  const toggleFullscreen = useCallback(() => {
    const el = mapWrapRef.current
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void el.requestFullscreen?.()
    }
  }, [])

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

  // Latest speed per bus, from the driver's GPS history (last 15 minutes).
  // The buses table carries position only — speed lives in location_history.
  const fetchSpeeds = useCallback(async () => {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('location_history')
      .select('bus_id, speed, recorded_at')
      .gt('recorded_at', since)
      .order('recorded_at', { ascending: false })
      .limit(300)
    if (error || !data) return
    const map: Record<string, SpeedInfo> = {}
    for (const row of data as { bus_id: string; speed: number | null; recorded_at: string }[]) {
      if (!(row.bus_id in map)) map[row.bus_id] = { speed: row.speed, recorded_at: row.recorded_at }
    }
    setSpeeds(map)
  }, [])

  useEffect(() => {
    fetchBuses()
    fetchRoutes()
    fetchDrivers()
    fetchSpeeds()
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
          fetchSpeeds()
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
  }, [fetchBuses, fetchRoutes, fetchDrivers, fetchOneBus, fetchSpeeds])

  // Clock tick only — no fetching, just re-renders so freshness re-evaluates
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(id)
  }, [])

  // Opening a route is a new "page" (like the reference site's detail
  // page) — start at the top instead of wherever the card button was.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [selectedRouteId])

  // Deep link from the Routes page (?route=<id>) — open that route's live
  // tracking straight away. Runs once, after the routes have loaded.
  const deepLinkApplied = useRef(false)
  useEffect(() => {
    if (deepLinkApplied.current || routes.length === 0) return
    deepLinkApplied.current = true
    const id = new URLSearchParams(window.location.search).get('route')
    if (id && routes.some((r) => r.id === id)) {
      setSelectedRouteId(id)
    }
  }, [routes])

  // Speeds change when the driver app writes new GPS rows, which has no
  // Realtime channel — refresh them on the same 10-second rhythm.
  useEffect(() => {
    const id = setInterval(fetchSpeeds, 10000)
    return () => clearInterval(id)
  }, [fetchSpeeds])

  // ---- Derived data -------------------------------------------------------
  const speedOf = (bus: Bus | null | undefined) =>
    bus ? speeds[bus.id]?.speed ?? null : null

  const liveBusOf = (routeId: string) =>
    buses.find((b) => b.route_id === routeId && isBusLive(b, now)) ?? null

  const busesLive = buses.filter((b) => isBusLive(b, now))
  const busesMoving = busesLive.filter((b) => {
    const s = speedOf(b)
    return s == null || s > 0
  }).length
  const busesAtStop = buses.length - busesLive.length
  const topLiveRoutes = routes
    .map((r) => ({ route: r, bus: liveBusOf(r.id) }))
    .filter((x): x is { route: Route; bus: Bus } => x.bus != null)
    .slice(0, 5)

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) ?? null
  const routeBuses = selectedRoute ? buses.filter((b) => b.route_id === selectedRoute.id) : []
  // Prefer the live bus on this route; fall back to the first bus on it
  const routeBus =
    routeBuses.find((b) => isBusLive(b, now)) ?? routeBuses[0] ?? null
  const routeDrivers = selectedRoute
    ? drivers.filter((d) => d.route_id === selectedRoute.id)
    : []
  const routeSpeed = speedOf(routeBus)
  const routeStatus = busStatus(routeBus, routeSpeed, now)
  const progress = selectedRoute
    ? computeStopProgress(routeBus?.current_lat ?? null, routeBus?.current_lng ?? null, selectedRoute.stops ?? [])
    : null
  const hasLocation = routeBus?.current_lat != null && routeBus?.current_lng != null
  const totalStops = selectedRoute?.stops?.length ?? 0
  const passedStops = !hasLocation
    ? 0
    : progress?.nextIndex == null
      ? totalStops
      : progress.nextIndex
  const progressPct = totalStops > 0 ? Math.round((passedStops / totalStops) * 100) : 0
  const routeEta =
    progress?.nextDistanceKm != null && routeSpeed != null && routeSpeed > 0
      ? formatEta(progress.nextDistanceKm, routeSpeed)
      : '—'

  // ---- Home filter --------------------------------------------------------
  // No search box — only 4–5 routes, so the grid lists all of them.
  const filteredRoutes = routes.filter((r) => {
    const rBuses = buses.filter((b) => b.route_id === r.id)
    if (filter === 'live' && !rBuses.some((b) => isBusLive(b, now))) return false
    if (filter === 'offline' && rBuses.some((b) => isBusLive(b, now))) return false
    return true
  })
  const liveRouteCount = routes.filter((r) =>
    buses.some((b) => b.route_id === r.id && isBusLive(b, now)),
  ).length

  return (
    <main className="min-h-screen w-full bg-[#0a0f1e] text-slate-100">
      {/* Top nav */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-[#0a0f1e]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" onClick={() => setSelectedRouteId(null)} className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-slate-950">
              <BusIcon />
            </span>
            <span className="leading-tight">
              <span className="block text-base font-bold text-white">CUVAS Bus Tracking</span>
              <span className="block text-[11px] tracking-wider text-slate-400">LIVE GPS · BAHAWALPUR</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-slate-300 md:flex">
            <Link href="/" onClick={() => setSelectedRouteId(null)} className="hover:text-white">Home</Link>
            <a
              href="#live-tracker"
              onClick={(e) => {
                e.preventDefault()
                document.getElementById('live-tracker')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="hover:text-white"
            >
              Live Buses
            </a>
            <Link href="/routes" className="hover:text-white">Routes</Link>
            <Link href="/admin" className="hover:text-white">Admin</Link>
          </nav>
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${live ? 'bg-green-500/15 text-green-400' : 'bg-slate-700/60 text-slate-300'}`}>
            <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-green-400' : 'bg-slate-400'}`} />
            {live ? 'LIVE' : '10s REFRESH'}
          </span>
        </div>
      </header>

      {selectedRoute == null ? (
        <>
          {/* Hero */}
          <section className="relative overflow-hidden border-b border-slate-800 bg-gradient-to-b from-[#101a33] via-[#0c1428] to-[#0a0f1e]">
            <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl" />
            <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-14">
              <div>
                <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs font-semibold tracking-wider text-slate-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                  LIVE TRACKING · UPDATED EVERY 5–10 SECONDS
                </p>
                <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight text-white sm:text-5xl">
                  Track My Bus
                  <br />
                  <span className="text-amber-400">Live Bus Tracking</span>
                  <br />
                  CUVAS University
                  <br />
                  GPS Tracker
                </h1>
                <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-400 sm:text-base">
                  See exactly where your bus is right now — live position, speed,
                  and next stop across CUVAS routes. Free, no login, no app needed.
                </p>
                <p className="mt-5 text-xs text-slate-500">
                  Free for students · No login · Works on slow networks
                </p>
              </div>

              {/* Live network status */}
              <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-bold tracking-wider text-slate-300">LIVE NETWORK STATUS</h2>
                  <span className="text-[11px] text-slate-500">
                    Updated {lastRefresh ? lastRefresh.toLocaleTimeString() : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-green-500/10 p-3 text-center">
                    <p className="text-2xl font-extrabold text-green-400">{busesMoving}</p>
                    <p className="text-[11px] tracking-wide text-slate-400">MOVING</p>
                  </div>
                  <div className="rounded-xl bg-amber-500/10 p-3 text-center">
                    <p className="text-2xl font-extrabold text-amber-400">{busesAtStop}</p>
                    <p className="text-[11px] tracking-wide text-slate-400">AT STOP</p>
                  </div>
                  <div className="rounded-xl bg-blue-500/10 p-3 text-center">
                    <p className="text-2xl font-extrabold text-blue-400">{buses.length}</p>
                    <p className="text-[11px] tracking-wide text-slate-400">IN SERVICE</p>
                  </div>
                </div>
                <h3 className="mt-5 mb-2 text-xs font-bold tracking-wider text-slate-300">TOP LIVE ROUTES</h3>
                {loading ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : topLiveRoutes.length === 0 ? (
                  <p className="text-sm text-slate-500">No buses live right now.</p>
                ) : (
                  <ul className="space-y-2">
                    {topLiveRoutes.map(({ route, bus }) => {
                      const s = speedOf(bus)
                      const st = busStatus(bus, s, now)
                      return (
                        <li key={route.id}>
                          <button
                            onClick={() => setSelectedRouteId(route.id)}
                            className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-left hover:border-amber-500/50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-white">{route.name}</span>
                              <span className="block truncate text-xs text-slate-400">
                                {bus.drivers?.name ?? 'No driver'} · {bus.plate_number}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-sm font-bold text-blue-400">
                                {s != null ? `${s} km/h` : '—'}
                              </span>
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.badge}`}>
                                {st.label}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
                <Link
                  href="/routes"
                  className="mt-3 block text-center text-xs font-semibold text-amber-400 hover:text-amber-300"
                >
                  View All {routes.length} Routes →
                </Link>
              </aside>
            </div>
          </section>

          {/* Live tracker grid */}
          <section id="live-tracker" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-8 sm:px-6">
            <h2 className="text-2xl font-extrabold text-white">CUVAS Buses <span className="text-amber-400">GPS Map</span></h2>
            <p className="mt-1 text-sm text-slate-400">
              See every bus on a live map with position, speed, and next stop.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {([
                ['all', `All (${routes.length})`],
                ['live', `Live (${liveRouteCount})`],
                ['offline', `Offline (${routes.length - liveRouteCount})`],
              ] as [Filter, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    filter === key
                      ? 'bg-amber-500 text-slate-950'
                      : 'border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <p className="mt-6 text-slate-400">Loading routes…</p>
            ) : routes.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
                No routes yet — the admin adds them.
              </p>
            ) : filteredRoutes.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
                No routes match your search
              </p>
            ) : (
              <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredRoutes.map((r) => {
                  const rDrivers = drivers.filter((d) => d.route_id === r.id)
                  const rBuses = buses.filter((b) => b.route_id === r.id)
                  const bus = rBuses.find((b) => isBusLive(b, now)) ?? rBuses[0] ?? null
                  const s = speedOf(bus)
                  const st = busStatus(bus, s, now)
                  const p = computeStopProgress(bus?.current_lat ?? null, bus?.current_lng ?? null, r.stops ?? [])
                  const eta =
                    p.nextDistanceKm != null && s != null && s > 0
                      ? formatEta(p.nextDistanceKm, s)
                      : '—'
                  const nextStop =
                    p.nextIndex != null ? r.stops[p.nextIndex].name : bus ? 'End of route' : '—'
                  return (
                    <li key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          onClick={() => setSelectedRouteId(r.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <h3 className="truncate text-base font-bold text-white hover:text-amber-400">{r.name}</h3>
                          <p className="truncate text-xs text-slate-400">
                            {r.start_point ?? '—'} → {r.end_point ?? '—'}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">
                            Driver: {rDrivers.length
                              ? rDrivers.map((d) => `${d.name}${d.phone ? ` (${d.phone})` : ''}`).join(', ')
                              : 'Not assigned'}
                            {bus ? ` · ${bus.plate_number}` : ''}
                          </p>
                        </button>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.badge}`}>
                          {st.label}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-blue-600/90 px-3 py-2">
                          <p className="text-[10px] font-semibold tracking-wider text-blue-100">SPEED</p>
                          <p className="text-lg leading-tight font-extrabold text-white">
                            {s != null ? s : '—'}
                            <span className="ml-1 text-xs font-semibold text-blue-200">km/h</span>
                          </p>
                        </div>
                        <div className="rounded-lg bg-red-600/90 px-3 py-2">
                          <p className="text-[10px] font-semibold tracking-wider text-red-100">ETA · NEXT STOP</p>
                          <p className="text-lg leading-tight font-extrabold text-white">{eta}</p>
                        </div>
                      </div>

                      <p className="mt-3 text-xs text-slate-400">
                        Next stop: <span className="font-semibold text-slate-200">{nextStop}</span>
                        {p.nextDistanceKm != null && (
                          <span> · {formatDistance(p.nextDistanceKm)} away</span>
                        )}
                      </p>

                      <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-400">
                        {r.stops?.length ?? 0} stops ·{' '}
                        <Link href="/routes" className="font-semibold text-amber-400 hover:text-amber-300">
                          See all stops →
                        </Link>
                      </p>

                      <button
                        onClick={() => setSelectedRouteId(r.id)}
                        className="mt-3 w-full rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-amber-500 hover:text-amber-400"
                      >
                        Track Live on Map
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <button
            onClick={() => setSelectedRouteId(null)}
            className="mb-4 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-slate-500"
          >
            ← All routes
          </button>

          {/* Detail header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold text-white sm:text-3xl">{selectedRoute.name}</h1>
              <p className="mt-1 text-sm text-slate-400">
                {selectedRoute.start_point ?? '—'} → {selectedRoute.end_point ?? '—'}
                {' · '}Driver: {routeDrivers.length ? routeDrivers.map((d) => d.name).join(', ') : 'Not assigned'}
                {routeBus ? ` · Bus ${routeBus.plate_number}` : ''}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${routeStatus.badge}`}>
              {routeStatus.label}
              {routeBus ? ` · updated ${timeAgo(routeBus.last_updated, now)}` : ''}
            </span>
          </div>

          {/* Stat row */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[11px] font-semibold tracking-wider text-slate-400">SPEED</p>
              <p className="mt-1 text-lg font-extrabold text-white">
                {routeSpeed != null ? (routeSpeed === 0 ? 'Stationary' : `${routeSpeed} km/h`) : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[11px] font-semibold tracking-wider text-slate-400">STATUS</p>
              <p className="mt-1 text-lg font-extrabold text-white">{routeStatus.label}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[11px] font-semibold tracking-wider text-slate-400">NEXT STOP</p>
              <p className="mt-1 truncate text-lg font-extrabold text-white">
                {progress?.nextIndex != null
                  ? selectedRoute.stops[progress.nextIndex].name
                  : routeBus == null
                    ? '—'
                    : hasLocation
                      ? 'End of route'
                      : 'Waiting…'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[11px] font-semibold tracking-wider text-slate-400">ETA</p>
              <p className="mt-1 text-lg font-extrabold text-white">{routeEta}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <p className="text-[11px] font-semibold tracking-wider text-slate-400">LAST UPDATE</p>
              <p className="mt-1 text-lg font-extrabold text-white">
                {routeBus ? timeAgo(routeBus.last_updated, now) : '—'}
              </p>
            </div>
          </div>

          {/* Live position map */}
          <div ref={mapWrapRef} className="mt-5 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2.5">
              <h2 className="text-sm font-bold text-white">Live Position</h2>
              <span className="flex items-center gap-3">
                <span className="text-xs text-slate-400">
                  Updated {routeBus?.last_updated ? new Date(routeBus.last_updated).toLocaleTimeString() : '—'}
                  {live ? ' · Real time' : ' · 10s refresh'}
                </span>
                <button
                  onClick={toggleFullscreen}
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500"
                >
                  ⛶ Full Screen
                </button>
              </span>
            </div>
            <BusMap key={selectedRoute.id} buses={routeBuses} stops={selectedRoute.stops ?? []} />
          </div>

          {/* Live status / journey progress / live speed */}
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <h3 className="text-xs font-bold tracking-wider text-slate-300">⚡ LIVE STATUS</h3>
              <dl className="mt-3 space-y-2.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Status</dt>
                  <dd className="font-semibold text-white">{routeStatus.label}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Speed</dt>
                  <dd className="font-semibold text-white">
                    {routeSpeed != null ? `${routeSpeed} km/h` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Prev stop</dt>
                  <dd className="text-right font-semibold text-white">
                    {progress?.prevIndex != null ? selectedRoute.stops[progress.prevIndex].name : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Next stop</dt>
                  <dd className="text-right font-semibold text-white">
                    {progress?.nextIndex != null ? selectedRoute.stops[progress.nextIndex].name : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Updated</dt>
                  <dd className="font-semibold text-white">
                    {routeBus
                      ? `${timeAgo(routeBus.last_updated, now)} · ${routeBus.last_updated ? new Date(routeBus.last_updated).toLocaleTimeString() : ''}`
                      : '—'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <h3 className="text-xs font-bold tracking-wider text-slate-300">JOURNEY PROGRESS</h3>
              <div className="mt-3 flex items-end gap-2">
                <p className="text-3xl font-extrabold text-white">{progressPct}%</p>
                <p className="pb-1 text-xs text-slate-400">
                  {passedStops} of {totalStops} stops passed
                </p>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="mt-3 text-sm text-slate-400">
                {selectedRoute.start_point ?? '—'} → {selectedRoute.end_point ?? '—'}
              </p>
              {progress?.atStop && progress.prevIndex != null && (
                <p className="mt-1 text-sm font-semibold text-green-400">
                  Bus is at {selectedRoute.stops[progress.prevIndex].name} now
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <h3 className="text-xs font-bold tracking-wider text-slate-300">LIVE SPEED</h3>
              <p className="mt-3 text-4xl font-extrabold text-white">
                {routeSpeed != null ? routeSpeed : '—'}
                <span className="ml-1 text-base font-semibold text-slate-400">km/h</span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Speed comes from the driver&apos;s GPS. It shows 0 while the bus
                stands at a stop, and — until the driver app starts sending location.
              </p>
            </div>
          </div>

          {/* All stops */}
          <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-white">All Stops</h3>
            <p className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" /> Passed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> Next stop
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" /> Upcoming
              </span>
            </p>
          </div>
          {totalStops === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
              No stops added for this route yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900 text-xs tracking-wider text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">#</th>
                    <th className="px-4 py-2.5 font-semibold">STOP</th>
                    <th className="px-4 py-2.5 font-semibold">DISTANCE</th>
                    <th className="px-4 py-2.5 text-right font-semibold">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRoute.stops.map((s, i) => {
                    const isNext = progress?.nextIndex === i
                    const passed =
                      hasLocation && (progress?.nextIndex == null ? true : i < progress.nextIndex)
                    const dist =
                      hasLocation && s.lat != null && s.lng != null && routeBus?.current_lat != null && routeBus?.current_lng != null
                        ? haversineKm(routeBus.current_lat, routeBus.current_lng, s.lat, s.lng)
                        : null
                    return (
                      <tr key={`${s.name}-${i}`} className={`border-b border-slate-800/60 last:border-0 ${isNext ? 'bg-amber-500/10' : ''}`}>
                        <td className="px-4 py-2.5 text-slate-400">{i + 1}</td>
                        <td className={`px-4 py-2.5 font-medium ${isNext ? 'text-amber-300' : 'text-white'}`}>{s.name}</td>
                        <td className="px-4 py-2.5 text-slate-300">{dist != null ? formatDistance(dist) : '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          {passed ? (
                            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-400">Passed</span>
                          ) : isNext ? (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">Next stop</span>
                          ) : (
                            <span className="rounded-full bg-slate-700/60 px-2 py-0.5 text-xs font-semibold text-slate-300">Upcoming</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-slate-500">
            Route: {selectedRoute.start_point ?? '—'} → {selectedRoute.end_point ?? '—'} · {totalStops} stops ·{' '}
            {routeDrivers.length ? `Driver ${routeDrivers.map((d) => d.name).join(', ')}` : 'No driver assigned'}
            {routeBus ? ` · Bus ${routeBus.plate_number}` : ''}
          </p>
        </section>
      )}

      <Toasts />
    </main>
  )
}
