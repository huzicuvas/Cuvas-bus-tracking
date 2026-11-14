'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Route } from '@/lib/types'
import ConfirmDialog from '@/components/ConfirmDialog'

export default function RoutesSection({
  routes,
  onUpdated,
}: {
  routes: Route[]
  onUpdated: () => void
}) {
  const [deleting, setDeleting] = useState<Route | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError('')
    const { error } = await supabase.from('routes').delete().eq('id', deleting.id)
    setDeleteBusy(false)
    if (error) {
      setDeleteError(error.message)
      setDeleting(null)
      return
    }
    setDeleting(null)
    onUpdated()
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">Routes ({routes.length})</h2>
      {deleteError && <p className="mb-3 text-sm text-red-600">{deleteError}</p>}
      {routes.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-zinc-500">
          No routes yet — add one below.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {routes.map((r) => (
            <li key={r.id} className="rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.name}</span>
                <button
                  onClick={() => setDeleting(r)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
              <p className="mt-1 text-sm text-zinc-600">
                {r.start_point ?? '—'} → {r.end_point ?? '—'}
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                Stops ({r.stops?.length ?? 0}):{' '}
                {r.stops?.length
                  ? r.stops.map((s) => s.name).join(', ')
                  : 'none listed'}
              </p>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete route?"
          message={`Are you sure? "${deleting.name}" will be deleted. Drivers and buses on this route will be kept, but unassigned from it.`}
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
