'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/toast'
import { isBusLive } from '@/lib/live'
import type { Bus, Driver, Route } from '@/lib/types'
import Toasts from '@/components/Toasts'

// Route directory: every route one by one — bus number, driver, and the
// FULL numbered stop list, so anyone can see which route goes where.
// Live tracking lives on the home page; each route links straight to it.
export default function RoutesPage() {
  const [buses, setBuses] = useState<Bus[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState<number | null>(null)

  const fetchAll = useCallback(async () => {
    const [busesRes, routesRes, driversRes] = await Promise.all([
      supabase.from('buses').select('*').order('plate_number', { ascending: true }),
      supabase.from('routes').select('*').order('name', { ascending: true }),
      supabase.from('drivers').select('*').order('name', { ascending: true }),
    ])
    if (busesRes.error || routesRes.error || driversRes.error) {
      showToast('Could not load routes. Check your connection and refresh.', 'error')
    } else {
      setBuses((busesRes.data ?? []) as Bus[])
      setRoutes((routesRes.data ?? []) as Route[])
      setDrivers((driversRes.data ?? []) as Driver[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // Clock tick only — re-renders every 10s so Running / Offline flips on time
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(id)
  }, [])

  return (
    <main className="min-h-screen w-full bg-[#0a0f1e] text-slate-100">
      {/* Top nav */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-[#0a0f1e]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-slate-950">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M3 10h18" />
                <path d="M7 20v-2M17 20v-2" />
                <circle cx="8" cy="18" r="1.4" fill="currentColor" stroke="none" />
                <circle cx="16" cy="18" r="1.4" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-base font-bold text-white">CUVAS Bus Tracking</span>
              <span className="block text-[11px] tracking-wider text-slate-400">LIVE GPS · BAHAWALPUR</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-slate-300 md:flex">
            <Link href="/" className="hover:text-white">Home</Link>
            <Link href="/#live-tracker" className="hover:text-white">Live Buses</Link>
            <Link href="/routes" className="font-semibold text-white">Routes</Link>
            <Link href="/admin" className="hover:text-white">Admin</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-extrabold text-white">
          All Routes <span className="text-amber-400">&amp; Stops</span>
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Every CUVAS bus route, one by one — bus number, driver, and all stops
          in order. Tap “Track live” to see that route moving right now.
        </p>

        {loading ? (
          <p className="mt-6 text-slate-400">Loading routes…</p>
        ) : routes.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
            No routes yet — the admin adds them.
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {routes.map((r) => {
              const rDrivers = drivers.filter((d) => d.route_id === r.id)
              const rBuses = buses.filter((b) => b.route_id === r.id)
              const liveBus = rBuses.find((b) => isBusLive(b, now))
              return (
                <article key={r.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">{r.name}</h2>
                      <p className="mt-0.5 text-sm text-slate-400">
                        {r.start_point ?? '—'} → {r.end_point ?? '—'}
                      </p>
                      <p className="mt-1 text-sm text-slate-300">
                        Bus:{' '}
                        <span className="font-semibold text-white">
                          {rBuses.length ? rBuses.map((b) => b.plate_number).join(', ') : 'Not assigned'}
                        </span>
                        {' · '}Driver:{' '}
                        <span className="font-semibold text-white">
                          {rDrivers.length
                            ? rDrivers.map((d) => `${d.name}${d.phone ? ` (${d.phone})` : ''}`).join(', ')
                            : 'Not assigned'}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {liveBus ? (
                        <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-400">
                          Running now
                        </span>
                      ) : rBuses.length > 0 ? (
                        <span className="rounded-full bg-slate-700/60 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                          Offline
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-700/60 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                          No bus
                        </span>
                      )}
                      <Link
                        href={`/?route=${r.id}`}
                        className="rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                      >
                        Track live →
                      </Link>
                    </div>
                  </div>

                  {r.stops?.length ? (
                    <div className="mt-4 border-t border-slate-800 pt-3">
                      <p className="text-[11px] font-semibold tracking-wider text-slate-400">
                        ALL STOPS · {r.stops.length}
                      </p>
                      <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-200 sm:grid-cols-2">
                        {r.stops.map((s, i) => (
                          <li key={`${s.name}-${i}`} className="flex gap-2">
                            <span className="font-semibold text-amber-400">{i + 1}.</span>
                            <span>{s.name}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <p className="mt-4 border-t border-slate-800 pt-3 text-sm text-slate-500">
                      No stops added for this route yet.
                    </p>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <Toasts />
    </main>
  )
}
