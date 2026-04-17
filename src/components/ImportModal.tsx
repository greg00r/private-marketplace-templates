import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Field,
  Input,
  LoadingBar,
  Modal,
  Select,
  Stack,
  Text,
} from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { getTemplateJson, getTemplateVariables } from '../api/templates';
import { getFolders, importDashboard } from '../api/grafana';
import { VariableField } from './VariableField';
import { DatasourceMapper } from './DatasourceMapper';
import type {
  TemplateMetadata,
  TemplateVariable,
  GrafanaFolder,
  GrafanaDashboard,
  DatasourceMapping,
} from '../types';

interface Props {
  templateId: string;
  metadata: TemplateMetadata;
  variables: TemplateVariable[];
  onDismiss: () => void;
}

type Step = 'variables' | 'datasources' | 'importing';

export function ImportModal({ templateId, metadata, variables, onDismiss }: Props) {
  const navigate = useNavigate();
  const appEvents = getAppEvents();

  // Form state
  const [dashboardName, setDashboardName] = useState(metadata.title);
  const [folderUid, setFolderUid] = useState('');
  const [varValues, setVarValues] = useState<Record<string, string | string[]>>(() => {
    // Pre-fill defaults
    return Object.fromEntries(
      variables.map((v) => [v.name, v.default ?? (v.multi ? [] : '')])
    );
  });
  const [datasourceMappings, setDatasourceMappings] = useState<DatasourceMapping[]>([]);

  // Loaded data
  const [folders, setFolders] = useState<GrafanaFolder[]>([]);
  const [dashboard, setDashboard] = useState<GrafanaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('variables');
  const [importing, setImporting] = useState(false);

  const folderOptions = [
    { label: 'General', value: '' },
    ...folders.map((f) => ({ label: f.title, value: f.uid })),
  ];

  // Load dashboard JSON and folders in parallel
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashJson, folderList] = await Promise.all([
        getTemplateJson(templateId),
        getFolders(),
      ]);
      setDashboard(dashJson);
      setFolders(folderList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template data');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleImport = async () => {
    if (!dashboard) { return; }
    setImporting(true);
    setStep('importing');
    try {
      const result = await importDashboard(
        dashboard,
        {
          dashboardName,
          folderUid,
          variables: varValues,
          datasourceMappings,
        },
        variables
      );
      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Dashboard "${dashboardName}" imported successfully!`],
      });
      onDismiss();
      // Navigate to the imported dashboard
      navigate(result.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      setError(msg);
      setStep('variables');
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Import failed', msg],
      });
    } finally {
      setImporting(false);
    }
  };

  // Validate required variables before advancing
  const hasRequiredValues = variables
    .filter((v) => v.required)
    .every((v) => {
      const val = varValues[v.name];
      return Array.isArray(val) ? val.length > 0 : Boolean(val);
    });

  return (
    <Modal
      title={`Import: ${metadata.title}`}
      isOpen
      onDismiss={onDismiss}
      style={{ width: '640px' }}
    >
      {loading && (
        <div style={{ padding: '16px' }}>
          <LoadingBar width={300} />
          <Text color="secondary">Loading template data…</Text>
        </div>
      )}

      {!loading && error && (
        <Alert title="Error" severity="error" style={{ marginBottom: '16px' }}>
          {error}
        </Alert>
      )}

      {!loading && !error && (
        <>
          {/* Step: Variables + basic settings */}
          {step === 'variables' && (
            <Stack direction="column" gap={2}>
              {/* Dashboard name */}
              <Field label="Dashboard name" required>
                <Input
                  value={dashboardName}
                  onChange={(e) => setDashboardName(e.currentTarget.value)}
                  placeholder="Dashboard name"
                />
              </Field>

              {/* Folder */}
              <Field label="Folder">
                <Select
                  options={folderOptions}
                  value={folderUid}
                  onChange={(val) => setFolderUid(String(val.value ?? ''))}
                  placeholder="General"
                />
              </Field>

              {/* Template variables */}
              {variables.length > 0 && (
                <>
                  <Text variant="h5">Template Variables</Text>
                  {variables.map((v) => (
                    <VariableField
                      key={v.name}
                      variable={v}
                      value={varValues[v.name] ?? (v.default ?? '')}
                      onChange={(val) =>
                        setVarValues((prev) => ({ ...prev, [v.name]: val }))
                      }
                    />
                  ))}
                </>
              )}

              <Stack justifyContent="flex-end" gap={2} style={{ marginTop: '8px' }}>
                <Button variant="secondary" onClick={onDismiss}>
                  Cancel
                </Button>
                {dashboard && (
                  <Button
                    variant="primary"
                    onClick={() => setStep('datasources')}
                    disabled={!hasRequiredValues || !dashboardName}
                  >
                    Next: Datasources →
                  </Button>
                )}
              </Stack>
            </Stack>
          )}

          {/* Step: Datasource mapping */}
          {step === 'datasources' && dashboard && (
            <Stack direction="column" gap={2}>
              <DatasourceMapper
                dashboard={dashboard}
                mappings={datasourceMappings}
                onChange={setDatasourceMappings}
              />

              <Stack justifyContent="flex-end" gap={2} style={{ marginTop: '8px' }}>
                <Button variant="secondary" onClick={() => setStep('variables')}>
                  ← Back
                </Button>
                <Button
                  variant="primary"
                  icon="import"
                  onClick={handleImport}
                  disabled={importing}
                >
                  {importing ? 'Importing…' : 'Import dashboard'}
                </Button>
              </Stack>
            </Stack>
          )}

          {/* Step: Importing (spinner) */}
          {step === 'importing' && (
            <Stack direction="column" gap={2} alignItems="center" style={{ padding: '32px' }}>
              <LoadingBar width={300} />
              <Text color="secondary">Importing dashboard…</Text>
            </Stack>
          )}
        </>
      )}
    </Modal>
  );
}
