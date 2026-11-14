export type ToastType = 'success' | 'error'

// Any component can show a toast without prop drilling — the Toasts
// component in the page listens for this event and renders it.
export function showToast(message: string, type: ToastType = 'success') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type } }))
}
