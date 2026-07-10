import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Checkbox } from './checkbox';
import { Label } from './label';
import { Segmented } from './segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import { Switch } from './switch';
import { Textarea } from './textarea';

describe('Checkbox', () => {
  it('toggles aria-checked on click', async () => {
    render(<Checkbox aria-label="Accept terms" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Accept terms' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Switch', () => {
  it('toggles on click', async () => {
    render(<Switch aria-label="Enable notifications" />);
    const toggle = screen.getByRole('switch', { name: 'Enable notifications' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Select', () => {
  it('opens and selects an option', async () => {
    render(
      <Select defaultValue="usa">
        <SelectTrigger aria-label="Country">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="usa">United States</SelectItem>
          <SelectItem value="fra">France</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Country' });
    await userEvent.click(trigger);
    const option = await screen.findByRole('option', { name: 'France' });
    await userEvent.click(option, { pointerEventsCheck: 0 });
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('France');
  });
});

describe('Segmented', () => {
  function ControlledSegmented() {
    const [value, setValue] = useState('day');
    return (
      <Segmented
        aria-label="Range"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
        ]}
      />
    );
  }

  it('switches value on click', async () => {
    const onValueChange = vi.fn();
    render(
      <Segmented
        aria-label="Range"
        value="day"
        onValueChange={onValueChange}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    expect(onValueChange).toHaveBeenCalledWith('week');
  });

  it('reflects the checked option via aria-checked when controlled', async () => {
    render(<ControlledSegmented />);
    const week = screen.getByRole('radio', { name: 'Week' });
    expect(week).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(week);
    expect(week).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Textarea', () => {
  it('accepts typed text', async () => {
    render(<Textarea aria-label="Bio" />);
    const textarea = screen.getByRole('textbox', { name: 'Bio' });
    await userEvent.type(textarea, 'Building analytics tools.');
    expect(textarea).toHaveValue('Building analytics tools.');
  });
});

describe('Label', () => {
  it('associates with its field via htmlFor', () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <input id="email" type="email" />
      </>,
    );
    expect(screen.getByLabelText('Email')).toBeInstanceOf(HTMLInputElement);
  });
});
