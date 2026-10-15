/**
 * MuseAI settings page (ported from MuseAI Settings.tsx).
 *
 * Model settings are provided by the <ModelSettingsCard /> component; the page
 * itself shows no API Key / Base URL / interface-type controls. The "LAN access"
 * area has also been removed. The agent config area (AgentSettingCard grid,
 * prompt editing/reset, concurrency card) is preserved as-is.
 *
 * @module @yejiming/dsh-museai-tavern/client/pages/Settings
 */
import React from 'react';
import {
  Form,
  Input,
  Button,
  InputNumber,
  Typography,
  Select,
  message,
  Anchor,
  Card,
} from 'antd';
import {
  SettingOutlined,
  DeploymentUnitOutlined,
  GlobalOutlined,
  MessageOutlined,
  CompassOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  defaultAgentConfigs,
  defaultPartnerChatPrompt,
  defaultBackgroundWorldBookPrompt,
  defaultBackgroundCharacterCardPrompt,
  defaultStoryAgentPrompt,
  defaultStoryDynamicAgentPrompt,
  defaultChatArchivePrompt,
  defaultStoryArchivePrompt,
  defaultSillyTavernExporterPrompt,
} from '../stores/useSettingsStore';
import type { AgentConfig } from '../stores/useSettingsStore';
import { SettingsConcurrencyCard } from '../components/SettingsConcurrencyCard';
import { ModelSettingsCard } from '../components/ModelSettingsCard';

const { Title } = Typography;
const { TextArea } = Input;

