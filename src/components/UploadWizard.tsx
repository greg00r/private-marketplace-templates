import React, { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Alert,
  Button,
  Field,
  FileDropzone,
  Input,
  InputControl,
  MultiSelect,
  Select,
  Stack,
  Step,
  Stepper,
  Text,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import { GrafanaTheme2, AppEvents } from '@grafana/data';
import { css } from '@emotion/css';
import { getAppEvents } from '@grafana/runtime';
import { uploadTemplate } from '../api/templates';
import { searchDashboards, getDashboardByUid } from '../api/grafana';
import type { TemplateMetadata, TemplateVariable, GrafanaDashboard, RequiredDatasource } from '../types';

interface Props {
  onSuccess: (templateId: string) => void;
}

type WizardStep = 0 | 1 | 2 | 3 | 4; // steps 0-4

const DATASOURCE_TYPES = [
  'prometheus', 'loki', 'influxdb', 'elasticsearch', 'graphite',
  'mysql', 'postgres', 'mssql', 'cloudwatch', 'azuremonitor',
  'tempo', 'jaeger', 'zipkin', 'testdata',
].map((t) => ({ label: t, value: t }));

// Extracts datasource types from dashboard JSON
function detectDatasources(dashboard: GrafanaDashboard): RequiredDatasource[] {
  const found = new Map<string, string>();

  function walk(obj: unknown) {
    if (Array.isArray(obj)) {
      obj.forEach(walk);
    } else if (obj !== null && typeof obj === 'object') {
      const record = obj as Record<string, unknown>;
      if (record['datasource'] && typeof record['datasource'] === 'object') {
        const ds = record['datasource'] as { type?: string; uid?: string };
        if (ds.type && ds.type !== '-- Grafana --') {
          found.set(ds.type, ds.uid ?? ds.type);
        }
      }
      Object.values(record).forEach(walk);
    }
  }

  walk(dashboard);
  return Array.from(found.keys()).map((type) => ({ type, name: type }));
}

// Extracts templating variables from dashboard JSON into TemplateVariable format
function extractVariables(dashboard: GrafanaDashboard): TemplateVariable[] {
  return (dashboard.templating?.list ?? []).map((v) => ({
    name: String(v.name),
    label: String(v.label || v.name),
    type: (v.type as TemplateVariable['type']) ?? 'textbox',
    description: '',
    default: typeof v.current?.value === 'string' ? v.current.value : '',
    required: false,
    ...(v.type === 'custom' || v.type === 'query'
      ? { multi: Boolean(v.multi), includeAll: Boolean(v.includeAll) }
      : {}),
    ...(v.type === 'custom'
      ? { options: (v.options ?? []).map((o: { value: string }) => o.value) }
      : {}),
    ...(v.type === 'query'
      ? { datasource: (v.datasource as { uid?: string })?.uid ?? '', query: String(v.query ?? '') }
      : {}),
  }));
}

export function UploadWizard({ onSuccess }: Props) {
  const styles = useStyles2(getStyles);
  const appEvents = getAppEvents();

  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 0: dashboard JSON
  const [dashboardJson, setDashboardJson] = useState<GrafanaDashboard | null>(null);
  const [dashboardRawText, setDashboardRawText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ label: string; value: string }>>([]);

  // Step 1: metadata
  const [title, setTitle] = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [longDesc, setLongDesc] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [requiredDatasources, setRequiredDatasources] = useState<RequiredDatasource[]>([]);

  // Step 2: image
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Step 3: variables
  const [variables, setVariables] = useState<TemplateVariable[]>([]);

  // ── Step 0: handle JSON input ────────────────────────────────────────────────

  const handleJsonTextChange = (text: string) => {
    setDashboardRawText(text);
    setJsonError(null);
    if (!text.trim()) {
      setDashboardJson(null);
      return;
    }
    try {
      const parsed = JSON.parse(text) as GrafanaDashboard;
      setDashboardJson(parsed);
      // Auto-fill metadata from dashboard
      if (!title) { setTitle(parsed.title ?? ''); }
      const autoDs = detectDatasources(parsed);
      setRequiredDatasources(autoDs);
      setVariables(extractVariables(parsed));
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  const handleFileUpload = (files: File[]) => {
    const file = files[0];
    if (!file) { return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      handleJsonTextChange(e.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleDashboardSearch = useCallback(async (query: string) => {
    setDashboardSearch(query);
    if (!query) { return; }
    try {
      const results = await searchDashboards(query);
      setSearchResults(results.map((r) => ({ label: `${r.title} (${r.folderTitle ?? 'General'})`, value: r.uid })));
    } catch {
      setSearchResults([]);
    }
  }, []);

  const handleSelectFromGrafana = async (uid: string) => {
    try {
      const { dashboard } = await getDashboardByUid(uid);
      const text = JSON.stringify(dashboard, null, 2);
      handleJsonTextChange(text);
      setDashboardRawText(text);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Failed to load dashboard');
    }
  };

  // ── Step 2: image handling ───────────────────────────────────────────────────

  const handleImageDrop = (files: File[]) => {
    const file = files[0];
    if (!file) { return; }

    setImageError(null);

    if (file.size > 2 * 1024 * 1024) {
      setImageError('Image must be smaller than 2 MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setImageError('File must be an image');
      return;
    }

    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  // ── Variable editor helpers ───────────────────────────────────────────────────

  const updateVariable = (idx: number, updates: Partial<TemplateVariable>) => {
    setVariables((prev) => prev.map((v, i) => (i === idx ? { ...v, ...updates } : v)));
  };

  const removeVariable = (idx: number) => {
    setVariables((prev) => prev.filter((_, i) => i !== idx));
  };

  const addVariable = () => {
    setVariables((prev) => [
      ...prev,
      { name: '', label: '', type: 'textbox', required: false },
    ]);
  };

  // ── Submit ────────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!dashboardJson) { return; }
    setSubmitting(true);
    setSubmitError(null);

    try {
      const metadataPayload: Omit<TemplateMetadata, 'id'> = {
        title,
        shortDescription: shortDesc,
        longDescription: longDesc,
        tags,
        requiredDatasources,
        author: 'Unknown',
        version: '1.0.0',
        createdAt: new Date().toISOString().substring(0, 10),
        updatedAt: new Date().toISOString().substring(0, 10),
      };

      const result = await uploadTemplate({
        templateJson: JSON.stringify(dashboardJson),
        metadata: JSON.stringify(metadataPayload),
        variablesJson: JSON.stringify({ variables }),
        image: imageFile ?? undefined,
      });

      appEvents.publish({
        type: AppEvents.alertSuccess.name,
        payload: [`Template "${title}" uploaded successfully!`],
      });
      onSuccess(result.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setSubmitError(msg);
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Upload failed', msg],
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Stepper config ────────────────────────────────────────────────────────────

  const steps: Step[] = [
    { label: 'Dashboard JSON' },
    { label: 'Metadata' },
    { label: 'Image' },
    { label: 'Variables' },
    { label: 'Preview & Save' },
  ];

  const canAdvanceFrom: Record<WizardStep, boolean> = {
    0: Boolean(dashboardJson) && !jsonError,
    1: Boolean(title) && Boolean(shortDesc),
    2: true, // image is optional
    3: true, // variables are optional
    4: true,
  };

  return (
    <div>
      <Stepper steps={steps} activeStep={currentStep + 1} />

      <div className={styles.stepContent}>
        {/* ── Step 0: Dashboard JSON ── */}
        {currentStep === 0 && (
          <Stack direction="column" gap={2}>
            <Text color="secondary">
              Paste your dashboard JSON, upload a file, or select an existing Grafana dashboard.
            </Text>

            {/* Import from existing Grafana dashboard */}
            <Field label="Or pick from existing dashboards">
              <Select
                options={searchResults}
                onInputChange={handleDashboardSearch}
                onChange={(val) => val && handleSelectFromGrafana(String(val.value))}
                placeholder="Search dashboards…"
                filterOption={() => true}
                noOptionsMessage={dashboardSearch ? 'No results' : 'Start typing to search'}
                isClearable
              />
            </Field>

            {/* File drop */}
            <FileDropzone
              options={{
                accept: { 'application/json': ['.json'] },
                multiple: false,
                onDrop: (files) => handleFileUpload(files as File[]),
              }}
            >
              <Text color="secondary">Drop dashboard.json here or click to browse</Text>
            </FileDropzone>

            {/* Raw JSON textarea */}
            <Field label="Dashboard JSON" invalid={Boolean(jsonError)} error={jsonError ?? undefined}>
              <TextArea
                rows={10}
                value={dashboardRawText}
                onChange={(e) => handleJsonTextChange(e.currentTarget.value)}
                placeholder='{ "title": "My Dashboard", … }'
                style={{ fontFamily: 'monospace', fontSize: '12px' }}
              />
            </Field>

            {dashboardJson && (
              <Alert title={`Loaded: "${dashboardJson.title}"`} severity="success" />
            )}
          </Stack>
        )}

        {/* ── Step 1: Metadata ── */}
        {currentStep === 1 && (
          <Stack direction="column" gap={2}>
            <Field label="Title" required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="My Awesome Dashboard"
              />
            </Field>

            <Field label="Short description" required>
              <Input
                value={shortDesc}
                onChange={(e) => setShortDesc(e.currentTarget.value)}
                placeholder="One-line description shown on the card"
                maxLength={200}
              />
            </Field>

            <Field label="Long description (Markdown)">
              <Stack direction="row" gap={2} style={{ width: '100%' }}>
                <div style={{ flex: 1 }}>
                  <TextArea
                    rows={12}
                    value={longDesc}
                    onChange={(e) => setLongDesc(e.currentTarget.value)}
                    placeholder="# Overview&#10;Describe your dashboard…"
                  />
                </div>
                <div className={styles.markdownPreview}>
                  <Text variant="bodySmall" color="secondary">Preview</Text>
                  <div className={styles.markdownContent}>
                    <ReactMarkdown>{longDesc || '*Nothing to preview yet.*'}</ReactMarkdown>
                  </div>
                </div>
              </Stack>
            </Field>

            <Field label="Tags">
              <MultiSelect
                options={[]}
                value={tags.map((t) => ({ label: t, value: t }))}
                onChange={(vals) => setTags(vals.map((v) => String(v.value)))}
                placeholder="Type and press Enter to add tags"
                allowCustomValue
                closeMenuOnSelect={false}
              />
            </Field>

            <Field label="Required datasources">
              <MultiSelect
                options={DATASOURCE_TYPES}
                value={requiredDatasources.map((ds) => ({ label: ds.type, value: ds.type }))}
                onChange={(vals) =>
                  setRequiredDatasources(vals.map((v) => ({ type: String(v.value), name: String(v.value) })))
                }
                placeholder="Select datasource types"
                closeMenuOnSelect={false}
                isClearable
              />
            </Field>
          </Stack>
        )}

        {/* ── Step 2: Image ── */}
        {currentStep === 2 && (
          <Stack direction="column" gap={2}>
            <Text color="secondary">
              Upload a preview screenshot (PNG/JPG, max 2 MB, recommended 600×400 px).
            </Text>

            <FileDropzone
              options={{
                accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] },
                multiple: false,
                onDrop: (files) => handleImageDrop(files as File[]),
              }}
            >
              <Text color="secondary">Drop image here or click to browse</Text>
            </FileDropzone>

            {imageError && <Alert title={imageError} severity="error" />}

            {imagePreview && (
              <div>
                <Text color="secondary">Preview:</Text>
                <img
                  src={imagePreview}
                  alt="Template preview"
                  style={{ maxWidth: '100%', maxHeight: '300px', borderRadius: '4px', marginTop: '8px' }}
                />
              </div>
            )}

            {!imageFile && (
              <Alert title="Image is optional" severity="info">
                Skipping image will show a placeholder in the gallery.
              </Alert>
            )}
          </Stack>
        )}

        {/* ── Step 3: Variables ── */}
        {currentStep === 3 && (
          <Stack direction="column" gap={2}>
            <Text color="secondary">
              These variables will be presented to the user during import.
              Auto-detected from the dashboard's templating section.
            </Text>

            {variables.map((v, idx) => (
              <div key={idx} className={styles.variableRow}>
                <Stack direction="row" gap={1} alignItems="flex-end" wrap="wrap">
                  <Field label="Name" style={{ minWidth: '120px' }}>
                    <Input
                      value={v.name}
                      onChange={(e) => updateVariable(idx, { name: e.currentTarget.value })}
                      placeholder="varName"
                    />
                  </Field>
                  <Field label="Label" style={{ minWidth: '140px' }}>
                    <Input
                      value={v.label}
                      onChange={(e) => updateVariable(idx, { label: e.currentTarget.value })}
                      placeholder="Human-readable label"
                    />
                  </Field>
                  <Field label="Type">
                    <Select
                      options={[
                        { label: 'Text box', value: 'textbox' },
                        { label: 'Custom (select)', value: 'custom' },
                        { label: 'Query', value: 'query' },
                        { label: 'Constant', value: 'constant' },
                        { label: 'Datasource', value: 'datasource' },
                      ]}
                      value={v.type}
                      onChange={(val) => updateVariable(idx, { type: val.value as TemplateVariable['type'] })}
                    />
                  </Field>
                  <Field label="Default" style={{ minWidth: '140px' }}>
                    <Input
                      value={v.default ?? ''}
                      onChange={(e) => updateVariable(idx, { default: e.currentTarget.value })}
                      placeholder="default value"
                    />
                  </Field>
                  <Button
                    variant="destructive"
                    size="sm"
                    fill="outline"
                    icon="trash-alt"
                    onClick={() => removeVariable(idx)}
                    style={{ marginBottom: '4px' }}
                  />
                </Stack>
                <Field label="Description (optional)">
                  <Input
                    value={v.description ?? ''}
                    onChange={(e) => updateVariable(idx, { description: e.currentTarget.value })}
                    placeholder="Describe what this variable does"
                  />
                </Field>
              </div>
            ))}

            <Button variant="secondary" icon="plus" onClick={addVariable}>
              Add variable
            </Button>
          </Stack>
        )}

        {/* ── Step 4: Preview & Save ── */}
        {currentStep === 4 && (
          <Stack direction="column" gap={2}>
            <Text variant="h4">Ready to publish</Text>

            <div className={styles.previewCard}>
              <Stack direction="row" gap={2} alignItems="flex-start">
                {imagePreview && (
                  <img
                    src={imagePreview}
                    alt="Preview"
                    style={{ width: '180px', height: '112px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }}
                  />
                )}
                <Stack direction="column" gap={0.5}>
                  <Text variant="h5">{title || 'Untitled'}</Text>
                  <Text color="secondary">{shortDesc}</Text>
                  <Stack gap={1} wrap="wrap" style={{ marginTop: '4px' }}>
                    {tags.map((tag) => (
                      <span key={tag} className={styles.tagChip}>{tag}</span>
                    ))}
                  </Stack>
                  <Text variant="bodySmall" color="secondary" style={{ marginTop: '4px' }}>
                    Datasources: {requiredDatasources.map((d) => d.type).join(', ') || '—'}
                  </Text>
                  <Text variant="bodySmall" color="secondary">
                    Variables: {variables.length}
                  </Text>
                </Stack>
              </Stack>
            </div>

            {submitError && (
              <Alert title="Upload failed" severity="error">
                {submitError}
              </Alert>
            )}

            <Button
              variant="primary"
              size="lg"
              icon="save"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Publishing…' : 'Publish template'}
            </Button>
          </Stack>
        )}
      </div>

      {/* Navigation buttons */}
      <Stack justifyContent="flex-end" gap={2} style={{ marginTop: '24px' }}>
        {currentStep > 0 && (
          <Button variant="secondary" onClick={() => setCurrentStep((s) => (s - 1) as WizardStep)}>
            ← Back
          </Button>
        )}
        {currentStep < 4 && (
          <Button
            variant="primary"
            onClick={() => setCurrentStep((s) => (s + 1) as WizardStep)}
            disabled={!canAdvanceFrom[currentStep]}
          >
            Next →
          </Button>
        )}
      </Stack>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    stepContent: css({
      minHeight: '300px',
      padding: `${theme.spacing(2)} 0`,
    }),
    variableRow: css({
      padding: theme.spacing(1.5),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    markdownPreview: css({
      flex: 1,
      padding: theme.spacing(1),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
      maxHeight: '300px',
      overflowY: 'auto',
    }),
    markdownContent: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),
    previewCard: css({
      padding: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
    }),
    tagChip: css({
      display: 'inline-block',
      padding: `2px ${theme.spacing(1)}`,
      background: theme.colors.background.canvas,
      border: `1px solid ${theme.colors.border.medium}`,
      borderRadius: theme.shape.radius.pill,
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
  };
}
