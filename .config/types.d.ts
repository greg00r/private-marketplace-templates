// Type declarations for packages without @types/* definitions
declare module 'replace-in-file-webpack-plugin' {
  import { WebpackPluginInstance } from 'webpack';
  interface ReplaceRule {
    search: RegExp | string;
    replace: string;
  }
  interface ReplaceOptions {
    dir: string;
    files: string[];
    rules: ReplaceRule[];
  }
  export default class ReplaceInFileWebpackPlugin implements WebpackPluginInstance {
    constructor(options: ReplaceOptions[]);
    apply(compiler: import('webpack').Compiler): void;
  }
}
