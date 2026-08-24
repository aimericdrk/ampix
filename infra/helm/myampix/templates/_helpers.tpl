{{/*
Chart-wide labels (every object).
*/}}
{{- define "myampix.labels" -}}
app.kubernetes.io/part-of: myampix
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{/*
Selector labels for one component.
Usage: include "myampix.selectorLabels" (dict "root" . "name" "mobile-analytics" "component" "api")
*/}}
{{- define "myampix.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/*
Full image reference.
Usage: include "myampix.image" (dict "root" . "name" "mobile-analytics")
*/}}
{{- define "myampix.image" -}}
{{- $img := .root.Values.image -}}
{{- printf "%s/%s/myampix-%s:%s" $img.registry $img.owner .name $img.tag -}}
{{- end }}

{{/* http or https depending on tls.enabled */}}
{{- define "myampix.scheme" -}}
{{- if .Values.tls.enabled }}https{{ else }}http{{ end }}
{{- end }}

{{/* Pod securityContext body shared by every workload (runAsUser/Group are added per component). */}}
{{- define "myampix.podSecurityContext" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/* Container securityContext for serving containers (read-only root fs; /tmp is an emptyDir). */}}
{{- define "myampix.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end }}

{{/* imagePullSecrets block (empty when image.pullSecret is ""). */}}
{{- define "myampix.imagePullSecrets" -}}
{{- if .Values.image.pullSecret }}
imagePullSecrets:
  - name: {{ .Values.image.pullSecret }}
{{- end }}
{{- end }}

{{/* TLS Secret name for a host: api.example.com → api-example-com-tls */}}
{{- define "myampix.tlsSecret" -}}
{{- printf "%s-tls" (replace "." "-" .) -}}
{{- end }}

{{/*
hostAliases mapping every host-DB hostname to hostDbs.ip. Used by the migrate hook Jobs: Helm runs
pre-install/pre-upgrade hooks BEFORE the release's Services exist, so DNS for `postgres` etc. would
not resolve yet. /etc/hosts entries make the Jobs independent of the Services (same names, same ports).
*/}}
{{- define "myampix.hostDbAliases" -}}
hostAliases:
  - ip: {{ .Values.hostDbs.ip | quote }}
    hostnames:
      {{- range .Values.hostDbs.services }}
      - {{ .name }}
      {{- end }}
{{- end }}
