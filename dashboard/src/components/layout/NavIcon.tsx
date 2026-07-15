import {
  BadgeCheck,
  Building2,
  ChartBar,
  ChartLine,
  ChartPie,
  CircleDollarSign,
  CircleUser,
  Clock,
  Contact,
  FileChartLine,
  Filter,
  FolderOpen,
  GitBranch,
  Grid3x3,
  House,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Package,
  PanelTop,
  Radio,
  Repeat,
  RefreshCw,
  Settings,
  Sparkles,
  Tags,
  Target,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  | 'home'
  | 'insights'
  | 'funnel'
  | 'retention'
  | 'paths'
  | 'heatmap'
  | 'revenue'
  | 'subscriptions'
  | 'distributions'
  | 'properties'
  | 'events'
  | 'cohorts'
  | 'users'
  | 'sessions'
  | 'live'
  | 'dashboards'
  | 'reports'
  | 'templates'
  | 'projects'
  | 'org'
  | 'account'
  | 'settings'
  | 'tool-amplitude'
  | 'tool-revenuecat'
  | 'overview'
  | 'charts'
  | 'customers'
  | 'products'
  | 'entitlements'
  | 'offerings'
  | 'paywalls'
  | 'conversion'
  | 'flows';

/** Lucide glyph per nav destination — kept as a lookup so the icon set stays a single source of truth. */
const ICONS: Record<IconName, LucideIcon> = {
  home: House,
  insights: ChartLine,
  funnel: Filter,
  retention: Repeat,
  paths: GitBranch,
  heatmap: Grid3x3,
  revenue: CircleDollarSign,
  subscriptions: RefreshCw,
  distributions: ChartBar,
  properties: Tags,
  events: Zap,
  cohorts: UsersRound,
  users: User,
  sessions: Clock,
  live: Radio,
  dashboards: LayoutDashboard,
  reports: FileChartLine,
  templates: LayoutTemplate,
  projects: FolderOpen,
  org: Building2,
  account: CircleUser,
  settings: Settings,
  'tool-amplitude': ChartLine,
  'tool-revenuecat': Sparkles,
  overview: ChartPie,
  charts: ChartPie,
  customers: Contact,
  products: Package,
  entitlements: BadgeCheck,
  offerings: Layers,
  paywalls: PanelTop,
  conversion: Target,
  flows: GitBranch,
};

export function NavIcon({ name }: { name: IconName }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" className="size-4 shrink-0" />;
}
