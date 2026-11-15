'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/toast'
import type { Route, RouteStop } from '@/lib/types'

const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500'
const labelCls = 'mb-1 block text-sm font-medium'
const btnCls =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'

// One stop per line: "Stop name" or "Stop name, lat, lng"
function parseStops(text: string): RouteStop[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim())
      const lat = Number(parts[1])
      const lng = Number(parts[2])
      if (parts.length >= 3 && !Number.isNaN(lat) && !Number.isNaN(lng)) {
        return { name: parts[0], lat, lng }
      }
      return { name: line }
    })
}

function RouteForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [startPoint, setStartPoint] = useState('')
  const [endPoint, setEndPoint] = useState('')
  const [departureTime, setDepartureTime] = useState('')
  const [stopsText, setStopsText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Route name is required.')
      return
    }
    if (departureTime.trim() && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(departureTime.trim())) {
      setError('Departure time must be HH:MM, e.g. 07:00.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('routes').insert({
      name: name.trim(),
      start_point: startPoint.trim() || null,
      end_point: endPoint.trim() || null,
      departure_time: departureTime.trim() || null,
      stops: parseStops(stopsText),
    })
    setBusy(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    setName('')
    setStartPoint('')
    setEndPoint('')
    setDepartureTime('')
    setStopsText('')
    showToast('Route added.')
    onAdded()
  }

  return (
    <form onSubmit={submit} className="rounded-xl border p-4">
      <h3 className="mb-3 font-semibold">Add route</h3>
      <div className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="route-name">
            Route name *
          </label>
          <input
            id="route-name"
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bahawalpur City - CUVAS"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="route-start">
            Start point
          </label>
          <input
            id="route-start"
            className={inputCls}
            value={startPoint}
            onChange={(e) => setStartPoint(e.target.value)}
            placeholder="Bahawalpur City"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="route-end">
            End point
          </label>
          <input
            id="route-end"
            className={inputCls}
            value={endPoint}
            onChange={(e) => setEndPoint(e.target.value)}
            placeholder="CUVAS campus"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="route-departure">
            Departure time (24-hour, e.g. 07:00 — when the bus leaves its start point)
          </label>
          <input
            id="route-departure"
            className={inputCls}
            value={departureTime}
            onChange={(e) => setDepartureTime(e.target.value)}
            placeholder="07:00"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="route-stops">
            Stops (one per line: name, or name, lat, lng)
          </label>
          <textarea
            id="route-stops"
            className={inputCls}
            rows={3}
            value={stopsText}
            onChange={(e) => setStopsText(e.target.value)}
            placeholder={'Library Chowk, 29.40, 71.68\nRailway Station'}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={btnCls} disabled={busy}>
          {busy ? 'Adding...' : 'Add route'}
        </button>
      </div>
    </form>
  )
}

function DriverForm({ routes, onAdded }: { routes: Route[]; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [routeId, setRouteId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Driver name is required.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('drivers').insert({
      name: name.trim(),
      phone: phone.trim() || null,
      route_id: routeId || null,
    })
    setBusy(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    setName('')
    setPhone('')
    setRouteId('')
    showToast('Driver added.')
    onAdded()
  }

  return (
    <form onSubmit={submit} className="rounded-xl border p-4">
      <h3 className="mb-3 font-semibold">Add driver</h3>
      <div className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="driver-name">
            Name *
          </label>
          <input
            id="driver-name"
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Driver name"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="driver-phone">
            Phone number
          </label>
          <input
            id="driver-phone"
            className={inputCls}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="03xx-xxxxxxx"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="driver-route">
            Route
          </label>
          <select
            id="driver-route"
            className={inputCls}
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
          >
            <option value="">No route yet</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={btnCls} disabled={busy}>
          {busy ? 'Adding...' : 'Add driver'}
        </button>
      </div>
    </form>
  )
}

function BusForm({ routes, onAdded }: { routes: Route[]; onAdded: () => void }) {
  const [plate, setPlate] = useState('')
  const [routeId, setRouteId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!plate.trim()) {
      setError('Plate number is required.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('buses').insert({
      plate_number: plate.trim(),
      route_id: routeId || null,
    })
    setBusy(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    setPlate('')
    setRouteId('')
    showToast('Bus added.')
    onAdded()
  }

  return (
    <form onSubmit={submit} className="rounded-xl border p-4">
      <h3 className="mb-3 font-semibold">Add bus</h3>
      <div className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="bus-plate">
            Plate number *
          </label>
          <input
            id="bus-plate"
            className={inputCls}
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            placeholder="BWP-123"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="bus-route">
            Route
          </label>
          <select
            id="bus-route"
            className={inputCls}
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
          >
            <option value="">No route yet</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={btnCls} disabled={busy}>
          {busy ? 'Adding...' : 'Add bus'}
        </button>
      </div>
    </form>
  )
}

export default function AdminForms({
  routes,
  onAdded,
}: {
  routes: Route[]
  onAdded: () => void
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Admin — add new</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <RouteForm onAdded={onAdded} />
        <DriverForm routes={routes} onAdded={onAdded} />
        <BusForm routes={routes} onAdded={onAdded} />
      </div>
    </section>
  )
}
