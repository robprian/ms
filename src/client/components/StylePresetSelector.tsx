import React from 'react';
import { Select, Space, Tag, Typography } from 'antd';
import { useStylePresetStore } from '../stores/useStylePresetStore';
import { resolveStylePresets } from '../utils/stylePresets';

type StylePresetUsage = 'chat' | 'adventure' | 'bookTravel';
const TARGET_LABELS: Record<StylePresetUsage, string> = {
  chat: 'Chat',
  adventure: 'Adventure',
  bookTravel: 'Book Travel',
};

interface StylePresetSelectorProps {
  target: StylePresetUsage;
  value: string | null;
  onChange: (value: string | null) => void;
  compact?: boolean;
  sessionStarted?: boolean;
}

export const StylePresetSelector: React.FC<StylePresetSelectorProps> = ({
  target,
  value,
  onChange,
  sessionStarted = false,
}) => {
  const presets = useStylePresetStore((state) => state.presets);
  const resolved = resolveStylePresets(presets, value ? [value] : []);
  const selectedMissing = Boolean(value && !presets.some((preset) => preset.id === value));

  return (
    <div className="style-preset-selector">
      <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Typography.Text strong>Style Preset</Typography.Text>
          <Tag color="volcano">{TARGET_LABELS[target]}</Tag>
          <Typography.Text type="secondary">Active text: {resolved.totalCharacters} chars</Typography.Text>
        </Space>
        {presets.length > 0 ? (
          <Select
            aria-label={`${TARGET_LABELS[target]} style preset`}
            value={selectedMissing ? undefined : value || undefined}
            options={presets.map((preset) => ({ label: preset.name, value: preset.id }))}
            placeholder={`Choose a ${TARGET_LABELS[target]} style preset`}
            onChange={(next) => onChange(next || null)}
            allowClear
            style={{ width: '100%' }}
          />
        ) : (
          <Typography.Text type="secondary">No presets available yet; create one on the background page first.</Typography.Text>
        )}
        {selectedMissing && <Typography.Text type="warning">The selected preset was deleted and will be ignored automatically when sending.</Typography.Text>}
        {sessionStarted && <Typography.Text type="secondary">Changes only affect future replies and will not change existing conversation history.</Typography.Text>}
      </Space>
    </div>
  );
};
