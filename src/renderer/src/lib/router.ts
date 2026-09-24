import { useSyncExternalStore } from 'react'

type Listener = () => void
const listeners = new Set<Listener>()

window.addEventListener('hashchange', () => listeners.forEach((l) => l()))

function getHash(): string {
  return location.hash || '#/home'
}

export function useHashRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getHash
  )
}

export function navigate(hash: string): void {
  if (location.hash === hash) return
  location.hash = hash
}
