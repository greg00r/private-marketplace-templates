import React, { useEffect, useState } from 'react';
import { Field, Input, Select, MultiSelect, AsyncSelect, Text } from '@grafana/ui';
import { resolveDatasourceQueryOptions, getDataSources } from '../api/grafana';
import type { TemplateVariable, GrafanaDataSource } from '../types';

interface Props {
  variable: TemplateVariable;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}

/**
 * Renders the appropriate Grafana UI input for a given template variable type.
 */
export function VariableField({ variable, value, onChange }: Props) {
  const description = variable.description;

  return (
    <Field
      label={variable.label || variable.name}
      description={description}
      required={variable.required}
    >
      <VariableInput variable={variable} value={value} onChange={onChange} />
    </Field>
  );
}

function VariableInput({ variable, value, onChange }: Props) {
  switch (variable.type) {
    case 'textbox':
    case 'constant':
      return (
        <Input
          value={typeof value === 'string' ? value : value[0] ?? ''}
          placeholder={variable.default ?? ''}
          onChange={(e) => onChange(e.currentTarget.value)}
          required={variable.required}
        />
      );

    case 'custom':
      return (
        <CustomVariableField variable={variable} value={value} onChange={onChange} />
      );

    case 'query':
      return (
        <QueryVariableField variable={variable} value={value} onChange={onChange} />
      );

    case 'datasource':
      return (
        <DatasourceVariableField variable={variable} value={value} onChange={onChange} />
      );

    default:
      return (
        <Input
          value={typeof value === 'string' ? value : value[0] ?? ''}
          placeholder={variable.default ?? ''}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
  }
}

// ─── Custom (static options) ─────────────────────────────────────────────────

function CustomVariableField({ variable, value, onChange }: Props) {
  const options = (variable.options || []).map((opt) => ({ label: opt, value: opt }));

  if (variable.multi) {
    return (
      <MultiSelect
        options={options}
        value={Array.isArray(value) ? value : value ? [value] : []}
        onChange={(vals) => onChange(vals.map((v) => String(v.value)))}
        placeholder={`Select ${variable.label || variable.name}`}
        closeMenuOnSelect={false}
      />
    );
  }

  return (
    <Select
      options={options}
      value={typeof value === 'string' ? value : value[0]}
      onChange={(val) => onChange(val.value as string)}
      placeholder={variable.default || `Select ${variable.label || variable.name}`}
    />
  );
}

// ─── Query (async datasource query) ──────────────────────────────────────────

function QueryVariableField({ variable, value, onChange }: Props) {
  const loadOptions = async (inputValue: string) => {
    if (!variable.datasource || !variable.query) {
      return [];
    }
    const values = await resolveDatasourceQueryOptions(variable.datasource, variable.query);
    const filtered = inputValue
      ? values.filter((v) => v.toLowerCase().includes(inputValue.toLowerCase()))
      : values;

    if (variable.includeAll) {
      return [{ label: 'All', value: '$__all' }, ...filtered.map((v) => ({ label: v, value: v }))];
    }
    return filtered.map((v) => ({ label: v, value: v }));
  };

  const defaultOptions = true; // load on mount

  if (variable.multi) {
    return (
      <AsyncSelect
        loadOptions={loadOptions}
        defaultOptions={defaultOptions}
        value={Array.isArray(value) ? value.map((v) => ({ label: v, value: v })) : []}
        onChange={(vals) => {
          if (Array.isArray(vals)) {
            onChange(vals.map((v) => String(v.value)));
          }
        }}
        isMulti
        placeholder={`Select ${variable.label || variable.name}`}
        closeMenuOnSelect={false}
      />
    );
  }

  return (
    <AsyncSelect
      loadOptions={loadOptions}
      defaultOptions={defaultOptions}
      value={typeof value === 'string' ? { label: value, value } : undefined}
      onChange={(val) => {
        if (val && !Array.isArray(val)) {
          onChange(String(val.value));
        }
      }}
      placeholder={variable.default || `Select ${variable.label || variable.name}`}
    />
  );
}

// ─── Datasource ───────────────────────────────────────────────────────────────

function DatasourceVariableField({ variable, value, onChange }: Props) {
  const [datasources, setDatasources] = useState<GrafanaDataSource[]>([]);

  useEffect(() => {
    getDataSources().then(setDatasources).catch(console.error);
  }, []);

  const filtered = datasources.filter(
    (ds) => !variable.datasourceType || ds.type === variable.datasourceType
  );
  const options = filtered.map((ds) => ({ label: `${ds.name} (${ds.type})`, value: ds.uid }));

  const currentValue = typeof value === 'string' ? value : value[0] ?? '';

  return (
    <Select
      options={options}
      value={currentValue}
      onChange={(val) => onChange(String(val.value))}
      placeholder={`Select ${variable.label || variable.name}`}
    />
  );
}
