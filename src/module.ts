import { AppPlugin } from '@grafana/data';
import { App } from './App';
import { ConfigPage } from './config/ConfigPage';
import type { AppPluginSettings } from './types';

export const plugin = new AppPlugin<AppPluginSettings>()
  .setRootPage(App)
  .addConfigPage({
    title: 'Configuration',
    icon: 'cog',
    body: ConfigPage,
    id: 'configuration',
  });
