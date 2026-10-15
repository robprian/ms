/**
 * "Model Configuration" card: list LLM model configs, select the active one,
 * add/edit/delete, and test the connection against the Tauri backend.
 * All UI strings are English.
 */
import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Radio,
  Select,
  Space,
  message,
} from 'antd'
import { invoke } from '@tauri-apps/api/core'
import { useModelStore, type LlmModelConfig } from '../stores/modelStore'

type ModelFormValues = {
  name: string
  provider: string
  modelInterface: 'OpenAI-compatible' | 'Anthropic-compatible'
  baseUrl: string
  apiKey: string
  model: string
}

const INTERFACE_OPTIONS = [
  { value: 'OpenAI-compatible', label: 'OpenAI-compatible' },
  { value: 'Anthropic-compatible', label: 'Anthropic-compatible' },
]

/** The "Model Configuration" card for the Settings page. */
export function ModelSettingsCard(): JSX.Element {
  const { models, activeModelId, getActiveModel, addModel, updateModel, deleteModel, setActiveModelId } =
    useModelStore()
  const [form] = Form.useForm<ModelFormValues>()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)

  const openAdd = (): void => {
    setEditingId(null)
    form.setFieldsValue({
      name: '',
      provider: '',
      modelInterface: 'OpenAI-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
    })
    setModalOpen(true)
  }

  const openEdit = (model: LlmModelConfig): void => {
    setEditingId(model.id)
    form.setFieldsValue({
      name: model.name,
      provider: model.provider,
      modelInterface: model.modelInterface,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
    })
    setModalOpen(true)
  }

  const handleOk = async (): Promise<void> => {
    const values = await form.validateFields()
    if (editingId) {
      updateModel(editingId, values)
      message.success('Model updated')
    } else {
      const id = `model-${Date.now()}`
      addModel({ id, ...values })
      if (!getActiveModel()) setActiveModelId(id)
      message.success('Model added')
    }
    setModalOpen(false)
  }

  const handleTestConnection = async (model: LlmModelConfig): Promise<void> => {
    setTestingId(model.id)
    try {
      const result = await invoke<string>('test_llm_connection', {
        request: {
          modelInterface: model.modelInterface,
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          model: model.model,
        },
      })
      message.success(`Connection test succeeded: ${result}`)
    } catch (err) {
      const errMsg = typeof err === 'string' ? err : (err as Error)?.message ?? JSON.stringify(err)
      message.error(`Connection test failed: ${errMsg}`)
    } finally {
      setTestingId(null)
    }
  }

  return (
    <Card title="Model Configuration" style={{ marginBottom: 16 }}>
      <List
        dataSource={models}
        locale={{ emptyText: 'No models configured. Add one to get started.' }}
        renderItem={(model) => (
          <List.Item
            actions={[
              <Button key="test" type="link" loading={testingId === model.id} onClick={() => handleTestConnection(model)}>
                Test connection
              </Button>,
              <Button key="edit" type="link" onClick={() => openEdit(model)}>
                Edit
              </Button>,
              <Button
                key="delete"
                type="link"
                danger
                onClick={() => {
                  Modal.confirm({
                    title: 'Delete this model?',
                    content: `Delete model "${model.name}"?`,
                    okText: 'Delete',
                    okButtonProps: { danger: true },
                    onOk: () => {
                      deleteModel(model.id)
                      message.success('Model deleted')
                    },
                  })
                }}
              >
                Delete
              </Button>,
            ]}
          >
            <Radio
              checked={model.id === activeModelId}
              onChange={() => setActiveModelId(model.id)}
              style={{ marginRight: 8 }}
            />
            <List.Item.Meta
              title={model.name}
              description={`${model.provider} · ${model.model} (${model.modelInterface})`}
            />
          </List.Item>
        )}
      />
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" onClick={openAdd}>
          Add model
        </Button>
      </Space>
      <Modal
        title={editingId ? 'Edit model' : 'Add model'}
        open={modalOpen}
        okText={editingId ? 'Save' : 'Add'}
        cancelText="Cancel"
        onOk={handleOk}
        onCancel={() => setModalOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Please enter a name' }]}>
            <Input placeholder="e.g. OpenAI" />
          </Form.Item>
          <Form.Item name="provider" label="Provider" rules={[{ required: true, message: 'Please enter a provider' }]}>
            <Input placeholder="e.g. OpenAI" />
          </Form.Item>
          <Form.Item name="modelInterface" label="Interface" rules={[{ required: true }]}>
            <Select options={INTERFACE_OPTIONS} />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: 'Please enter the base URL' }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API key">
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item name="model" label="Model" rules={[{ required: true, message: 'Please enter the model id' }]}>
            <Input placeholder="gpt-4o-mini" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
