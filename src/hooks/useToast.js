import { useState, useCallback } from 'react'

export function useToast() {
  const [msg, setMsg] = useState('')
  const show = useCallback((m) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 3200)
  }, [])
  const Toast = () => (msg ? <div className="toast">{msg}</div> : null)
  return { show, Toast }
}
