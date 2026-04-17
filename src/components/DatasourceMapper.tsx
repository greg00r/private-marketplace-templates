import React, { useEffect, useState } from 'react';
import { Field, Select, Text, Stack, Alert } from '@grafana/ui';
import { getDataSources } from '../api/grafana';
import type { DatasourceMapping, GrafanaDataSource, GrafanaDashboard } from '../types';

interface Props {
  dashboard: GrafanaDashboard;
  mappings: DatasourceMapping[];
  onChange: (mappings: DatasourceMapping[]) => void;
}

/**
 * Scans the dashboard JSON for unique datasource UIDs and lets the user
 * map each one to a locally available datasource.
 */
export function DatasourceMapper({ dashboard, mappings, onChange }: Props) {
  const [localDatasources, setLocalDatasources] = useState<GrafanaDataSource[]>([]);
  const [templateUids, setTemplateUids] = useState<Array<{ uid: string; type: string }>>([]);

  useEffect(() => {
    getDataSources().then(setLocalDatasources).catch(console.error);
  }, []);

  useEffect(() => {
    const found = extractDatasourceUids(dashboard);
    setTemplateUids(found);

    // Initialize mappings for UIDs that don't have one yet
    const existing = new Set(mappings.map((m) => m.templateUid));
    const newMappings: DatasourceMapping[] = found
      .filter((f) => !existing.has(f.uid))
      .map((f) => ({ templateUid: f.uid, templateType: f.type, localUid: '' }));

    if (newMappings.length > 0) {
      onChange([...mappings, ...newMappings]);
    }
  }, [dashboard]); // eslint-disable-line react-hooks/exhaustive-deps

  if (templateUids.length === 0) {
    return (
      <Alert title="No datasource UIDs found" severity="info">
        This dashboard does not contain explicit datasource UIDs; no mapping is needed.
      </Alert>
    );
  }

  return (
    <Stack direction="column" gap={2}>
      <Text color="secondary">
        Map template datasource UIDs to datasources available in this Grafana instance.
      </Text>
      {templateUids.map((tmpl) => {
        const mapping = mappings.find((m) => m.templateUid === tmpl.uid);
        const options = localDatasources
          .filter((ds) => !tmpl.type || ds.type === tmpl.type || tmpl.type === 'default')
          .map((ds) => ({ label: `${ds.name} (${ds.type})`, value: ds.uid }));

        return (
          <Field
            key={tmpl.uid}
            label={`Template UID: ${tmpl.uid}`}
            description={tmpl.type ? `Type: ${tmpl.type}` : undefined}
          >
            <Select
              options={options}
              value={mapping?.localUid || ''}
              onChange={(val) => {
                const updated = mappings.map((m) =>
                  m.templateUid === tmpl.uid ? { ...m, localUid: String(val.value) } : m
                );
                onChange(updated);
              }}
              placeholder="Select local datasource"
              isClearable
            />
          </Field>
        );
      })}
    </Stack>
  );
}

// ─── Helper: extract unique datasource UIDs from a dashboard JSON ─────────────

function extractDatasourceUids(
  obj: unknown,
  seen = new Map<string, string>()
): Array<{ uid: string; type: string }> {
  if (Array.isArray(obj)) {
    obj.forEach((item) => extractDatasourceUids(item, seen));
  } else if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === 'datasource' && typeof record[key] === 'object' && record[key] !== null) {
        const ds = record[key] as { uid?: string; type?: string };
        if (ds.uid && ds.uid !== '-- Grafana --' && !ds.uid.startsWith('${')) {
          seen.set(ds.uid, ds.type ?? 'unknown');
        }
      } else {
        extractDatasourceUids(record[key], seen);
      }
    }
  }
  return Array.from(seen.entries()).map(([uid, type]) => ({ uid, type }));
}