const SETTINGS_SIDEBAR_STYLE: React.CSSProperties = {
  width: 180,
  padding: '40px 0 40px 24px',
  borderRight: '1px solid #eae6df',
  overflowY: 'auto',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

// thinkingDepth options (kept in the agent config; the original effortLevelOptions were removed with the model config)
const thinkingDepthOptions = [
  { id: 'off', label: 'Off' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
] as const;

// Reusable elegant configuration card for each Agent
interface AgentSettingCardProps {
  title: string;
  agentId: string;
  defaultPrompt: string;
  currentPrompt: string;
  onSavePrompt: (prompt: string) => void;
  onResetPrompt: () => void;
  helpText: string;
  showModelControls?: boolean;
}

interface AgentFormValues {
  temperature?: number;
  maxOutputTokens?: number;
  maxContextTokens?: number;
  thinkingDepth?: 'off' | 'low' | 'medium' | 'high';
  compactionTurnThreshold?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  topP?: number;
  prompt: string;
}

interface BuildAgentFormValuesOptions {
  config: AgentConfig;
  defaultConfig: AgentConfig;
  prompt: string;
  supportsCompactionTurnThreshold: boolean;
  supportsSamplingControls: boolean;
}

const buildAgentFormValues = ({
  config,
  defaultConfig,
  prompt,
  supportsCompactionTurnThreshold,
  supportsSamplingControls,
}: BuildAgentFormValuesOptions): AgentFormValues => {
  const values: AgentFormValues = {
    temperature: config.temperature ?? defaultConfig.temperature ?? 0.3,
    maxOutputTokens: config.maxOutputTokens ?? defaultConfig.maxOutputTokens ?? 32000,
    maxContextTokens: config.maxContextTokens ?? defaultConfig.maxContextTokens ?? 200000,
    thinkingDepth: config.thinkingDepth ?? defaultConfig.thinkingDepth ?? 'off',
    prompt,
  };
  if (supportsCompactionTurnThreshold) {
    values.compactionTurnThreshold = config.compactionTurnThreshold ?? defaultConfig.compactionTurnThreshold ?? 20;
  }
  if (supportsSamplingControls) {
    values.frequencyPenalty = config.frequencyPenalty ?? defaultConfig.frequencyPenalty ?? 0.3;
    values.presencePenalty = config.presencePenalty ?? defaultConfig.presencePenalty ?? 0.2;
    values.topP = config.topP ?? defaultConfig.topP ?? 0.9;
  }
  return values;
};

const AgentSettingCard: React.FC<AgentSettingCardProps> = ({
  title,
  agentId,
  defaultPrompt,
  currentPrompt,
  onSavePrompt,
  onResetPrompt,
  helpText,
  showModelControls = true,
}) => {
  const store = useSettingsStore();
  const [form] = Form.useForm<AgentFormValues>();
  const defaultConfig = React.useMemo(() => defaultAgentConfigs[agentId] || {}, [agentId]);
  const agentConfig = store.agentConfigs?.[agentId] || defaultConfig;
  const supportsCompactionTurnThreshold = agentId === 'partnerChat' || agentId === 'storyAgent' || agentId === 'storyDynamicAgent';
  const supportsSamplingControls = supportsCompactionTurnThreshold;

  const initialFormValues = buildAgentFormValues({
    config: agentConfig,
    defaultConfig,
    prompt: currentPrompt,
    supportsCompactionTurnThreshold,
    supportsSamplingControls,
  });

  const handleSave = (values: AgentFormValues) => {
    if (showModelControls) {
      const nextConfig = {
        temperature: values.temperature,
        maxOutputTokens: values.maxOutputTokens,
        maxContextTokens: values.maxContextTokens,
        thinkingDepth: values.thinkingDepth,
        ...(supportsCompactionTurnThreshold ? { compactionTurnThreshold: values.compactionTurnThreshold ?? 20 } : {}),
        ...(supportsSamplingControls ? {
          frequencyPenalty: values.frequencyPenalty ?? 0.3,
          presencePenalty: values.presencePenalty ?? 0.2,
          topP: values.topP ?? 0.9,
        } : {}),
      };
      store.setAgentConfig(agentId, nextConfig);
    }
    onSavePrompt(values.prompt);
    message.success(`Saved ${title} settings`);
  };

  const handleReset = () => {
    const values = buildAgentFormValues({
      config: defaultConfig,
      defaultConfig,
      prompt: defaultPrompt,
      supportsCompactionTurnThreshold,
      supportsSamplingControls,
    });
    form.setFieldsValue(values);
    if (showModelControls) {
      const nextConfig = {
        temperature: defaultConfig.temperature,
        maxOutputTokens: defaultConfig.maxOutputTokens,
        maxContextTokens: defaultConfig.maxContextTokens,
        thinkingDepth: defaultConfig.thinkingDepth,
        ...(supportsCompactionTurnThreshold ? { compactionTurnThreshold: defaultConfig.compactionTurnThreshold ?? 20 } : {}),
        ...(supportsSamplingControls ? {
          frequencyPenalty: defaultConfig.frequencyPenalty ?? 0.3,
          presencePenalty: defaultConfig.presencePenalty ?? 0.2,
          topP: defaultConfig.topP ?? 0.9,
        } : {}),
      };
      store.setAgentConfig(agentId, nextConfig);
    }
    onResetPrompt();
    message.success(`Restored default settings for ${title}`);
  };

  return (
    <Card
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #eae6df',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(217, 119, 87, 0.02)',
        marginBottom: '24px',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease'
      }}
      styles={{
        header: {
          borderBottom: '1px solid #f2eee8',
          padding: '16px 24px',
          fontWeight: 600
        },
        body: {
          padding: '24px'
        }
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e' }}>
          <DeploymentUnitOutlined style={{ color: '#d97757' }} />
          <span>{title}</span>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialFormValues}
        onFinish={handleSave}
        requiredMark={false}
      >
        {showModelControls && (
          <div style={{ marginBottom: '20px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: '16px',
                marginBottom: supportsCompactionTurnThreshold ? '16px' : 0
              }}
            >
              <Form.Item label="Temperature" name="temperature" style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="Max output tokens" name="maxOutputTokens" style={{ marginBottom: 0 }}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="Max context tokens" name="maxContextTokens" style={{ marginBottom: 0 }}>
                <InputNumber min={1} step={1024} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="Thinking depth (Depth)" name="thinkingDepth" style={{ marginBottom: 0 }}>
                <Select
                  style={{ width: '100%' }}
                  options={thinkingDepthOptions.map((opt) => ({ value: opt.id, label: opt.label }))}
                />
              </Form.Item>
            </div>
            {supportsCompactionTurnThreshold && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '16px'
                }}
              >
              <Form.Item
                label="Auto-compact turn threshold"
                name="compactionTurnThreshold"
                tooltip="An internal MuseAI context-management parameter used by both OpenAI and Anthropic interfaces. It controls after how many user dialogue turns the backend auto-compacts earlier context; higher values keep the original text longer but cost more tokens."
                style={{ marginBottom: 0 }}
              >
                <InputNumber min={2} max={200} step={1} style={{ width: '100%' }} />
              </Form.Item>
                <Form.Item
                  label="Frequency penalty"
                  name="frequencyPenalty"
                  tooltip="Corresponds to OpenAI's frequency_penalty, for OpenAI-compatible interfaces, used to reduce the probability of repeated phrases. Not supported by the Anthropic interface; MuseAI never sends this parameter to Anthropic requests."
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label="Presence penalty"
                  name="presencePenalty"
                  tooltip="Corresponds to OpenAI's presence_penalty, for OpenAI-compatible interfaces, used to encourage the model to introduce new content and stop circling the same topics. Not supported by the Anthropic interface; MuseAI never sends this parameter to Anthropic requests."
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label="Top P"
                  name="topP"
                  tooltip="Corresponds to OpenAI's top_p, for OpenAI-compatible interfaces, used to control the candidate-token probability range. Some Anthropic models once supported it, but newer Opus models don't support non-default sampling parameters; MuseAI never sends this parameter to Anthropic requests."
                  style={{ marginBottom: 0 }}
                >
                  <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
                </Form.Item>
              </div>
            )}
          </div>
        )}

        <Form.Item
          label="System prompt"
          name="prompt"
          help={<span style={{ color: '#8c8780', fontSize: '12px' }}>{helpText}</span>}
          style={{ marginBottom: '24px' }}
        >
          <TextArea
            rows={8}
            placeholder={`Enter the system prompt for ${title}...`}
            style={{
              resize: 'none',
              backgroundColor: '#faf9f5',
              border: '1px solid #eae6df',
              borderRadius: '8px',
              color: '#33312e',
              fontSize: '14px',
              fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace'
            }}
          />
        </Form.Item>

        <div style={{ display: 'flex', gap: '12px' }}>
          <Button
            type="primary"
            htmlType="submit"
            style={{
              backgroundColor: '#d97757',
              borderColor: '#d97757',
              color: '#ffffff',
              fontWeight: 500,
              borderRadius: '6px'
            }}
          >
            Save settings
          </Button>
          <Button
            onClick={handleReset}
            style={{
              borderColor: '#eae6df',
              color: '#5c5751',
              borderRadius: '6px'
            }}
          >
            Restore defaults
          </Button>
        </div>
      </Form>
    </Card>
  );
};

