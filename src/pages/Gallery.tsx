import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  EmptyState,
  FilterInput,
  Icon,
  LoadingBar,
  MultiSelect,
  Stack,
  Tag,
  Text,
  TextLink,
  Alert,
} from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { listTemplates } from '../api/templates';
import { TemplateCard } from '../components/TemplateCard';
import type { Template } from '../types';

const PLUGIN_ROOT = '/a/gregoor-private-marketplace-app';

export function Gallery() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedDatasources, setSelectedDatasources] = useState<string[]>([]);

  const appEvents = getAppEvents();

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTemplates();
      setTemplates(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load templates';
      setError(msg);
      appEvents.publish({
        type: AppEvents.alertError.name,
        payload: ['Failed to load templates', msg],
      });
    } finally {
      setLoading(false);
    }
  }, [appEvents]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Collect all unique tags and datasource types across all templates
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    templates.forEach((t) => t.metadata.tags?.forEach((tag) => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [templates]);

  const allDatasourceTypes = useMemo(() => {
    const dsSet = new Set<string>();
    templates.forEach((t) =>
      t.metadata.requiredDatasources?.forEach((ds) => dsSet.add(ds.type))
    );
    return Array.from(dsSet).sort();
  }, [templates]);

  // Filter templates based on search + selected tags + selected datasources
  const filteredTemplates = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return templates.filter((t) => {
      const meta = t.metadata;

      // Text search across title and description
      if (q) {
        const searchable = `${meta.title} ${meta.shortDescription} ${meta.tags?.join(' ')}`.toLowerCase();
        if (!searchable.includes(q)) {
          return false;
        }
      }

      // Tag filter (must have all selected tags)
      if (selectedTags.length > 0) {
        const templateTags = meta.tags || [];
        if (!selectedTags.every((tag) => templateTags.includes(tag))) {
          return false;
        }
      }

      // Datasource filter (must have all selected datasource types)
      if (selectedDatasources.length > 0) {
        const templateDs = (meta.requiredDatasources || []).map((ds) => ds.type);
        if (!selectedDatasources.every((ds) => templateDs.includes(ds))) {
          return false;
        }
      }

      return true;
    });
  }, [templates, searchQuery, selectedTags, selectedDatasources]);

  const tagSelectOptions = allTags.map((t) => ({ label: t, value: t }));
  const dsSelectOptions = allDatasourceTypes.map((t) => ({ label: t, value: t }));

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <Stack justifyContent="space-between" alignItems="flex-start" wrap="wrap" gap={2}>
        <Stack direction="column" gap={0.5}>
          <Text element="h1" variant="h2">
            Dashboard Marketplace
          </Text>
          <Text color="secondary">
            Browse, import, and share reusable dashboards within your organization.
          </Text>
        </Stack>
        <Button
          icon="upload"
          variant="primary"
          onClick={() => navigate(`${PLUGIN_ROOT}/upload`)}
        >
          Upload template
        </Button>
      </Stack>

      {/* Filters */}
      <Stack direction="row" gap={2} wrap="wrap" style={{ marginTop: '20px', marginBottom: '20px' }}>
        <div style={{ minWidth: '280px', flex: 1 }}>
          <FilterInput
            placeholder="Search by title, description or tags…"
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </div>
        <div style={{ minWidth: '200px' }}>
          <MultiSelect
            placeholder="Filter by tags"
            options={tagSelectOptions}
            value={selectedTags}
            onChange={(vals) => setSelectedTags(vals.map((v) => String(v.value)))}
            closeMenuOnSelect={false}
            isClearable
          />
        </div>
        <div style={{ minWidth: '200px' }}>
          <MultiSelect
            placeholder="Filter by datasource"
            options={dsSelectOptions}
            value={selectedDatasources}
            onChange={(vals) => setSelectedDatasources(vals.map((v) => String(v.value)))}
            closeMenuOnSelect={false}
            isClearable
          />
        </div>
        {(selectedTags.length > 0 || selectedDatasources.length > 0 || searchQuery) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setSelectedTags([]);
              setSelectedDatasources([]);
            }}
          >
            Clear filters
          </Button>
        )}
      </Stack>

      {/* Active tag chips */}
      {selectedTags.length > 0 && (
        <Stack gap={1} style={{ marginBottom: '16px' }}>
          {selectedTags.map((tag) => (
            <Tag
              key={tag}
              name={tag}
              onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
            />
          ))}
        </Stack>
      )}

      {/* Loading / Error / Empty / Grid */}
      {loading && <LoadingBar width={300} />}

      {!loading && error && (
        <Alert title="Could not load templates" severity="error">
          {error}{' '}
          <TextLink onClick={fetchTemplates} href="">
            Retry
          </TextLink>
        </Alert>
      )}

      {!loading && !error && templates.length === 0 && (
        <EmptyState
          variant="call-to-action"
          message="No templates yet"
          button={
            <Button
              icon="upload"
              variant="primary"
              onClick={() => navigate(`${PLUGIN_ROOT}/upload`)}
            >
              Upload your first template
            </Button>
          }
        >
          <Text color="secondary">
            Upload a dashboard template to make it available to your team.
          </Text>
        </EmptyState>
      )}

      {!loading && !error && templates.length > 0 && filteredTemplates.length === 0 && (
        <EmptyState variant="not-found" message="No templates match your filters">
          <Button variant="secondary" onClick={() => { setSearchQuery(''); setSelectedTags([]); setSelectedDatasources([]); }}>
            Clear filters
          </Button>
        </EmptyState>
      )}

      {!loading && !error && filteredTemplates.length > 0 && (
        <>
          <Text color="secondary" style={{ display: 'block', marginBottom: '16px' }}>
            {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
            {filteredTemplates.length !== templates.length && ` (filtered from ${templates.length})`}
          </Text>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '16px',
            }}
          >
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.metadata.id}
                template={template}
                onClick={() => navigate(`${PLUGIN_ROOT}/template/${template.metadata.id}`)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
