import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  Alert,
  Badge,
  Button,
  Icon,
  LoadingBar,
  Stack,
  Tag,
  Text,
  useStyles2,
} from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getTemplateMetadata, getTemplateVariables, getTemplateImageUrl } from '../api/templates';
import { checkDatasourceAvailability } from '../api/grafana';
import { ImportModal } from '../components/ImportModal';
import type { TemplateMetadata, TemplateVariables } from '../types';

const PLUGIN_ROOT = '/a/gregoor-private-marketplace-app';

export function TemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const styles = useStyles2(getStyles);

  const [metadata, setMetadata] = useState<TemplateMetadata | null>(null);
  const [variables, setVariables] = useState<TemplateVariables | null>(null);
  const [dsAvailability, setDsAvailability] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) { return; }
    setLoading(true);
    setError(null);
    try {
      const [meta, vars] = await Promise.all([
        getTemplateMetadata(id),
        getTemplateVariables(id),
      ]);
      setMetadata(meta);
      setVariables(vars);

      // Check datasource availability
      if (meta.requiredDatasources?.length) {
        const types = meta.requiredDatasources.map((ds) => ds.type);
        const avail = await checkDatasourceAvailability(types);
        setDsAvailability(avail);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ padding: '24px' }}>
        <LoadingBar width={300} />
      </div>
    );
  }

  if (error || !metadata) {
    return (
      <div style={{ padding: '24px' }}>
        <Alert title="Failed to load template" severity="error">
          {error}
        </Alert>
        <Button variant="secondary" onClick={() => navigate(PLUGIN_ROOT)} style={{ marginTop: '16px' }}>
          <Icon name="arrow-left" /> Back to gallery
        </Button>
      </div>
    );
  }

  const allDsAvailable = metadata.requiredDatasources?.every(
    (ds) => dsAvailability[ds.type] !== false
  );

  return (
    <div style={{ padding: '24px', maxWidth: '960px' }}>
      {/* Back link */}
      <Button
        variant="secondary"
        size="sm"
        fill="text"
        onClick={() => navigate(PLUGIN_ROOT)}
        style={{ marginBottom: '16px' }}
      >
        <Icon name="arrow-left" /> Back to gallery
      </Button>

      {/* Header row */}
      <Stack justifyContent="space-between" alignItems="flex-start" wrap="wrap" gap={2}>
        <Stack direction="column" gap={0.5}>
          <Text element="h1" variant="h2">{metadata.title}</Text>
          <Stack gap={1} wrap="wrap">
            <Text color="secondary">by {metadata.author}</Text>
            <Text color="secondary">·</Text>
            <Text color="secondary">v{metadata.version}</Text>
            <Text color="secondary">·</Text>
            <Text color="secondary">Updated {metadata.updatedAt}</Text>
          </Stack>
        </Stack>
        <Button
          icon="import"
          variant="primary"
          size="lg"
          onClick={() => setShowImportModal(true)}
        >
          Import template
        </Button>
      </Stack>

      {/* Tags */}
      {metadata.tags?.length > 0 && (
        <Stack gap={1} style={{ marginTop: '12px' }}>
          {metadata.tags.map((tag) => (
            <Tag key={tag} name={tag} />
          ))}
        </Stack>
      )}

      {/* Main content */}
      <div className={styles.contentGrid}>
        {/* Left: image + datasource requirements */}
        <div className={styles.sidebar}>
          {id && (
            <img
              src={getTemplateImageUrl(id)}
              alt={`${metadata.title} preview`}
              className={styles.previewImage}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}

          {/* Required Datasources */}
          {metadata.requiredDatasources?.length > 0 && (
            <div className={styles.infoBox}>
              <Text variant="h5">Required Datasources</Text>
              <Stack direction="column" gap={1} style={{ marginTop: '8px' }}>
                {metadata.requiredDatasources.map((ds) => {
                  const available = dsAvailability[ds.type];
                  return (
                    <Stack key={ds.type} justifyContent="space-between" alignItems="center">
                      <Stack gap={1} alignItems="center">
                        <Icon name="database" />
                        <Text>{ds.name}</Text>
                        <Text color="secondary" variant="bodySmall">({ds.type})</Text>
                      </Stack>
                      {available === undefined ? null : available ? (
                        <Badge text="Available" color="green" icon="check" />
                      ) : (
                        <Badge text="Missing" color="red" icon="exclamation-triangle" />
                      )}
                    </Stack>
                  );
                })}
              </Stack>
              {!allDsAvailable && (
                <Alert
                  title="Some datasources are missing"
                  severity="warning"
                  style={{ marginTop: '8px' }}
                >
                  Install the missing datasources before importing this dashboard.
                </Alert>
              )}
            </div>
          )}

          {/* Variables summary */}
          {variables?.variables?.length > 0 && (
            <div className={styles.infoBox}>
              <Text variant="h5">Template Variables ({variables.variables.length})</Text>
              <Stack direction="column" gap={0.5} style={{ marginTop: '8px' }}>
                {variables.variables.map((v) => (
                  <Stack key={v.name} gap={1} alignItems="center">
                    <Tag name={v.type} colorIndex={2} />
                    <Text variant="bodySmall">
                      <strong>{v.label || v.name}</strong>
                      {v.required && <span style={{ color: 'red' }}> *</span>}
                      {v.description && (
                        <span style={{ marginLeft: '4px', opacity: 0.7 }}>— {v.description}</span>
                      )}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            </div>
          )}
        </div>

        {/* Right: long description */}
        <div className={styles.mainContent}>
          <Text variant="h4">Description</Text>
          <div className={styles.markdown}>
            {metadata.longDescription ? (
              <ReactMarkdown>{metadata.longDescription}</ReactMarkdown>
            ) : (
              <Text color="secondary">{metadata.shortDescription}</Text>
            )}
          </div>
        </div>
      </div>

      {/* Import Modal */}
      {showImportModal && id && variables && (
        <ImportModal
          templateId={id}
          metadata={metadata}
          variables={variables.variables}
          onDismiss={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    contentGrid: css({
      display: 'grid',
      gridTemplateColumns: '320px 1fr',
      gap: theme.spacing(3),
      marginTop: theme.spacing(3),
      [theme.breakpoints.down('md')]: {
        gridTemplateColumns: '1fr',
      },
    }),
    sidebar: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    previewImage: css({
      width: '100%',
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      objectFit: 'cover',
    }),
    infoBox: css({
      padding: theme.spacing(2),
      background: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    mainContent: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
    }),
    markdown: css({
      'h1, h2, h3, h4, h5, h6': {
        marginTop: theme.spacing(2),
        marginBottom: theme.spacing(1),
        color: theme.colors.text.primary,
      },
      p: {
        marginBottom: theme.spacing(1),
        color: theme.colors.text.secondary,
        lineHeight: 1.6,
      },
      'ul, ol': {
        paddingLeft: theme.spacing(3),
        color: theme.colors.text.secondary,
      },
      code: {
        background: theme.colors.background.secondary,
        padding: `2px ${theme.spacing(0.5)}`,
        borderRadius: theme.shape.radius.default,
        fontFamily: theme.typography.fontFamilyMonospace,
        fontSize: theme.typography.bodySmall.fontSize,
      },
      pre: {
        background: theme.colors.background.secondary,
        padding: theme.spacing(1.5),
        borderRadius: theme.shape.radius.default,
        overflowX: 'auto',
        code: {
          background: 'transparent',
          padding: 0,
        },
      },
    }),
  };
}
