'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { showToast } from '@/lib/toast'
import type { Bus, Driver, Route } from '@/lib/types'
import ConfirmDialog from '@/components/ConfirmDialog'

const inputCls =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500'
const labelCls = 'mb-1 block text-sm font-medium'
const btnCls =
  'rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'

function EditDriverModal({
  driver,
  routes,
  buses,
  onClose,
  onSaved,
}: {
  driver: Driver
  routes: Route[]
  buses: Bus[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(driver.name)
  const [phone, setPhone] = useState(driver.phone ?? '')
  const [routeId, setRouteId] = useState(driver.route_id ?? '')
  const [busId, setBusId] = useState(driver.bus_id ?? '')
  const [status, setStatus] = useState(driver.status)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Only buses that are free, this driver's own, or already assigned to them
  const availableBuses = buses.filter(
    (b) => b.driver_id == null || b.driver_id === driver.id || b.id === driver.bus_id,
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Driver name is required.')
      return
    }
    setBusy(true)
    const { error } = await supabase
      .from('drivers')
      .update({
        name: name.trim(),
        phone: phone.trim() || null,
        route_id: routeId || null,
        bus_id: busId || null,
        status,
      })
      .eq('id', driver.id)
    if (error) {
      showToast(error.message, 'error')
      setBusy(false)
      return
    }
    // Keep the other direction in sync: buses.driver_id
    const oldBusId = driver.bus_id ?? ''
    if (busId !== oldBusId) {
      if (oldBusId) {
        await supabase.from('buses').update({ driver_id: null }).eq('id', oldBusId)
      }
      if (busId) {
        const { error: busError } = await supabase
          .from('buses')
          .update({ driver_id: driver.id })
          .eq('id', busId)
        if (busError) {
          showToast(busError.message, 'error')
          setBusy(false)
          return
        }
      }
    }
    setBusy(false)
    showToast('Driver updated.')
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5"
      >
        <h3 className="mb-4 text-lg font-semibold">Edit driver</h3>
        <div className="space-y-3">
          <div>
            <label className={labelCls} htmlFor="edit-driver-name">
              Name *
            </label>
            <input
              id="edit-driver-name"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="edit-driver-phone">
              Phone number
            </label>
            <input
              id="edit-driver-phone"
              className={inputCls}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="edit-driver-route">
              Route
            </label>
            <select
              id="edit-driver-route"
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
          <div>
            <label className={labelCls} htmlFor="edit-driver-bus">
              Assigned bus
            </label>
            <select
              id="edit-driver-bus"
              className={inputCls}
              value={busId}
              onChange={(e) => setBusId(e.target.value)}
            >
              <option value="">No bus yet</option>
              {availableBuses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.plate_number}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="edit-driver-status">
              Status
            </label>
            <select
              id="edit-driver-status"
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="on_duty">On duty</option>
              <option value="off_duty">Off duty</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className={btnCls} disabled={busy}>
              {busy ? 'Saving...' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-zinc-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default function DriversSection({
  drivers,
  routes,
  buses,
  onUpdated,
}: {
  drivers: Driver[]
  routes: Route[]
  buses: Bus[]
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState<Driver | null>(null)
  const [deleting, setDeleting] = useState<Driver | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    const { error } = await supabase.from('drivers').delete().eq('id', deleting.id)
    setDeleteBusy(false)
    if (error) {
      showToast(error.message, 'error')
      setDeleting(null)
      return
    }
    setDeleting(null)
    showToast('Driver deleted.')
    onUpdated()
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Drivers ({drivers.length})</h2>
      {drivers.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
          No drivers yet — add one below.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {drivers.map((d) => (
            <li key={d.id} className="rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{d.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    d.status === 'on_duty'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {d.status === 'on_duty' ? 'On duty' : 'Off duty'}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-600">
                {d.phone ?? 'No phone'} · {d.routes?.name ?? 'No route'}
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                Bus: {d.buses?.plate_number ?? 'None'}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditing(d)}
                  className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => setDeleting(d)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <EditDriverModal
          driver={editing}
          routes={routes}
          buses={buses}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onUpdated()
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete driver?"
          message={`Are you sure? "${deleting.name}" will be deleted. Any bus assigned to them will be kept, but unassigned.`}
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
