export const ownershipLabel = "tiangz.dev/battle-lab";
export function manifest(namespace, image, owner) {
  if (!/^tiangz-battle-[a-f0-9]{8}$/.test(namespace) || !/^[a-f0-9]{8}$/.test(owner)) throw new Error("invalid lab identity");
  if (!/^tiangz-battle-lab:k8s-image-[a-z0-9]+$/.test(image)) throw new Error("only local lab images are allowed");
  const metadata = name => ({ name, namespace, labels: { [ownershipLabel]: owner } });
  function template(role) {
    return { metadata: { labels: { app: `battle-${role}`, [ownershipLabel]: owner } }, spec: {
      automountServiceAccountToken: false, terminationGracePeriodSeconds: 30,
      securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, seccompProfile: { type: "RuntimeDefault" } },
      containers: [{ name: "runtime", image, imagePullPolicy: "Never",
        securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
        env: [{ name: "BATTLE_ROLE", value: role }, ...[["POD_IP", "status.podIP"], ["POD_NAME", "metadata.name"], ["POD_UID", "metadata.uid"]]
          .map(([name, fieldPath]) => ({ name, valueFrom: { fieldRef: { fieldPath } } }))],
        ports: [{ name: "rpc", containerPort: 3000 }, { name: "health", containerPort: 3001 }],
        resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } },
        startupProbe: { httpGet: { path: "/ready", port: "health" }, periodSeconds: 1, failureThreshold: 90 },
        readinessProbe: { httpGet: { path: "/ready", port: "health" }, periodSeconds: 1 },
        ...(role === "worker" ? { lifecycle: { preStop: { exec: { command: ["node", "/game/drain.mjs"] } } } } : {}),
      }],
    } };
  }
  return { apiVersion: "v1", kind: "List", items: [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: namespace, labels: { [ownershipLabel]: owner } } },
    ...["manager", "worker"].map(role => ({ apiVersion: "v1", kind: "Service", metadata: metadata(`battle-${role}`),
      spec: { type: "ClusterIP", ...(role === "worker" ? { clusterIP: "None" } : {}),
        selector: { app: `battle-${role}` }, ports: [{ name: "rpc", port: 3000, targetPort: "rpc" }] } })),
    { apiVersion: "apps/v1", kind: "Deployment", metadata: metadata("battle-manager"), spec: {
      replicas: 1, strategy: { type: "Recreate" }, selector: { matchLabels: { app: "battle-manager" } }, template: template("manager"),
    } },
    { apiVersion: "apps/v1", kind: "StatefulSet", metadata: metadata("battle-worker"), spec: {
      serviceName: "battle-worker", replicas: 2, podManagementPolicy: "OrderedReady", updateStrategy: { type: "OnDelete" },
      selector: { matchLabels: { app: "battle-worker" } }, template: template("worker"),
    } },
  ] };
}
