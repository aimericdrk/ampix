import { useTheme } from '../../lib/theme';
import { Button } from '../ui/button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={toggleTheme}
      aria-pressed={theme === 'dark'}
    >
      {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    </Button>
  );
}
