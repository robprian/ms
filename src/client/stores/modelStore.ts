import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createSyncStorage } from '../syncStorage'

/** LLM model configuration, mirroring the desktop settings store. */
export interface LlmModelConfig {
  id: string
  name: string
  provider: string
  modelInterface: 'OpenAI-compatible' | 'Anthropic-compatible'
  baseUrl: string
  apiKey: string
  model: string
}

/** Default model presets, translated to English. */
const defaultModels: LlmModelConfig[] = [
  {
    id: 'default-openai',
    name: 'OpenAI',
    provider: 'OpenAI',
    modelInterface: 'OpenAI-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  {
    id: 'default-deepseek',
    name: 'DeepSeek',
    provider: 'DeepSeek',
    modelInterface: 'OpenAI-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
  },
]

interface ModelStoreState {
  models: LlmModelConfig[]
  activeModelId: string | null
  getActiveModel: () => LlmModelConfig | undefined
  addModel: (model: LlmModelConfig) => void
  updateModel: (id: string, patch: Partial<LlmModelConfig>) => void
  deleteModel: (id: string) => void
  setActiveModelId: (id: string | null) => void
}

/**
 * zustand store for LLM model configs, persisted through the Tauri
 * `load_app_state` / `save_app_state` bridge (with a localStorage
 * one-time migration key).
 */
export const useModelStore = create<ModelStoreState>()(
  persist(
    (set, get) => ({
      models: defaultModels,
      activeModelId: 'default-openai',
      getActiveModel: () => {
        const { models, activeModelId } = get()
        return models.find((m) => m.id === activeModelId)
      },
      addModel: (model) =>
        set((s) => ({ models: [...s.models, model] })),
      updateModel: (id, patch) =>
        set((s) => ({
          models: s.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
      deleteModel: (id) =>
        set((s) => ({
          models: s.models.filter((m) => m.id !== id),
          activeModelId: s.activeModelId === id ? null : s.activeModelId,
        })),
      setActiveModelId: (id) => set({ activeModelId: id }),
    }),
    {
      name: 'modelConfig',
      storage: createJSONStorage(() => createSyncStorage('modelConfig', 'museai-model-storage')),
    },
  ),
)
