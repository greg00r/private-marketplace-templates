import React from 'react';
import { Alert, Button, Icon, Stack, Text } from '@grafana/ui';
import { UploadWizard } from '../components/UploadWizard';
import { canCurrentUserApproveTemplates, canCurrentUserPublishTemplates } from '../utils/access';
import { buildPluginPath, navigateToPath } from '../utils/navigation';

export function Upload() {
  const canPublishTemplates = canCurrentUserPublishTemplates();
  const canApproveTemplates = canCurrentUserApproveTemplates();

  if (!canPublishTemplates) {
    return (
      <div style={{ padding: '24px', maxWidth: '800px' }}>
        <Button
          variant="secondary"
          size="sm"
          fill="text"
          onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}
          style={{ marginBottom: '16px' }}
        >
          <Icon name="arrow-left" /> Back to gallery
        </Button>

        <Alert title="Publishing is restricted" severity="warning">
          Only users with the Editor or Admin role can publish dashboard templates.
        </Alert>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <Button
        variant="secondary"
        size="sm"
        fill="text"
        onClick={() => navigateToPath(buildPluginPath({ type: 'gallery' }))}
        style={{ marginBottom: '16px' }}
      >
        <Icon name="arrow-left" /> Back to gallery
      </Button>

      <div style={{ marginBottom: '24px' }}>
        <Stack direction="column" gap={0.5}>
          <Text element="h1" variant="h2">Upload Dashboard Template</Text>
          <Text color="secondary">
            Submit a reusable dashboard to the organization marketplace. Admins will review it before it goes live.
          </Text>
        </Stack>
      </div>

      <UploadWizard
        onSuccess={(_id, status) =>
          navigateToPath(buildPluginPath({ type: canApproveTemplates && status === 'pending' ? 'review' : 'gallery' }))
        }
      />
    </div>
  );
}
