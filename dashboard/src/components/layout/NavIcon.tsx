import {
  Building2,
  ChartBar,
  ChartLine,
  CircleDollarSign,
  CircleUser,
  Clock,
  FileChartLine,
  Filter,
  FolderOpen,
  GitBranch,
  Grid3x3,
  House,
  LayoutDashboard,
  LayoutTemplate,
  Radio,
  Repeat,
  RefreshCw,
  Settings,
  Tags,
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
  | 'settings';

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
};

export function NavIcon({ name }: { name: IconName }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" className="size-4 shrink-0" />;
}
