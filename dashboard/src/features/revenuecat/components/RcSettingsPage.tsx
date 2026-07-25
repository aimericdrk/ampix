import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { PageShell } from '../../../components/layout/PageShell';
import { Badge } from '../../../components/ui/badge';
import { Button, buttonVariants } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { useProjectRole, useProjects } from '../../projects/api';
import { useRcApps, type RcApp, type RcAppPlatform } from '../catalog-api';
import {
  AppStoreConnectDialog,
  DisconnectStoreAlertDialog,
  GooglePlayConnectDialog,
} from './RcSettingsPage.dialogs';

const PLATFORM_LABEL: Record<RcAppPlatform, string> = {
  IOS: 'iOS',
  ANDROID: 'Android',
  MACOS: 'macOS',
  AMAZON: 'Amazon',
  WEB: 'Web',
};

/** Only iOS (App Store Connect) and Android (Google Play) have a store-credential flow — the backend
 *  maps exactly `IOS -> app_store` and `ANDROID -> google_play` (design §1.2). Other platforms show
 *  their status but expose no connect action. */
function supportsStoreCredentials(platform: RcAppPlatform): boolean {
  return platform === 'IOS' || platform === 'ANDROID';
}

type StoreStatus = 'not_connected' | 'connected' | 'pending';

/** Derived from the apps-list `storeConnected` + `storeCredentialsLiveVerified` fields (design §2). */
function storeStatus(app: RcApp): StoreStatus {
  if (!app.storeConnected) return 'not_connected';
  return app.storeCredentialsLiveVerified ? 'connected' : 'pending';
}

function StoreStatusBadge({ status }: { status: StoreStatus }) {
  if (status === 'connected') return <Badge variant="success">Connected</Badge>;
  if (status === 'pending') return <Badge variant="warning">Connected · live-verify pending</Badge>;
  return <Badge variant="default">Not connected</Badge>;
}

/**
 * MyRevenueCat → Integration settings (connect-stores design §2). Replaces the legacy real-RevenueCat
 * connect card (`IntegrationsSection`, still used by ProjectDetailPage/RcConnectPage — not deleted)
 * with a per-app store-credential list: each `App` from `useRcApps`, its platform, connection status,
 * and admin-only Connect/Manage/Disconnect. Gate is only `useProjects()` resolving (mirrors
 * `RcCustomerDetailPage`); a viewer sees status read-only. Empty state links to the Products page.
 */
export function RcSettingsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/rc/settings' });
  const { data: projectsData } = useProjects();
  const project = projectsData?.projects.find((candidate) => candidate.id === projectId);

  return (
    <PageShell
      projectId={projectId}
      title="Integration settings"
      description="Connect and manage the app stores this project talks to directly."
      breadcrumbs={[{ label: 'MyRevenueCat' }, { label: 'Integration settings' }]}
    >
      {/* Single stable `PageShell` tree regardless of loading state (unlike branching into two
          separate return statements) — swapping the whole tree once `useProjects()` resolves would
          unmount and remount this same title/breadcrumbs, racing any query already resolving against
          the pre-swap DOM node. Only the body below is conditional. */}
      {project && <StoreConnectionsManager projectId={projectId} />}
    </PageShell>
  );
}

function StoreConnectionsManager({ projectId }: { projectId: string }) {
  const role = useProjectRole(projectId);
  const canManage = role === 'admin' || role === 'owner';

  const appsQuery = useRcApps(projectId);
  const apps = appsQuery.data ?? [];

  const [connectTarget, setConnectTarget] = useState<RcApp | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<RcApp | null>(null);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Store connections</CardTitle>
          <CardDescription>
            Give each app the store credentials the clone uses to talk to Google Play and the App
            Store directly. Credentials are encrypted at rest and never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appsQuery.isError ? (
            <p role="alert" className="text-sm text-danger">
              Could not load this project’s apps.
            </p>
          ) : apps.length === 0 ? (
            <EmptyState
              title="No apps yet"
              description="Create an app before you can connect its store credentials."
              action={
                <Link
                  to="/projects/$projectId/rc/products"
                  params={{ projectId }}
                  className={buttonVariants({ size: 'sm' })}
                >
                  Go to Products
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {apps.map((app) => {
                const status = storeStatus(app);
                return (
                  <li
                    key={app.id}
                    data-app-row={app.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-text">{app.name}</span>
                      <Badge variant="outline">{PLATFORM_LABEL[app.platform]}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <StoreStatusBadge status={status} />
                      {canManage && supportsStoreCredentials(app.platform) && (
                        <div className="flex items-center gap-2">
                          {status === 'not_connected' ? (
                            <Button size="sm" onClick={() => setConnectTarget(app)}>
                              Connect
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setConnectTarget(app)}
                              >
                                Manage
                              </Button>
                              <Button
                                size="sm"
                                variant="danger"
                                onClick={() => setDisconnectTarget(app)}
                              >
                                Disconnect
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && connectTarget?.platform === 'ANDROID' && (
        <GooglePlayConnectDialog
          projectId={projectId}
          app={connectTarget}
          onClose={() => setConnectTarget(null)}
        />
      )}
      {canManage && connectTarget?.platform === 'IOS' && (
        <AppStoreConnectDialog
          projectId={projectId}
          app={connectTarget}
          onClose={() => setConnectTarget(null)}
        />
      )}
      {canManage && disconnectTarget && (
        <DisconnectStoreAlertDialog
          projectId={projectId}
          app={disconnectTarget}
          onClose={() => setDisconnectTarget(null)}
        />
      )}
    </>
  );
}
