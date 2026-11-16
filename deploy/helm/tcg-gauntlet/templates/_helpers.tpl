{{- define "tcg-gauntlet.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "tcg-gauntlet.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "tcg-gauntlet.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "tcg-gauntlet.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tcg-gauntlet.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "tcg-gauntlet.labels" -}}
helm.sh/chart: {{ include "tcg-gauntlet.chart" . }}
{{ include "tcg-gauntlet.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "tcg-gauntlet.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "tcg-gauntlet.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "tcg-gauntlet.image" -}}
{{- printf "%s:%s" .Values.image.repository (default (printf "v%s" .Chart.AppVersion) .Values.image.tag) }}
{{- end }}

{{/* Name of the secret that holds the webhook secret, or empty when there is none. */}}
{{- define "tcg-gauntlet.secretName" -}}
{{- if .Values.webhook.existingSecret }}
{{- .Values.webhook.existingSecret }}
{{- else if .Values.webhook.secret }}
{{- include "tcg-gauntlet.fullname" . }}
{{- end }}
{{- end }}

{{- define "tcg-gauntlet.secretKey" -}}
{{- default "webhook-secret" .Values.webhook.existingSecretKey }}
{{- end }}

{{- define "tcg-gauntlet.claimName" -}}
{{- default (printf "%s-data" (include "tcg-gauntlet.fullname" .)) .Values.persistence.existingClaim }}
{{- end }}
