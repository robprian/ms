/**
 * Tauri backend half of the museai model/store bridge. Every exported symbol
 * name, parameter order and return type matches the original plugin api.ts,
 * but the internals call the yejiming/MuseAI Tauri commands instead of the
 * DSH HTTP plugin routes.
 *
 * - chat/complete -> `start_chat_completion_stream` + `agent-chat-stream` events
 * - sessions      -> `list_agent_sessions` / `save_agent_session` /
 *                   `load_agent_session` / `delete_agent_session`
 * - store         -> `load_app_state` / `save_app_state`
 * @module museai/client/api
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useModelStore } from './stores/modelStore'
import { useSettingsStore } from './stores/useSettingsStore'

/** Wire message of a chat/completion request. */
export interface WireMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Streaming chat request body (agentId selects an agent-config preset). */
export interface ChatRequestWire {
  agentId?: string
  system?: string
  messages: WireMessage[]
  temperature?: number
  maxTokens?: number
  thinkingDepth?: 'off' | 'low' | 'medium' | 'high'
}

/** NDJSON events emitted by /chat (subset the pages consume). */
export type ChatStreamEventWire =
  | { event: 'start'; runId: string }
  | { event: 'delta'; runId: string; delta: string }
  | { event: 'thinking_delta'; runId: string; delta: string }
  | { event: 'done'; runId: string; text: string; reasoning: string }
  | { event: 'error'; runId: string; message: string }
  | { event: 'aborted'; runId: string }

/** One-shot completion response. */
export interface CompleteResponseWire {
  text: string
  reasoning: string
}

/** zustand persist envelope as stored server-side. */
export interface StoreBlobWire {
  state: Record<string, unknown>
  version: number
}

/** Session record wire shape (subset the pages persist). */
export interface SessionRecordWire {
  id: string
  title: string
  savedAt: number
  sessionKind?: 'chat' | 'story' | 'bookTravel'
  characterCardId?: string | null
  characterCardIds?: string[] | null
  selectedWorldBookId?: string | null
  dynamicRoleLoadingEnabled?: boolean
  messages: {
    id: string
    role: 'user' | 'agent'
    content: string
    thinking?: string
    thinkingBlocks?: { id: string; content: string; signature?: string }[]
    tools?: { id?: string; name: string; result: string; status?: string; arguments?: string }[]
    articleType?: string
    suggestedChoices?: string[]
  }[]
  todos?: { content: string; status: string }[]
  contextCompaction?: unknown
  isArchived?: boolean
  selectedStylePresetIds?: string[]
  initialStylePresetIds?: string[]
  initialSystemPromptSnapshot?: string | null
  bookTravelState?: unknown
}

/** Session summary wire shape of GET /sessions/<kind>. */
export interface SessionSummaryWire {
  id: string
  title: string
  savedAt: number
  sessionKind?: 'chat' | 'story' | 'bookTravel'
  characterCardId?: string | null
  characterCardIds?: string[] | null
  selectedWorldBookId?: string | null
  dynamicRoleLoadingEnabled?: boolean
  messageCount: number
}

/**
 * Start a chat stream via the Tauri backend and re-emit the desktop's
 * `agent-chat-stream` payloads as ChatStreamEventWire events.
 * @param request - the validated request body.
 * @param onEvent - called for every stream event.
 * @param signal - abort to stop generation (the backend terminates the model
 * call and we emit `aborted`).
 */
export async function streamChat(
  request: ChatRequestWire,
  onEvent: (event: ChatStreamEventWire) => void,
  signal?: AbortSignal,
): Promise<void> {
  const model = useModelStore.getState().getActiveModel()
  if (!model) {
    throw new Error('No model configured. Open Settings > Model Configuration to add one.')
  }
  const agentConfigs = useSettingsStore.getState().agentConfigs ?? {}
  const agentId = request.agentId ?? 'partnerChat'
  const cfg = (agentConfigs as Record<string, {
    temperature?: number
    maxOutputTokens?: number
    maxContextTokens?: number
    thinkingDepth?: 'off' | 'low' | 'medium' | 'high'
    frequencyPenalty?: number
    presencePenalty?: number
    topP?: number
  }>)[agentId] ?? {}

  const tauriReq = {
    agentId,
    modelInterface: model.modelInterface,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: model.model,
    temperature: request.temperature ?? cfg.temperature ?? 0.7,
    maxOutputTokens: request.maxTokens ?? cfg.maxOutputTokens ?? 32000,
    maxContextTokens: cfg.maxContextTokens ?? 200000,
    thinkingDepth: request.thinkingDepth ?? cfg.thinkingDepth ?? 'off',
    frequencyPenalty: cfg.frequencyPenalty,
    presencePenalty: cfg.presencePenalty,
    topP: cfg.topP,
    systemPrompt: request.system ?? '',
    workspacePath: null,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    selectedReferenceFiles: [],
    allowedTools: [],
  }

  // The Tauri command returns the run id directly (Result<String, String>).
  const runId: string = await invoke('start_chat_completion_stream', { request: tauriReq })
  onEvent({ event: 'start', runId })

  let text = ''
  let reasoning = ''
  let cleaned = false
  let unlisten: (() => void) | null = null

  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    if (unlisten) {
      unlisten()
      unlisten = null
    }
    signal?.removeEventListener('abort', onAbort)
  }
  const onAbort = (): void => {
    void invoke('stop_chat_stream', { runId }).catch(() => {})
    cleanup()
    onEvent({ event: 'aborted', runId })
  }

  if (signal?.aborted) {
    onAbort()
    return
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  unlisten = await listen('agent-chat-stream', (e: { payload?: Record<string, unknown> }) => {
    const p = e.payload
    if (!p || p.runId !== runId) return
    const eventType = p.eventType as string | undefined
    const delta = typeof p.delta === 'string' ? p.delta : undefined
    if (eventType === 'delta' && delta) {
      text += delta
      onEvent({ event: 'delta', runId, delta })
    } else if (eventType === 'thinking_delta' && delta) {
      reasoning += delta
      onEvent({ event: 'thinking_delta', runId, delta })
    } else if (eventType === 'done') {
      cleanup()
      onEvent({ event: 'done', runId, text, reasoning })
    } else if (eventType === 'error') {
      cleanup()
      const message = typeof p.message === 'string' ? p.message : 'Model request failed'
      onEvent({ event: 'error', runId, message })
    }
    // Ignore thinking_signature / tool_* / todo_update / context_compacted.
  })
}

