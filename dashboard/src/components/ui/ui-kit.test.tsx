import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { IconButton } from './icon-button';
import { Input } from './input';
import { ToastProvider, useToast } from './toast';

describe('Button', () => {
  it('renders and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type=button and supports disabled', () => {
    render(<Button disabled>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toBeDisabled();
  });

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger');
  });

  it('applies the gradient-brand background for the primary variant', () => {
    render(<Button variant="primary">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('bg-gradient-brand');
  });
});

describe('IconButton', () => {
  it('renders with an accessible name and fires clicks', async () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Close" onClick={onClick}>
        <svg data-testid="icon" />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Close' });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Input', () => {
  it('accepts typed text and forwards aria-invalid', async () => {
    render(<Input aria-label="Email" aria-invalid={true} />);
    const input = screen.getByRole('textbox', { name: 'Email' });
    await userEvent.type(input, 'ada@example.com');
    expect(input).toHaveValue('ada@example.com');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Card', () => {
  it('renders header and content', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Demo App</CardTitle>
        </CardHeader>
        <CardContent>Timezone: UTC</CardContent>
      </Card>,
    );
    expect(screen.getByText('Demo App')).toBeInTheDocument();
    expect(screen.getByText('Timezone: UTC')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('opens on trigger click and closes with the close button', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Open settings</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>Manage SDK tokens.</DialogDescription>
          <DialogClose asChild>
            <Button>Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Project settings')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Toast', () => {
  function ToastProbe() {
    const { toast } = useToast();
    return (
      <Button onClick={() => toast({ title: 'Saved', description: 'Report saved.' })}>
        notify
      </Button>
    );
  }

  it('renders a toast when triggered', async () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'notify' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Report saved.')).toBeInTheDocument();
  });

  it('removes a toast from the DOM when dismissed via the Radix escape-key close mechanism', async () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'notify' }));
    const title = await screen.findByText('Saved');
    const toastRoot = title.closest('li');
    if (!toastRoot) throw new Error('expected toast root <li> to be rendered');
    fireEvent.keyDown(toastRoot, { key: 'Escape' });
    await waitFor(() => expect(toastRoot).not.toBeInTheDocument());
    expect(screen.queryByText('Report saved.')).not.toBeInTheDocument();
  });

  it('throws when useToast is used outside the provider', () => {
    expect(() => render(<ToastProbe />)).toThrow('useToast must be used inside <ToastProvider>');
  });
});