const useSettingsView = () => {
  const store = useSettingsStore();

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#faf9f5' }}>
      {/* Left sidebar menu */}
      <div style={SETTINGS_SIDEBAR_STYLE}>
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'dsh-model-config', href: '#dsh-model-config', title: 'Model selection' },
          ]}
        />
        <Anchor
          affix={false}
          getContainer={() => document.getElementById('settings-scroll-container') as HTMLElement}
          onClick={(e) => e.preventDefault()}
          items={[
            { key: 'background-config', href: '#background-config', title: 'Background page settings' },
            { key: 'partner-chat-config', href: '#partner-chat-config', title: 'Chat page settings' },
            { key: 'story-agent-config', href: '#story-agent-config', title: 'Adventure page settings' },
          ]}
        />
      </div>

      {/* Main content area on the right */}
      <div id="settings-scroll-container" style={{ flex: 1, padding: '40px 48px', overflowY: 'auto', paddingBottom: 120 }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>

          <Title level={2} style={{ fontWeight: 600, color: '#33312e', marginBottom: 40, letterSpacing: '-0.5px', fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
            Settings
          </Title>

          {/* Model selection area */}
          <section id="dsh-model-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <SettingOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>Model Selection</Title>
            </div>

            <ModelSettingsCard />
          </section>

          {/* Background page settings area */}
          <section id="background-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <GlobalOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>Background Settings</Title>
            </div>

            <SettingsConcurrencyCard
              agentId="backgroundExtraction"
              label="Background extraction concurrency"
              helpText="Only used for parallel character card extraction. Default 5; 20 or fewer is recommended."
              saveMessage="Saved background extraction concurrency"
            />

            <AgentSettingCard
              title="Extract world book"
              agentId="backgroundWorldBook"
              defaultPrompt={defaultBackgroundWorldBookPrompt}
              currentPrompt={store.backgroundWorldBookPrompt}
              onSavePrompt={store.setBackgroundWorldBookPrompt}
              onResetPrompt={store.resetBackgroundWorldBookPrompt}
              helpText="This prompt is used for phase 1 of AI background extraction: generating the world book and, in full mode, extracting the character name list."
            />

            <AgentSettingCard
              title="Extract character cards"
              agentId="backgroundCharacterCard"
              defaultPrompt={defaultBackgroundCharacterCardPrompt}
              currentPrompt={store.backgroundCharacterCardPrompt}
              onSavePrompt={store.setBackgroundCharacterCardPrompt}
              onResetPrompt={store.resetBackgroundCharacterCardPrompt}
              helpText="This prompt is used for phase 2 of AI background extraction: generating structured character cards per character name."
            />

            <AgentSettingCard
              title="SillyTavern character card converter"
              agentId="sillyTavernExporter"
              defaultPrompt={defaultSillyTavernExporterPrompt}
              currentPrompt={store.sillyTavernExporterPrompt}
              onSavePrompt={store.setSillyTavernExporterPrompt}
              onResetPrompt={store.resetSillyTavernExporterPrompt}
              helpText="This prompt converts MuseAI character cards to the SillyTavern character card V2 format on export. Defaults to temperature 0, max_tokens 32000, and thinking depth high."
            />
          </section>

          {/* Chat page settings area */}
          <section id="partner-chat-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <MessageOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>Chat Settings</Title>
            </div>

            <AgentSettingCard
              title="Partner chat agent"
              agentId="partnerChat"
              defaultPrompt={defaultPartnerChatPrompt}
              currentPrompt={store.partnerChatPrompt}
              onSavePrompt={store.setPartnerChatPrompt}
              onResetPrompt={store.resetPartnerChatPrompt}
              helpText="This prompt is the core system prompt for the chat agent in the partner chat room. The selected world book, character card, and user profile are automatically appended at the end."
            />
                      <AgentSettingCard
              title="Chat memory archivist"
              agentId="chatArchive"
              defaultPrompt={defaultChatArchivePrompt}
              currentPrompt={store.chatArchivePrompt}
              onSavePrompt={store.setChatArchivePrompt}
              onResetPrompt={store.resetChatArchivePrompt}
              helpText="This prompt is used when tapping “Archive memory” on the chat page: the AI analyzes the full conversation and extracts relationship changes, key events, and a suggested session title."
            /></section>

          {/* Adventure page settings area */}
          <section id="story-agent-config" style={{ marginBottom: 48 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <CompassOutlined style={{ fontSize: '20px', color: '#d97757' }} />
              <Title level={4} style={{ color: '#33312e', margin: 0, fontWeight: 600, fontFamily: '"Inter", "Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>Adventure Settings</Title>
            </div>

            <AgentSettingCard
              title="Adventure host (no dynamic loading)"
              agentId="storyAgent"
              defaultPrompt={defaultStoryAgentPrompt}
              currentPrompt={store.storyAgentPrompt}
              onSavePrompt={store.setStoryAgentPrompt}
              onResetPrompt={store.resetStoryAgentPrompt}
              helpText="This prompt is the core system prompt for the story agent (GM) in tabletop/text-adventure stories. The selected world book, multiple character cards, and user profile are automatically appended at the end. The first user message is the entered opening scenario."
            />

            <AgentSettingCard
              title="Adventure host (dynamic character-card loading)"
              agentId="storyDynamicAgent"
              defaultPrompt={defaultStoryDynamicAgentPrompt}
              currentPrompt={store.storyDynamicAgentPrompt}
              onSavePrompt={store.setStoryDynamicAgentPrompt}
              onResetPrompt={store.resetStoryDynamicAgentPrompt}
              helpText="Use this config when dynamic character-card loading is enabled. This prompt emphasizes that the character's own speech must be generated via role_play."
            />
                      <AgentSettingCard
              title="Adventure memory archivist"
              agentId="storyArchive"
              defaultPrompt={defaultStoryArchivePrompt}
              currentPrompt={store.storyArchivePrompt}
              onSavePrompt={store.setStoryArchivePrompt}
              onResetPrompt={store.resetStoryArchivePrompt}
              helpText="This prompt is used when tapping “Archive memory” on the adventure page: the AI analyzes the full adventure and extracts relationship changes, key events, and a suggested session title."
            /></section>
        </div>
      </div>
    </div>
  );
};

export const SettingsPage: React.FC = () => useSettingsView();
