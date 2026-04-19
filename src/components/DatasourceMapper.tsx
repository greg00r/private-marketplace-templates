import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Field, Stack, Text } from '@grafana/ui';
import { getDataSources } from '../api/grafana';
import type { DatasourceMapping, GrafanaDashboard, GrafanaDataSource, RequiredDatasource } from '../types';

interface Props {
  dashboard: GrafanaDashboard;
  requiredDatasources?: RequiredDatasource[];
  mappings: DatasourceMapping[];
  onChange: (mappings: DatasourceMapping[]) => void;
}

interface TemplateDatasourceRef {
  id: string;
  type: string;
  label: string;
  source: 'reference' | 'required';
  requiredName?: string;
}

export function DatasourceMapper({ dashboard, requiredDatasources = [], mappings, onChange }: Props) {
  const [localDatasources, setLocalDatasources] = useState<GrafanaDataSource[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getDataSources()
      .then((datasources) => {
        setLocalDatasources(datasources);
        setLoadError(null);
      })
      .catch((error) => {
        setLocalDatasources([]);
        setLoadError(error instanceof Error ? error.message : 'Failed to load datasources from Grafana');
      });
  }, []);

  const templateDatasourceRefs = useMemo(
    () => extractDatasourceRefs(dashboard),
    [dashboard]
  );
  const requiredDatasourceRefs = useMemo(
    () => extractRequiredDatasourceRefs(requiredDatasources),
    [requiredDatasources]
  );

  useEffect(() => {
    const existingMappingKeys = new Set(mappings.map((mapping) => buildMappingKey(mapping)));
    const inferredMappings = [...templateDatasourceRefs, ...requiredDatasourceRefs]
      .filter((ref) => !existingMappingKeys.has(buildReferenceKey(ref)))
      .map((ref) => {
        const suggestedDatasource = localDatasources.find((datasource) => datasource.type === ref.type);

        return {
          templateUid: ref.id,
          templateType: ref.type,
          localUid: suggestedDatasource?.uid ?? '',
          source: ref.source,
          requiredName: ref.requiredName,
        } satisfies DatasourceMapping;
      });

    if (inferredMappings.length > 0) {
      onChange([...mappings, ...inferredMappings]);
    }
  }, [localDatasources, mappings, onChange, requiredDatasourceRefs, templateDatasourceRefs]);

  if (templateDatasourceRefs.length === 0 && requiredDatasourceRefs.length === 0) {
    return (
      <Alert title="No datasource mapping needed" severity="info">
        This dashboard does not contain datasource UIDs or datasource placeholders.
      </Alert>
    );
  }

  return (
    <Stack direction="column" gap={2}>
      <Text color="secondary">
        Select datasources available in this Grafana instance for the template requirements and datasource placeholders.
      </Text>

      {localDatasources.length > 0 && (
        <Text color="secondary">
          Detected datasources: {localDatasources.map((datasource) => datasource.name).join(', ')}
        </Text>
      )}

      {loadError && (
        <Alert title="Could not load datasources automatically" severity="warning">
          {loadError}
        </Alert>
      )}

      {!loadError && localDatasources.length === 0 && (
        <Alert title="No datasources detected in this Grafana instance" severity="warning">
          Add at least one datasource in Grafana before importing this template.
        </Alert>
      )}

      {requiredDatasourceRefs.length > 0 && (
        <Stack direction="column" gap={2}>
          <Text variant="h5">Required datasources</Text>
          {requiredDatasourceRefs.map((ref) => (
            <DatasourceSelectField
              key={ref.id}
              datasourceRef={ref}
              localDatasources={localDatasources}
              mappings={mappings}
              onChange={onChange}
            />
          ))}
        </Stack>
      )}

      {templateDatasourceRefs.length > 0 && (
        <Stack direction="column" gap={2}>
          <Text variant="h5">Datasource references from dashboard JSON</Text>
          {templateDatasourceRefs.map((ref) => (
            <DatasourceSelectField
              key={ref.id}
              datasourceRef={ref}
              localDatasources={localDatasources}
              mappings={mappings}
              onChange={onChange}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

interface DatasourceSelectFieldProps {
  datasourceRef: TemplateDatasourceRef;
  localDatasources: GrafanaDataSource[];
  mappings: DatasourceMapping[];
  onChange: (mappings: DatasourceMapping[]) => void;
}

function DatasourceSelectField({ datasourceRef, localDatasources, mappings, onChange }: DatasourceSelectFieldProps) {
  const mapping = mappings.find((item) => buildMappingKey(item) === buildReferenceKey(datasourceRef));
  const exactTypeMatches = localDatasources.filter((datasource) =>
    matchesDatasourceType(datasource.type, datasourceRef.type)
  );
  const datasourcesToShow = exactTypeMatches.length > 0 || !datasourceRef.type ? exactTypeMatches : localDatasources;
  const options = datasourcesToShow.map((datasource) => ({
    label: `${datasource.name} (${datasource.type})${datasource.isDefault ? ' [default]' : ''}`,
    value: datasource.uid,
  }));
  const selectedValue = mapping?.localUid ?? '';

  return (
    <Field
      label={datasourceRef.label}
      description={datasourceRef.type ? `Expected type: ${datasourceRef.type}` : undefined}
    >
      <Stack direction="column" gap={1}>
        <select
          value={selectedValue}
          onChange={(event) => {
            const localUid = event.currentTarget.value;
            onChange(
              upsertMapping(mappings, {
                templateUid: datasourceRef.id,
                templateType: datasourceRef.type,
                localUid,
                source: datasourceRef.source,
                requiredName: datasourceRef.requiredName,
              })
            );
          }}
          style={{
            minHeight: '40px',
            borderRadius: '6px',
            padding: '0 12px',
            background: 'var(--grafana-input-bg, #111217)',
            color: 'var(--grafana-input-text, #ffffff)',
            border: '1px solid var(--grafana-border-strong, #3f4552)',
          }}
        >
          <option value="">Select local datasource</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {options.length === 0 && (
          <Alert title="No datasource of the required type is available" severity="warning">
            Add a datasource of type "{datasourceRef.type}" to this Grafana instance before importing.
          </Alert>
        )}
        {options.length > 0 && datasourceRef.type && exactTypeMatches.length === 0 && (
          <Alert title="No exact datasource type match was found" severity="warning">
            Showing all datasources from this Grafana instance because nothing matched the expected type "{datasourceRef.type}".
          </Alert>
        )}
      </Stack>
    </Field>
  );
}

function matchesDatasourceType(actualType: string, expectedType: string): boolean {
  const normalizedActual = actualType.trim().toLowerCase();
  const normalizedExpected = expectedType.trim().toLowerCase();

  if (!normalizedExpected) {
    return true;
  }

  return normalizedActual === normalizedExpected || normalizedActual.includes(normalizedExpected);
}

function extractDatasourceRefs(node: unknown, seen = new Map<string, string>()): TemplateDatasourceRef[] {
  if (Array.isArray(node)) {
    node.forEach((item) => extractDatasourceRefs(item, seen));
    return Array.from(seen.entries()).map(([id, type]) => ({
      id,
      type,
      label: id,
      source: 'reference',
    }));
  }

  if (!node || typeof node !== 'object') {
    return Array.from(seen.entries()).map(([id, type]) => ({
      id,
      type,
      label: id,
      source: 'reference',
    }));
  }

  const record = node as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (key !== 'datasource') {
      extractDatasourceRefs(value, seen);
      continue;
    }

    if (typeof value === 'string') {
      seen.set(value, seen.get(value) ?? '');
      continue;
    }

    if (!value || typeof value !== 'object') {
      continue;
    }

    const datasource = value as { uid?: string; type?: string; name?: string };
    const identifier = datasource.uid || datasource.name;
    if (identifier && identifier !== '-- Grafana --') {
      seen.set(identifier, datasource.type ?? seen.get(identifier) ?? '');
    }
  }

  return Array.from(seen.entries()).map(([id, type]) => ({
    id,
    type,
    label: id,
    source: 'reference',
  }));
}

function extractRequiredDatasourceRefs(requiredDatasources: RequiredDatasource[]): TemplateDatasourceRef[] {
  const seen = new Set<string>();

  return requiredDatasources.reduce<TemplateDatasourceRef[]>((acc, datasource) => {
    const type = datasource.type.trim();
    const name = datasource.name.trim() || type;
    const id = `required::${type}::${name}`;
    if (!type || seen.has(id)) {
      return acc;
    }

    seen.add(id);
    acc.push({
      id,
      type,
      label: name,
      source: 'required',
      requiredName: name,
    });
    return acc;
  }, []);
}

function upsertMapping(mappings: DatasourceMapping[], nextMapping: DatasourceMapping): DatasourceMapping[] {
  const mappingKey = buildMappingKey(nextMapping);
  const existingIndex = mappings.findIndex((mapping) => buildMappingKey(mapping) === mappingKey);

  if (existingIndex === -1) {
    return [...mappings, nextMapping];
  }

  return mappings.map((mapping, index) => (index === existingIndex ? nextMapping : mapping));
}

function buildReferenceKey(reference: Pick<TemplateDatasourceRef, 'id' | 'source'>): string {
  return `${reference.source}:${reference.id}`;
}

function buildMappingKey(mapping: Pick<DatasourceMapping, 'templateUid' | 'source'>): string {
  return `${mapping.source ?? 'reference'}:${mapping.templateUid}`;
}
