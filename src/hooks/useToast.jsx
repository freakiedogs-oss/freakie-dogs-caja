import { useState, useCallback, useMemo } from 'react'

/**
 * Hook unificado de toasts con variantes (success/error/warning/info).
 *
 * API retro-compatible:
 *   const { show, Toast } = useToast()
 *   show('Mensaje')           // muestra toast neutro (info)
 *
 * API extendida (reemplazo de alert()):
 *   const { success, error, warning, info, Toast } = useToast()
 *   error('Algo falló')
 *   success('Guardado!')
 *   warning('Atención: ...')
 *   info('FYI: ...')
 *
 * También se expone como objeto `toast` para usar como:
 *   const toast = useToast()
 *   toast.error('...')
 *   toast.success('...')
 */
export function useToast() {
  const [state, setState] = useState({ msg: '', type: 'info' })

  const showWithType = useCallback((m, type = 'info') => {
    setState({ msg: m, type })
    // Errores/warnings duran un poco más para asegurar visibilidad
    const duration = type === 'error' ? 5000 : type === 'warning' ? 4200 : 3200
    setTimeout(() => setState({ msg: '', type: 'info' }), duration)
  }, [])

  const show = useCallback((m) => showWithType(m, 'info'), [showWithType])
  const success = useCallback((m) => showWithType(m, 'success'), [showWithType])
  const error = useCallback((m) => showWithType(m, 'error'), [showWithType])
  const warning = useCallback((m) => showWithType(m, 'warning'), [showWithType])
  const info = useCallback((m) => showWithType(m, 'info'), [showWithType])

  const Toast = useCallback(() => {
    if (!state.msg) return null
    const stylesByType = {
      success: { background: '#0f5132', borderColor: '#198754', color: '#d1e7dd' },
      error:   { background: '#58151c', borderColor: '#dc3545', color: '#f8d7da' },
      warning: { background: '#664d03', borderColor: '#ffc107', color: '#fff3cd' },
      info:    { background: '#1e1e1e', borderColor: '#333',   color: '#f0f0f0' },
    }
    const style = stylesByType[state.type] || stylesByType.info
    return (
      <div className="toast" style={style} role={state.type === 'error' ? 'alert' : 'status'} aria-live={state.type === 'error' ? 'assertive' : 'polite'}>
        {state.msg}
      </div>
    )
  }, [state])

  // Permite usar el hook como: const toast = useToast(); toast.error('...')
  // Y también: const { show, error, success, Toast } = useToast()
  return useMemo(() => ({
    show,
    success,
    error,
    warning,
    info,
    Toast,
  }), [show, success, error, warning, info, Toast])
}