/**
 * One-shot generation implemented on top of streamChat, preserving the
 * original `complete(request)` parameter order plus an optional abort signal.
 */
export async function complete(
  request: ChatRequestWire,
  abortSignal?: AbortSignal,
): Promise<CompleteResponseWire> {
  return new Promise((resolve, reject) => {
    let text = ''
    let reasoning = ''
    const ctrl = new AbortController()
    const onFwdAbort = (): void => ctrl.abort()
    if (abortSignal) {
      if (abortSignal.aborted) {
        ctrl.abort()
      } else {
        abortSignal.addEventListener('abort', onFwdAbort, { once: true })
      }
    }
    const doneListening = (): void => abortSignal?.removeEventListener('abort', onFwdAbort)
    streamChat(
      request,
      (ev) => {
        if (ev.event === 'delta' && ev.delta) {
          text += ev.delta
        } else if (ev.event === 'thinking_delta' && ev.delta) {
          reasoning += ev.delta
        } else if (ev.event === 'done') {
          doneListening()
          resolve({ text: ev.text ?? text, reasoning: ev.reasoning ?? reasoning })
        } else if (ev.event === 'error') {
          doneListening()
          reject(new Error(ev.message || 'Completion failed'))
        } else if (ev.event === 'aborted') {
          doneListening()
          reject(new Error('aborted'))
        }
      },
      ctrl.signal,
    ).catch((err: unknown) => {
      doneListening()
      reject(err)
    })
  })
}

/** load_app_state — one store envelope; undefined when nothing is stored. */
export async function getStore(key: string): Promise<StoreBlobWire | undefined> {
  try {
    const content: string = await invoke('load_app_state', { name: key })
    return JSON.parse(content) as StoreBlobWire
  } catch {
    return undefined
  }
}

/** save_app_state — write one store envelope. */
export async function putStore(key: string, blob: StoreBlobWire): Promise<void> {
  await invoke('save_app_state', { name: key, content: JSON.stringify(blob) })
}

/** Shape returned by the Rust list_agent_sessions command (camelCase via serde). */
interface AgentSessionSummaryDto {
  id: string
  title: string
  savedAt: number
  sessionKind?: string | null
  characterCardId?: string | null
  characterCardIds?: string[] | null
  selectedWorldBookId?: string | null
  dynamicRoleLoadingEnabled?: boolean | null
}

/** list_agent_sessions — session summaries for a session kind. */
export async function listSessions(kind: 'partner' | 'story'): Promise<SessionSummaryWire[]> {
  const args =
    kind === 'story'
      ? { prefix: 'story-session-', sessionKind: 'story' }
      : { prefix: 'partner-session-' }
  const summaries = await invoke<AgentSessionSummaryDto[]>('list_agent_sessions', args)
  return summaries.map((s) => ({
    id: s.id,
    title: s.title,
    savedAt: s.savedAt,
    sessionKind: (s.sessionKind ?? undefined) as SessionSummaryWire['sessionKind'],
    characterCardId: s.characterCardId ?? null,
    characterCardIds: s.characterCardIds ?? null,
    selectedWorldBookId: s.selectedWorldBookId ?? null,
    dynamicRoleLoadingEnabled: s.dynamicRoleLoadingEnabled ?? undefined,
    messageCount: 0,
  }))
}

/** load_agent_session — one full session record. */
export async function loadSession(kind: 'partner' | 'story', id: string): Promise<SessionRecordWire> {
  void kind
  return invoke<SessionRecordWire>('load_agent_session', { id })
}

/** save_agent_session — save one session record. */
export async function saveSession(kind: 'partner' | 'story', record: SessionRecordWire): Promise<void> {
  void kind
  await invoke('save_agent_session', { session: record })
}

/** delete_agent_session — remove one session record. */
export async function deleteSession(kind: 'partner' | 'story', id: string): Promise<boolean> {
  void kind
  await invoke('delete_agent_session', { id })
  return true
}
