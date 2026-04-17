import React from 'react';
import { AppRootProps } from '@grafana/data';
import { Route, Routes } from 'react-router-dom';
import { Gallery } from './pages/Gallery';
import { TemplateDetail } from './pages/TemplateDetail';
import { Upload } from './pages/Upload';
import type { AppPluginSettings } from './types';

/**
 * App root component. Grafana injects it at /a/<plugin-id>/*.
 * React Router v6 handles sub-routes (base path is already set by Grafana's runtime).
 */
export function App(_props: AppRootProps<AppPluginSettings>) {
  return (
    <Routes>
      <Route index element={<Gallery />} />
      <Route path="template/:id" element={<TemplateDetail />} />
      <Route path="upload" element={<Upload />} />
      {/* Fallback: redirect unknown paths to gallery */}
      <Route path="*" element={<Gallery />} />
    </Routes>
  );
}
