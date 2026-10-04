'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const noopSubscribe = () => () => {};

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  // true solo en el cliente: el tema real no se conoce durante el render del servidor
  const mounted = React.useSyncExternalStore(noopSubscribe, () => true, () => false);

  if (!mounted) {
    return <div className="w-9 h-9" />;
  }

  return (
    <button
      onClick={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')}
      className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
      aria-label="Cambiar tema claro/oscuro"
    >
      {resolvedTheme === 'light' ? (
        <Moon className="w-5 h-5 text-zinc-600" />
      ) : (
        <Sun className="w-5 h-5 text-zinc-400" />
      )}
    </button>
  );
}
