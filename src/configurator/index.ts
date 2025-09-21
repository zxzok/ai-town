import React from 'react';
import ConfiguratorPage from './ConfiguratorPage';

function normalize(pathname: string): string {
  if (!pathname) {
    return '/';
  }
  return pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
}

export function isConfiguratorRoute(pathname: string): boolean {
  const normalized = normalize(pathname);
  return normalized === '/configurator' || normalized.endsWith('/configurator');
}

export function renderConfiguratorRoute(pathname: string): React.ReactElement | null {
  if (isConfiguratorRoute(pathname)) {
    return <ConfiguratorPage />;
  }
  return null;
}
