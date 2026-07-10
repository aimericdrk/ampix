import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';
import { Button } from './button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './popover';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from './sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

describe('Tooltip', () => {
  it('shows content on focus', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button>Hover me</Button>
          </TooltipTrigger>
          <TooltipContent>Helpful hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(screen.queryAllByText('Helpful hint')).toHaveLength(0);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Hover me' })).toHaveFocus();
    expect((await screen.findAllByText('Helpful hint')).length).toBeGreaterThan(0);
  });
});

describe('DropdownMenu', () => {
  it('opens on trigger click and fires item onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const item = await screen.findByRole('menuitem', { name: 'Rename' });
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('Sheet', () => {
  it('opens and closes', async () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Open filters</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Refine the result set.</SheetDescription>
          <SheetClose asChild>
            <Button>Close</Button>
          </SheetClose>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open filters' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AlertDialog', () => {
  it('fires the confirm action', async () => {
    const onConfirm = vi.fn();
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="danger">Delete project</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this project?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="danger" onClick={onConfirm}>
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    const confirmButton = await screen.findByRole('button', { name: 'Delete' });
    await userEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

describe('Popover', () => {
  it('opens content on trigger click', async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Info</Button>
        </PopoverTrigger>
        <PopoverContent>Extra context</PopoverContent>
      </Popover>,
    );

    expect(screen.queryByText('Extra context')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(await screen.findByText('Extra context')).toBeInTheDocument();
  });
});

describe('Command', () => {
  it('filters items as you type and fires selection on Enter', async () => {
    const onSelect = vi.fn();
    render(
      <Command>
        <CommandInput aria-label="Search fruit" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="Apple" onSelect={onSelect}>
              Apple
            </CommandItem>
            <CommandItem value="Banana" onSelect={vi.fn()}>
              Banana
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );

    const input = screen.getByRole('combobox', { name: 'Search fruit' });
    expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Banana' })).toBeInTheDocument();

    await userEvent.type(input, 'App');
    expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Banana' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when nothing matches', async () => {
    render(
      <Command>
        <CommandInput aria-label="Search fruit" />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandGroup heading="Fruit">
            <CommandItem value="Apple">Apple</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );

    const input = screen.getByRole('combobox', { name: 'Search fruit' });
    await userEvent.type(input, 'zzz');
    expect(await screen.findByText('No results')).toBeInTheDocument();
  });

  it('hides a group heading when the query filters out all of its items', async () => {
    render(
      <Command>
        <CommandInput aria-label="Search food" />
        <CommandList>
          <CommandGroup heading="Fruit">
            <CommandItem value="Apple">Apple</CommandItem>
          </CommandGroup>
          <CommandGroup heading="Vegetables">
            <CommandItem value="Carrot">Carrot</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );

    const input = screen.getByRole('combobox', { name: 'Search food' });
    await userEvent.type(input, 'car');
    expect(screen.queryByText('Fruit')).not.toBeInTheDocument();
    expect(screen.getByText('Vegetables')).toBeInTheDocument();

    await userEvent.clear(input);
    expect(screen.getByText('Fruit')).toBeInTheDocument();
    expect(screen.getByText('Vegetables')).toBeInTheDocument();
  });

  it('keeps arrow-key traversal in visual order after items are filtered out and back in', async () => {
    // Stable handlers on purpose: with per-render (inline) handlers every item re-registers on
    // every keystroke in mount order, which masks registry-order drift. With stable handlers only
    // re-mounting items re-register, so a registry that appends re-entrants to the tail would put
    // Apple/Cherry AFTER Banana and desync ArrowDown from the visual order.
    const selected: string[] = [];
    const pick = (fruit: string) => () => selected.push(fruit);
    const [pickApple, pickBanana, pickCherry] = [pick('Apple'), pick('Banana'), pick('Cherry')];
    render(
      <Command>
        <CommandInput aria-label="Search fruit" />
        <CommandList>
          <CommandItem value="Apple" onSelect={pickApple}>
            Apple
          </CommandItem>
          <CommandItem value="Banana" onSelect={pickBanana}>
            Banana
          </CommandItem>
          <CommandItem value="Cherry" onSelect={pickCherry}>
            Cherry
          </CommandItem>
        </CommandList>
      </Command>,
    );

    const input = screen.getByRole('combobox', { name: 'Search fruit' });
    await userEvent.type(input, 'ban');
    expect(screen.getByRole('option', { name: 'Banana' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.clear(input);
    expect(screen.getByRole('option', { name: 'Banana' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Cherry' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Enter}');
    expect(selected).toEqual(['Cherry']);
  });
});
