import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Field, Input, LoadingBar, Stack, Text } from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { getDataSources, getFolders, importDashboard } from '../api/grafana';
import { getTemplateJson } from '../api/templates';
import { DatasourceMapper } from './DatasourceMapper';
import { SimpleModal } from './SimpleModal';
import { VariableField } from './VariableField';
import type {
  DatasourceMapping,
  GrafanaDashboard,
  GrafanaDataSource,
  GrafanaFolder,
  TemplateMetadata,
  TemplateVariable,
} from '../types';
import { navigateToPath } from '../utils/navigation';

interface Props {
  templateId: string;
  metadata: TemplateMetadata;
  variables: TemplateVariable[];
  onDismiss: () => void;
}

type Step = 'details' | 'datasources' | 'variables' | 'importing';

export function ImportModal({ templateId, metadata, variables, onDismiss }: Props) {
  const appEvents = getAppEvents();

  const datasourceVariables = useMemo(
    () => variables.filter((variable) => variable.type === 'datasource'),
    [variables]
  );
  const configurableVariables = useMemo(
    () => variables.filter((variable) => variable.type !== 'datasource'),
    [variables]
  );

  const [dashboardName, setDashboardName] = useState(metadata.title);
  const [folderUid, setFolderUid] = useState('');
  const [variableValues, setVariableValues] = useState<Record<string, string | string[]>>(() =>
    buildInitialVariableValues(configurableVariables)
  );
  const [datasourceVariableValues, setDatasourceVariableValues] = useState<Record<string, string>>(() =>
    buildInitialDatasourceVariableValues(datasourceVariables)
  );
  const [datasourceMappings, setDatasourceMappings] = useState<DatasourceMapping[]>([]);

  const [folders, setFolders] = useState<GrafanaFolder[]>([]);
  const [dashboard, setDashboard] = useState<GrafanaDashboard | null>(null);
  const [availableDatasources, setAvailableDatasources] = useState<GrafanaDataSource[]>([]);
  const [datasourceLoadError, setDatasourceLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('details');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setDashboardName(metadata.title);
    setFolderUid('');
    setVariableValues(buildInitialVariableValues(configurableVariables));
    setDatasourceVariableValues(buildInitialDatasourceVariableValues(datasourceVariables));
    setDatasourceMappings([]);
    setStep('details');
    setError(null);
  }, [configurableVariables, datasourceVariables, metadata.title, templateId]);

  const loadModalData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [templateDashboard, availableFolders, datasources] = await Promise.all([
        getTemplateJson(templateId),
        getFolders(),
        getDataSources().catch((loadError) => {
          setDatasourceLoadError(
            loadError instanceof Error ? loadError.message : 'Failed to load datasources from Grafana'
          );
          return [] as GrafanaDataSource[];
        }),
      ]);

      setDashboard(templateDashboard);
      setFolders(availableFolders);
      setAvailableDatasources(datasources);
      if (datasources.length > 0) {
        setDatasourceLoadError(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load template data');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    loadModalData();
  }, [loadModalData]);

  useEffect(() => {
    if (availableDatasources.length === 0 || datasourceVariables.length === 0) {
      return;
    }

    setDatasourceVariableValues((current) =>
      normalizeDatasourceVariableValues(current, datasourceVariables, availableDatasources)
    );
  }, [availableDatasources, datasourceVariables]);

  const hasAllDatasourceMappingsSelected = datasourceMappings.every((mapping) => Boolean(mapping.localUid));
  const datasourceVariableIssues = datasourceVariables.filter((variable) => {
    const value = datasourceVariableValues[variable.name] ?? '';
    return !value;
  });
  const variableIssues = configurableVariables.filter((variable) => {
    if (!variable.required) {
      return false;
    }

    return !hasValue(variableValues[variable.name]);
  });

  const handleImport = async () => {
    if (!dashboard) {
      return;
    }

    setImporting(true);
    setStep('importing');
    setError(null);

    try {
      const result = await importDashboard(
        dashboard,
        {
          dashboardName,
          folderUid,
          variables: buildImportVariablePayload(variableValues, datasourceVariableValues),
          datasourceMappings,
        },
        variables,
        metadata
      );

      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Dashboard "${dashboardName}" imported successfully.`],
      });

      onDismiss();
      navigateToPath(result.url);
    } catch (importError) {
      const message = getImportErrorMessage(importError);
      setError(message);
      setStep('variables');

      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Import failed', message],
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <SimpleModal title={`Import: ${metadata.title}`} onDismiss={onDismiss}>
      {loading && (
        <Stack direction="column" gap={1}>
          <LoadingBar width={320} />
          <Text color="secondary">Loading template data...</Text>
        </Stack>
      )}

      {!loading && error && (
        <Alert title="Error" severity="error" style={{ marginBottom: '16px' }}>
          {error}
        </Alert>
      )}

      {!loading && !error && step === 'details' && (
        <Stack direction="column" gap={2}>
          <Text color="secondary">Choose the dashboard name and the Grafana folder before importing the template.</Text>

          <Field label="Dashboard name" required>
            <Input value={dashboardName} onChange={(event) => setDashboardName(event.currentTarget.value)} />
          </Field>

          <Field label="Folder">
            <select
              value={folderUid}
              onChange={(event) => setFolderUid(event.currentTarget.value)}
              style={{
                minHeight: '40px',
                borderRadius: '6px',
                padding: '0 12px',
                background: 'var(--grafana-input-bg, #111217)',
                color: 'var(--grafana-input-text, #ffffff)',
                border: '1px solid var(--grafana-border-strong, #3f4552)',
              }}
            >
              <option value="">General</option>
              {folders.map((folder) => (
                <option key={folder.uid} value={folder.uid}>
                  {folder.title}
                </option>
              ))}
            </select>
          </Field>

          <Stack justifyContent="flex-end" gap={2}>
            <Button variant="secondary" onClick={onDismiss}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setStep('datasources')} disabled={!dashboardName.trim()}>
              Next: Datasources
            </Button>
          </Stack>
        </Stack>
      )}

      {!loading && !error && step === 'datasources' && dashboard && (
        <Stack direction="column" gap={2}>
          <DatasourceMapper
            dashboard={dashboard}
            requiredDatasources={metadata.requiredDatasources}
            mappings={datasourceMappings}
            onChange={setDatasourceMappings}
          />

          {datasourceVariables.length > 0 && (
            <Stack direction="column" gap={2}>
              <Text variant="h5">Datasource variables from template</Text>
              <Text color="secondary">
                These datasource variables were marked by the template author to be filled during import.
              </Text>

              {datasourceVariables.map((variable) => {
                const matchingDatasources = getMatchingDatasources(variable, availableDatasources);
                const value = datasourceVariableValues[variable.name] ?? '';

                return (
                  <div
                    key={variable.name}
                    style={{
                      padding: '12px',
                      border: '1px solid var(--grafana-border-weak, #2f3440)',
                      borderRadius: '8px',
                    }}
                  >
                    <Stack direction="column" gap={1}>
                      <Text>
                        <strong>{variable.label || variable.name}</strong>
                      </Text>
                      <Text color="secondary">Current template datasource: {getVariablePreviewValue(variable)}</Text>
                      {variable.datasourceType && (
                        <Text color="secondary">Expected datasource type: {variable.datasourceType}</Text>
                      )}

                      <select
                        value={value}
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;
                          setDatasourceVariableValues((current) => ({
                            ...current,
                            [variable.name]: nextValue,
                          }));
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
                        {matchingDatasources.map((datasource) => (
                          <option key={datasource.uid} value={datasource.uid}>
                            {datasource.name} ({datasource.type})
                            {datasource.isDefault ? ' [default]' : ''}
                          </option>
                        ))}
                      </select>

                      {matchingDatasources.length === 0 && (
                        <Alert title="No datasource options are available" severity="warning">
                          Add a datasource of the required type in Grafana before importing this template.
                        </Alert>
                      )}
                    </Stack>
                  </div>
                );
              })}
            </Stack>
          )}

          {!hasAllDatasourceMappingsSelected && (
            <Alert title="Select all datasources before continuing" severity="warning">
              Every required datasource or datasource reference in the template must be mapped to an available datasource
              in this Grafana instance.
            </Alert>
          )}

          {datasourceVariableIssues.length > 0 && (
            <Alert title="Complete datasource variables before continuing" severity="warning">
              Select a local datasource for every datasource variable that the template asks for during import.
            </Alert>
          )}

          {datasourceLoadError && (
            <Alert title="Could not load datasource choices" severity="warning">
              {datasourceLoadError}
            </Alert>
          )}

          <Stack justifyContent="flex-end" gap={2}>
            <Button variant="secondary" onClick={() => setStep('details')}>
              Back
            </Button>
            <Button
              variant="primary"
              onClick={() => setStep('variables')}
              disabled={!hasAllDatasourceMappingsSelected || datasourceVariableIssues.length > 0}
            >
              Next: Variables
            </Button>
          </Stack>
        </Stack>
      )}

      {!loading && !error && step === 'variables' && (
        <Stack direction="column" gap={2}>
          <Text color="secondary">
            These variables were selected by the template author for import. They are prefilled with the template values
            and you can adjust them before creating the dashboard.
          </Text>

          {configurableVariables.length === 0 && (
            <Alert title="No non-datasource template variables detected" severity="info">
              This template does not ask for additional variable values during import.
            </Alert>
          )}

          {configurableVariables.map((variable) => {
            const value = variableValues[variable.name] ?? buildInitialVariableValue(variable);

            return (
              <div
                key={variable.name}
                style={{
                  padding: '12px',
                  border: '1px solid var(--grafana-border-weak, #2f3440)',
                  borderRadius: '8px',
                }}
              >
                <Stack direction="column" gap={1.5}>
                  <Text>
                    <strong>{variable.label || variable.name}</strong> ({variable.type})
                  </Text>
                  <Text color="secondary">Current template content: {getVariablePreviewValue(variable)}</Text>
                  {variable.query && <Text color="secondary">Template query: {variable.query}</Text>}
                  {variable.options?.length ? (
                    <Text color="secondary">Template options: {variable.options.join(', ')}</Text>
                  ) : null}

                  <VariableField
                    variable={variable}
                    value={value}
                    onChange={(nextValue) =>
                      setVariableValues((current) => ({
                        ...current,
                        [variable.name]: nextValue,
                      }))
                    }
                  />
                </Stack>
              </div>
            );
          })}

          {variableIssues.length > 0 && (
            <Alert title="Complete required variables before importing" severity="warning">
              Every required variable must have a value before the dashboard can be created.
            </Alert>
          )}

          <Stack justifyContent="flex-end" gap={2}>
            <Button variant="secondary" onClick={() => setStep('datasources')}>
              Back
            </Button>
            <Button variant="primary" icon="import" onClick={handleImport} disabled={importing || variableIssues.length > 0}>
              {importing ? 'Importing...' : 'Import dashboard'}
            </Button>
          </Stack>
        </Stack>
      )}

      {step === 'importing' && (
        <div style={{ padding: '24px 0' }}>
          <Stack direction="column" gap={1} alignItems="center">
            <LoadingBar width={320} />
            <Text color="secondary">Importing dashboard...</Text>
          </Stack>
        </div>
      )}
    </SimpleModal>
  );
}

function buildInitialVariableValues(variables: TemplateVariable[]): Record<string, string | string[]> {
  return Object.fromEntries(variables.map((variable) => [variable.name, buildInitialVariableValue(variable)]));
}

function buildInitialDatasourceVariableValues(variables: TemplateVariable[]): Record<string, string> {
  return Object.fromEntries(
    variables.map((variable) => [variable.name, String(variable.default ?? variable.datasource ?? '')])
  );
}

function buildInitialVariableValue(variable: TemplateVariable): string | string[] {
  if (variable.multi) {
    return variable.default ? [variable.default] : [];
  }

  return variable.default ?? '';
}

function buildImportVariablePayload(
  variableValues: Record<string, string | string[]>,
  datasourceVariableValues: Record<string, string>
): Record<string, string | string[]> {
  return Object.fromEntries([
    ...Object.entries(variableValues),
    ...Object.entries(datasourceVariableValues),
  ]);
}

function getVariablePreviewValue(variable: TemplateVariable): string {
  if (variable.type === 'query' && variable.query) {
    return variable.query;
  }

  if (variable.type === 'custom' && variable.options?.length) {
    return variable.options.join(', ');
  }

  if (variable.type === 'datasource' && variable.datasourceType) {
    return variable.datasourceType;
  }

  if (variable.default && variable.default.trim()) {
    return variable.default;
  }

  if (variable.datasource && variable.datasource.trim()) {
    return variable.datasource;
  }

  return 'No preset value';
}

function hasValue(value: string | string[] | undefined): boolean {
  if (!value) {
    return false;
  }

  return Array.isArray(value) ? value.length > 0 : Boolean(value.trim());
}

function normalizeDatasourceVariableValues(
  currentValues: Record<string, string>,
  variables: TemplateVariable[],
  availableDatasources: GrafanaDataSource[]
): Record<string, string> {
  const normalized = { ...currentValues };

  for (const variable of variables) {
    const currentValue = normalized[variable.name] ?? '';
    normalized[variable.name] = resolveDatasourceSelectionValue(currentValue, variable, availableDatasources);
  }

  return normalized;
}

function resolveDatasourceSelectionValue(
  currentValue: string,
  variable: TemplateVariable,
  availableDatasources: GrafanaDataSource[]
): string {
  const normalizedCurrentValue = currentValue.trim().toLowerCase();
  const matchingDatasources = getMatchingDatasources(variable, availableDatasources);

  if (normalizedCurrentValue) {
    const directMatch = availableDatasources.find((datasource) => {
      return (
        datasource.uid.toLowerCase() === normalizedCurrentValue ||
        datasource.name.toLowerCase() === normalizedCurrentValue ||
        datasource.type.toLowerCase() === normalizedCurrentValue
      );
    });

    if (directMatch) {
      return directMatch.uid;
    }
  }

  if (matchingDatasources.length === 1) {
    return matchingDatasources[0].uid;
  }

  return '';
}

function getMatchingDatasources(
  variable: TemplateVariable,
  availableDatasources: GrafanaDataSource[]
): GrafanaDataSource[] {
  const exactMatches = availableDatasources.filter((datasource) =>
    matchesDatasourceType(datasource.type, variable.datasourceType ?? '')
  );

  if (exactMatches.length > 0 || !variable.datasourceType) {
    return exactMatches;
  }

  return availableDatasources;
}

function matchesDatasourceType(actualType: string, expectedType: string): boolean {
  const normalizedActual = actualType.trim().toLowerCase();
  const normalizedExpected = expectedType.trim().toLowerCase();

  if (!normalizedExpected) {
    return true;
  }

  return normalizedActual === normalizedExpected || normalizedActual.includes(normalizedExpected);
}

function getImportErrorMessage(importError: unknown): string {
  if (importError instanceof Error && importError.message.trim()) {
    return importError.message;
  }

  if (typeof importError !== 'object' || importError === null) {
    return 'Import failed';
  }

  const fetchLikeError = importError as {
    status?: number;
    data?: { message?: string; error?: string };
    statusText?: string;
  };

  const backendMessage =
    fetchLikeError.data?.message?.trim() || fetchLikeError.data?.error?.trim() || fetchLikeError.statusText?.trim();

  if (fetchLikeError.status === 403) {
    return (
      backendMessage ||
      'Grafana denied dashboard creation for this user. Viewers can only import when their folder or dashboard permissions allow creating dashboards in the selected location.'
    );
  }

  return backendMessage || 'Import failed';
}
