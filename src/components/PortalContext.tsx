import * as React from 'react';

const PortalContainerContext = React.createContext<HTMLElement | null>(null);

export interface PortalProviderProps {
  /**
   * The app-shell DOM element into which Base UI overlays portal by default
   * (e.g. `<main className="desktag-panel-card isolate relative overflow-hidden">`).
   * Pass `null` to fall back to `document.body`.
   */
  container: HTMLElement | null;
  children: React.ReactNode;
}

export function PortalProvider({ container, children }: PortalProviderProps) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  );
}

/**
 * Returns the nearest DeskTag shell portal container element, or `null` when
 * none is mounted (causing Base UI portals to fall back to `document.body`).
 */
export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}

/**
 * Resolves the effective portal props for any coss/Base UI overlay primitive.
 * Caller-provided `portalProps.container` always wins over `usePortalContainer()`.
 */
export function useResolvedPortalProps<T extends { container?: unknown }>(
  portalProps?: T,
): {
  portalProps: T | undefined;
  isScopedContainer: boolean;
} {
  const contextContainer = usePortalContainer();
  const hasExplicitContainer = Boolean(portalProps && 'container' in portalProps);
  const effectiveContainer = hasExplicitContainer
    ? portalProps?.container
    : contextContainer;

  const isScopedContainer = Boolean(effectiveContainer);

  if (!portalProps && !contextContainer) {
    return { portalProps: undefined, isScopedContainer: false };
  }

  return {
    portalProps: {
      ...portalProps,
      ...(effectiveContainer !== undefined ? { container: effectiveContainer } : {}),
    } as T,
    isScopedContainer,
  };
}
