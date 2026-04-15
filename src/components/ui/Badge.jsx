import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        outline: 'text-foreground border-border',
        success: 'border-transparent bg-success/20 text-success',
        warning: 'border-transparent bg-warning/20 text-warning',
        info: 'border-transparent bg-blue-500/20 text-blue-400',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

// Map of estado → variant for backward compatibility
const ESTADO_VARIANT_MAP = {
  enviado: 'warning',
  aprobado: 'success',
  preparando: 'info',
  despachado: 'warning',
  en_ruta: 'warning',
  recibido: 'success',
  cancelado: 'muted',
  pendiente: 'warning',
  borrador: 'muted',
  activo: 'success',
  inactivo: 'muted',
  rechazado: 'destructive',
  procesando: 'info',
  completado: 'success',
  error: 'destructive',
}

const ESTADO_LABEL_MAP = {
  enviado: 'Enviado',
  aprobado: 'Aprobado',
  preparando: 'Preparando',
  despachado: 'Despachado',
  en_ruta: 'En Ruta',
  recibido: 'Recibido',
  cancelado: 'Cancelado',
  pendiente: 'Pendiente',
  borrador: 'Borrador',
  activo: 'Activo',
  inactivo: 'Inactivo',
  rechazado: 'Rechazado',
  procesando: 'Procesando',
  completado: 'Completado',
  error: 'Error',
}

function Badge({ className, variant, estado, children, ...props }) {
  // Backward compat: if `estado` prop is passed, derive variant + label from it
  if (estado !== undefined) {
    const resolvedVariant = ESTADO_VARIANT_MAP[estado] || 'muted'
    const resolvedLabel = ESTADO_LABEL_MAP[estado] || estado || '—'
    return (
      <span className={cn(badgeVariants({ variant: resolvedVariant }), className)} {...props}>
        {resolvedLabel}
      </span>
    )
  }

  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
