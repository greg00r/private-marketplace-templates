import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import type {
  GrafanaDashboard,
  GrafanaFolder,
  GrafanaDataSource,
  ImportFormValues,
  TemplateVariable,
  DatasourceMapping,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

// ─── Folders ─────────────────────────────────────────────────────────────────

export async function getFolders(): Promise<GrafanaFolder[]> {
  return getBackendSrv().get<GrafanaFolder[]>('/api/folders?limit=1000');
}

// ─── Datasources ──────────────────────────────────────────────────────────────

export async function getDataSources(): Promise<GrafanaDataSource[]> {
  return getBackendSrv().get<GrafanaDataSource[]>('/api/datasources');
}

/**
 * Checks which required datasource types are available in this Grafana instance.
 * Returns a map of datasource type → boolean (available or not).
 */
export async function checkDatasourceAvailability(
  requiredTypes: string[]
): Promise<Record<string, boolean>> {
  const datasources = await getDataSources();
  const availableTypes = new Set(datasources.map((ds) => ds.type.toLowerCase()));

  const result: Record<string, boolean> = {};
  for (const type of requiredTypes) {
    result[type] = availableTypes.has(type.toLowerCase());
  }
  return result;
}

/**
 * Resolves datasource query variable options via getDataSourceSrv.
 */
export async function resolveDatasourceQueryOptions(
  datasourceName: string,
  query: string
): Promise<string[]> {
  try {
    const ds = await getDataSourceSrv().get(datasourceName);
    // @ts-ignore – metricFindQuery exists on most datasources
    const result = await ds.metricFindQuery(query, {});
    return (result || []).map((r: { text: string }) => r.text);
  } catch {
    return [];
  }
}

// ─── Import Dashboard ─────────────────────────────────────────────────────────

/**
 * Prepares and imports a dashboard into Grafana.
 *
 * Steps:
 * 1. Clone the dashboard JSON to avoid mutating the original.
 * 2. Reset id/uid so Grafana generates a fresh one.
 * 3. Override dashboard title.
 * 4. Inject / overwrite template variables.
 * 5. Remap datasource UIDs.
 * 6. POST to /api/dashboards/db.
 */
export async function importDashboard(
  dashboard: GrafanaDashboard,
  formValues: ImportFormValues,
  templateVariables: TemplateVariable[]
): Promise<{ uid: string; url: string }> {
  // Deep clone
  const dash: GrafanaDashboard = JSON.parse(JSON.stringify(dashboard));

  // Reset identifiers – let Grafana assign new ones
  dash.id = null;
  dash.uid = uuidv4().replace(/-/g, '').substring(0, 12);
  dash.title = formValues.dashboardName;

  // Ensure templating section exists
  if (!dash.templating) {
    dash.templating = { list: [] };
  }

  // Inject variable values into the dashboard's templating.list
  for (const varDef of templateVariables) {
    const value = formValues.variables[varDef.name];
    if (value === undefined) {
      continue;
    }

    const existing = dash.templating.list.find((v) => v.name === varDef.name);

    if (existing) {
      // Overwrite current value
      const textVal = Array.isArray(value) ? value.join(', ') : value;
      existing.current = {
        value: value,
        text: textVal,
      };
      if (varDef.type === 'custom' || varDef.type === 'textbox') {
        existing.options = Array.isArray(value)
          ? value.map((v) => ({ value: v, text: v, selected: true }))
          : [{ value: value as string, text: value as string, selected: true }];
      }
    } else {
      // Append new variable entry
      const newVar: Record<string, unknown> = {
        name: varDef.name,
        label: varDef.label || varDef.name,
        type: varDef.type,
        current: {
          value: value,
          text: Array.isArray(value) ? value.join(', ') : value,
        },
      };
      if (varDef.type === 'custom' || varDef.type === 'textbox') {
        newVar['options'] = Array.isArray(value)
          ? value.map((v) => ({ value: v, text: v, selected: true }))
          : [{ value: value, text: value, selected: true }];
      }
      dash.templating.list.push(newVar as never);
    }
  }

  // Remap datasource UIDs
  applyDatasourceMappings(dash, formValues.datasourceMappings);

  // Import via Grafana API
  const response = await getBackendSrv().post<{
    id: number;
    uid: string;
    url: string;
    status: string;
    slug: string;
  }>('/api/dashboards/db', {
    dashboard: dash,
    folderUid: formValues.folderUid || undefined,
    overwrite: false,
    message: 'Imported from Private Marketplace',
  });

  return { uid: response.uid, url: response.url };
}

// ─── Datasource Mapping ───────────────────────────────────────────────────────

/**
 * Recursively walks the dashboard object and replaces datasource UIDs
 * based on the provided mapping.
 */
function applyDatasourceMappings(
  obj: unknown,
  mappings: DatasourceMapping[]
): void {
  if (!mappings.length) {
    return;
  }
  walkAndReplace(obj, mappings);
}

function walkAndReplace(obj: unknown, mappings: DatasourceMapping[]): void {
  if (Array.isArray(obj)) {
    obj.forEach((item) => walkAndReplace(item, mappings));
  } else if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (
        key === 'datasource' &&
        record[key] !== null &&
        typeof record[key] === 'object'
      ) {
        const ds = record[key] as { uid?: string; type?: string };
        if (ds.uid) {
          const mapping = mappings.find((m) => m.templateUid === ds.uid);
          if (mapping) {
            ds.uid = mapping.localUid;
          }
        }
      } else {
        walkAndReplace(record[key], mappings);
      }
    }
  }
}

// ─── Search Dashboards (for Upload Wizard import) ────────────────────────────

export interface DashboardSearchResult {
  id: number;
  uid: string;
  title: string;
  folderTitle?: string;
}

export async function searchDashboards(query: string): Promise<DashboardSearchResult[]> {
  return getBackendSrv().get<DashboardSearchResult[]>(
    `/api/search?query=${encodeURIComponent(query)}&type=dash-db&limit=20`
  );
}

export async function getDashboardByUid(uid: string): Promise<{ dashboard: GrafanaDashboard }> {
  return getBackendSrv().get<{ dashboard: GrafanaDashboard }>(`/api/dashboards/uid/${uid}`);
}
