'use client'

import { useEffect, useState } from 'react'
import type { ToastType } from '@/lib/toast'

type Toast = { id: number; message: string; type: ToastType }

let nextId = 1

export default function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    function onToast(e: Event) {
      const { message, type } = (e as CustomEvent).detail as {
        message: string
        type: ToastType
      }
      const id = nextId++
      setToasts((prev) => [...prev, { id, message, type }])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 4000)
    }
    window.addEventListener('app-toast', onToast)
    return () => window.removeEventListener('app-toast', onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed right-4 bottom-4 left-4 z-[60] space-y-2 sm:left-auto sm:w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            t.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span>{t.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            aria-label="Dismiss"
            className="text-lg leading-none opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
