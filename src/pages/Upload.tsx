import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Icon, Stack, Text } from '@grafana/ui';
import { UploadWizard } from '../components/UploadWizard';

const PLUGIN_ROOT = '/a/gregoor-private-marketplace-app';

export function Upload() {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <Button
        variant="secondary"
        size="sm"
        fill="text"
        onClick={() => navigate(PLUGIN_ROOT)}
        style={{ marginBottom: '16px' }}
      >
        <Icon name="arrow-left" /> Back to gallery
      </Button>

      <Stack direction="column" gap={0.5} style={{ marginBottom: '24px' }}>
        <Text element="h1" variant="h2">Upload Dashboard Template</Text>
        <Text color="secondary">
          Publish a reusable dashboard to the organization marketplace.
        </Text>
      </Stack>

      <UploadWizard onSuccess={(id) => navigate(`${PLUGIN_ROOT}/template/${id}`)} />
    </div>
  );
}
