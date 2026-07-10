import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';
import { Button } from './button';
import { PageHeader } from './page-header';
import { StatTile } from './stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

describe('Tabs', () => {
  it('switches panels on trigger click', async () => {
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="Sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">Overview panel</TabsContent>
        <TabsContent value="details">Details panel</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText('Overview panel')).toBeVisible();
    expect(screen.queryByText('Details panel')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Details' }));

    expect(screen.getByText('Details panel')).toBeVisible();
    expect(screen.queryByText('Overview panel')).not.toBeInTheDocument();
  });
});

describe('Accordion', () => {
  it('expands panel content on trigger click', async () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>What is this?</AccordionTrigger>
          <AccordionContent>Hidden answer</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );

    expect(screen.queryByText('Hidden answer')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'What is this?' }));

    expect(await screen.findByText('Hidden answer')).toBeVisible();
  });
});

describe('StatTile', () => {
  it('renders label, formatted value, and a positive delta badge', () => {
    render(
      <StatTile
        label="Active users"
        value={1234}
        format={(n) => n.toLocaleString('en-US')}
        delta={12}
      />,
    );

    expect(screen.getByText('Active users')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  it('renders a danger badge for a negative delta', () => {
    render(<StatTile label="Churn" value={42} delta={-8} />);

    expect(screen.getByText('-8%')).toBeInTheDocument();
  });
});

describe('PageHeader', () => {
  it('renders the title and actions', () => {
    render(
      <PageHeader
        icon={Home}
        title="Dashboard"
        description="Everything at a glance"
        actions={<Button>Create</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
});
