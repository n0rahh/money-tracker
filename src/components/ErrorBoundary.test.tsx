import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Broken(): never {
  throw new Error('render failed')
}

afterEach(() => {
  vi.restoreAllMocks() // the console.error spy
})

describe('ErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    render(<ErrorBoundary><p>Home</p></ErrorBoundary>)
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('replaces a crashed tree with a reload panel and logs the error', () => {
    // Expected output: React and the boundary both report the caught error.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Broken /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled()
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'render failed' }), expect.any(String))
  })
})
