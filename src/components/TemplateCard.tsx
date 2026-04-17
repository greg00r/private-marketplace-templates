import React from 'react';
import { Card, Stack, Tag, Text, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getTemplateImageUrl } from '../api/templates';
import type { Template } from '../types';

interface Props {
  template: Template;
  onClick: () => void;
}

export function TemplateCard({ template, onClick }: Props) {
  const { metadata } = template;
  const styles = useStyles2(getStyles);

  return (
    <Card onClick={onClick} className={styles.card}>
      {/* Thumbnail */}
      <Card.Figure className={styles.figure}>
        <img
          src={getTemplateImageUrl(metadata.id)}
          alt={`${metadata.title} preview`}
          className={styles.image}
          onError={(e) => {
            const el = e.target as HTMLImageElement;
            el.style.display = 'none';
            const placeholder = el.nextElementSibling as HTMLElement;
            if (placeholder) {
              placeholder.style.display = 'flex';
            }
          }}
        />
        {/* Fallback placeholder shown when image fails */}
        <div className={styles.imagePlaceholder} style={{ display: 'none' }}>
          <span style={{ fontSize: '40px', opacity: 0.3 }}>📊</span>
        </div>
      </Card.Figure>

      <Card.Heading>{metadata.title}</Card.Heading>

      <Card.Description>
        <Text variant="bodySmall" color="secondary">
          {metadata.shortDescription}
        </Text>
      </Card.Description>

      <Card.Meta>
        <Stack gap={0.5} wrap="wrap" alignItems="center">
          {(metadata.tags || []).slice(0, 4).map((tag) => (
            <Tag key={tag} name={tag} />
          ))}
          {(metadata.tags || []).length > 4 && (
            <Text variant="bodySmall" color="secondary">
              +{metadata.tags.length - 4} more
            </Text>
          )}
        </Stack>
      </Card.Meta>

      <Card.Actions>
        <Stack justifyContent="space-between" alignItems="center" style={{ width: '100%' }}>
          <Text variant="bodySmall" color="secondary">
            v{metadata.version} · {metadata.author}
          </Text>
          {metadata.requiredDatasources?.length > 0 && (
            <Text variant="bodySmall" color="secondary">
              {metadata.requiredDatasources.map((ds) => ds.type).join(', ')}
            </Text>
          )}
        </Stack>
      </Card.Actions>
    </Card>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    card: css({
      cursor: 'pointer',
      transition: 'box-shadow 0.15s ease',
      '&:hover': {
        boxShadow: theme.shadows.z3,
      },
    }),
    figure: css({
      position: 'relative',
      width: '100%',
      aspectRatio: '16/9',
      overflow: 'hidden',
      background: theme.colors.background.secondary,
    }),
    image: css({
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    }),
    imagePlaceholder: css({
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.colors.background.secondary,
    }),
  };
}
