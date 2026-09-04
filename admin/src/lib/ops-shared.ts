/**
 * Pure ops constants — no Node built-ins and no Kubernetes client, so this module is safe to
 * import from client components. The acting side lives in ./ops (server only): importing that
 * from a 'use client' file drags the kube/env modules into the browser bundle.
 */

/**
 * Deployments that must never run more than one replica, and why. These are single-writer
 * processes: a second copy does not share the work, it repeats it. The chart pins them to 1 and
 * keeps them off the HPA, so the console is the only way to break that — hence this guard.
 * Scaling one DOWN (to 0) stays allowed: that is how you pause it.
 */
export const SINGLETONS: Record<string, string> = {
  'notification-sender':
    'it runs the push scheduler in-process, so a second replica sends every scheduled notification twice',
};
