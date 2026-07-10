import { Moon, Sun } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useTheme } from '../../lib/theme';
import { Button } from '../ui/button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={toggleTheme}
      aria-pressed={isDark}
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
        <Sun
          aria-hidden="true"
          className={cn(
            'absolute size-4 transition-all duration-150',
            isDark ? 'rotate-90 opacity-0' : 'rotate-0 opacity-100',
          )}
        />
        <Moon
          aria-hidden="true"
          className={cn(
            'absolute size-4 transition-all duration-150',
            isDark ? 'rotate-0 opacity-100' : '-rotate-90 opacity-0',
          )}
        />
      </span>
      {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    </Button>
  );
}
