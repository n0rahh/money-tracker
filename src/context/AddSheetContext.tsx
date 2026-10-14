import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Transaction } from '../lib/types'

export type AddSheetState = { open: boolean; editing: Transaction | null }
type AddSheetApi = {
  state: AddSheetState
  openAdd: () => void
  openEdit: (tx: Transaction) => void
  close: () => void
}
const AddSheetContext = createContext<AddSheetApi | null>(null)

export function AddSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AddSheetState>({ open: false, editing: null })
  const openAdd = useCallback(() => setState({ open: true, editing: null }), [])
  const openEdit = useCallback((tx: Transaction) => setState({ open: true, editing: tx }), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  const api = useMemo(() => ({ state, openAdd, openEdit, close }), [state, openAdd, openEdit, close])
  return <AddSheetContext.Provider value={api}>{children}</AddSheetContext.Provider>
}

export function useAddSheet(): AddSheetApi {
  const ctx = useContext(AddSheetContext)
  if (!ctx) throw new Error('useAddSheet must be used within AddSheetProvider')
  return ctx
}
