import type { TemplateMetadata } from '../types';

export function getTemplateFolderLabel(metadata: TemplateMetadata): string {
  return metadata.folder?.trim() || 'General';
}

export function getTemplateLastPublisherLabel(metadata: TemplateMetadata): string {
  return metadata.approvedBy?.trim() || metadata.updatedBy?.trim() || metadata.author?.trim() || 'Unknown';
}
