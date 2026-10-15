/**
 * Ported MuseAI Chat page (partner chat): streaming dialogue against a character
 * card / world book, with session save/load/rename/delete, memory archiving,
 * context usage ring, message editing/regeneration and style presets.
 *
 * All model traffic goes through the plugin's browser API (`src/client/api.ts`):
 * - streaming: `streamChat(request, onEvent, abortSignal)` (NDJSON events)
 * - session title: `complete(...)` → `.text`
 * - memory archiving: `complete(...)` → `.text` parsed by archiveAnalysis
 * - session CRUD: `listSessions` / `loadSession` / `saveSession` / `deleteSession`
 *   with kind 'partner'.
 * @module @yejiming/dsh-museai-tavern/client/pages/Chat
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Button, Tooltip, Tag, Input, message, Modal, Spin } from 'antd';
import {
  BulbOutlined,
  HistoryOutlined,
  ReloadOutlined,
  MessageOutlined,
  StopOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  InfoCircleOutlined,
  UserOutlined,
  BookOutlined,
  FileProtectOutlined,
  SaveOutlined,
  RedoOutlined,
  EditOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { complete, deleteSession, listSessions, loadSession, saveSession, streamChat } from '../api';
import type { ChatRequestWire, ChatStreamEventWire, WireMessage } from '../api';

import { useSettingsStore } from '../stores/useSettingsStore';
import { usePartnerStore, type PartnerItemFields } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { useModelStore } from '../stores/modelStore';
import { Message, SessionContextCompaction } from '../stores/useAgentStore';
import { PartnerChatSettingsModal } from '../components/PartnerChatSettingsModal';
import { SessionHistoryModal } from '../components/SessionHistoryModal';
import SaveChoiceModal, { type SaveChoiceConfirmPayload } from '../components/SaveChoiceModal';
import { parseArchiveAnalysisResponse } from '../utils/archiveAnalysis';
import { createStableContentKey } from '../utils/renderKeys';
import { useStateGroup } from '../utils/reducerState';
import { createSessionId, ensureSessionId } from '../utils/sessionIds';
import { getEffectiveMessagesForContextStats } from '../utils/contextCompaction';
import { resolveSessionTitle } from '../utils/sessionTitle';
import { buildSessionHistoryDetails } from '../utils/sessionHistory';
import { StylePresetSelector } from '../components/StylePresetSelector';
import { useStylePresetStore } from '../stores/useStylePresetStore';
import { prependStylePresets } from '../utils/stylePresets';

interface ChatUiState {
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;
  isArchiveModalOpen: boolean;
  isSaveChoiceOpen: boolean;
  isAnalyzing: boolean;
  isSavingConversation: boolean;
  saveChoiceTitle: string;
  saveChoiceOverwriteAvailable: boolean;
  archiveAnalysis: ArchiveAnalysis | null;
  editedTitle: string;
  editedRelationType: string;
  editedRelationModel: string;
  editedRelationBottomLine: string;
  editedEvents: string;
  editingMessageId: string | null;
  editingContent: string;
}

/** Parsed fields of the memory-archive analysis JSON. */
interface ArchiveAnalysis {
  sessionTitle?: string;
  userRelationType?: string;
  userInteractionModel?: string;
  userRelationBottomLine?: string;
  keyEvents?: string;
  relationChanges?: string;
  eventChanges?: string;
}

/** Generation params shared by the chat / title / archive `complete` calls. */
interface ChatGenParams {
  system?: string;
  messages: WireMessage[];
  temperature?: number;
  maxTokens?: number;
  thinkingDepth?: 'off' | 'low' | 'medium' | 'high';
}

const USER_INFO_LABELS: Record<string, string> = {
  name: 'Name',
  age: 'Age',
  gender: 'Gender',
  race: 'Race',
  birthplace: 'Birthplace',
  occupation: 'Occupation',
  socialClass: 'Social Class',
  heightBuild: 'Height & Build',
  iconicFeatures: 'Signature Features',
  clothingStyle: 'Clothing Style',
  overallVibe: 'Overall Vibe',
  externalPersonality: 'Outer Personality',
  internalPersonality: 'Inner Personality',
  coreDesire: 'Core Desire',
  fearWeakness: 'Fears & Weaknesses',
  moralValues: 'Moral Code',
  quirk: 'Quirks',
  skills: 'Skills & Expertise',
  backgroundStory: 'Backstory',
  relationships: 'Relationships',
  speakingStyle: 'Way of Speaking',
  typicalReactions: 'Typical Reactions'
};

const CHAT_EMPTY_STATE_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '0 24px',
  maxWidth: '800px',
  margin: '0 auto',
  width: '100%',
};

const CHAT_COMPOSER_ACTIONS_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '12px',
  left: '16px',
  right: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  zIndex: 3,
};

const filterBlankMarkdownFields = (content: string): string => {
  const lines = content.split('\n');

  // Pass 1: drop list-item lines whose value is empty
  const afterListFilter = lines.filter(line => !/^\s*-\s*\*\*[^*]+\*\*：\s*$/.test(line));

  // Pass 2: drop empty level-2 heading blocks with no real content after them
  const result: string[] = [];
  let i = 0;
  while (i < afterListFilter.length) {
    const line = afterListFilter[i];
    if (/^##\s/.test(line)) {
      let j = i + 1;
      while (j < afterListFilter.length && afterListFilter[j].trim() === '') {
        j++;
      }
      // If another heading or EOF follows directly, this block is empty — skip it
      if (j >= afterListFilter.length || /^##\s/.test(afterListFilter[j]) || /^# /.test(afterListFilter[j])) {
        i = j;
        continue;
      }
    }
    result.push(line);
    i++;
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const compileEffectiveSystemPrompt = (
  basePrompt: string,
  worldBookContent: string | null,
  characterCardContent: string | null,
  userInfo: Partial<PartnerItemFields>
): string => {
  let prompt = basePrompt.trim();

  if (worldBookContent && worldBookContent.trim()) {
    prompt += `\n\n## Partner Chat World Setting\nStrictly follow the world background below when conversing; do not go beyond it:\n${filterBlankMarkdownFields(worldBookContent.trim())}`;
  }

  if (characterCardContent && characterCardContent.trim()) {
    prompt += `\n\n## Your Character Persona (Partner Persona)\nYou must always play this character; tone, actions, voice, guardedness and personality should stay highly consistent with this card:\n${filterBlankMarkdownFields(characterCardContent.trim())}`;
  }

  const userFieldLines: string[] = [];
  for (const [k, v] of Object.entries(userInfo)) {
    if (USER_INFO_LABELS[k] && typeof v === 'string' && v.trim() !== '') {
      userFieldLines.push(`- **${USER_INFO_LABELS[k]}**：${v}`);
    }
  }
  const userFields = userFieldLines.join('\n');

  if (userFields) {
    prompt += `\n\n## My (the User's) Persona\nThis is the persona background of the user you are talking to — remember it and adopt the matching relational attitude and way of speaking:\n${userFields}`;
  }

  return prompt;
};

const estimateContextUsage = (systemPrompt: string, messages: Message[], draft: string) => {
  let userText = draft;
  let assistantText = '';
  for (const message of messages) {
    if (message.role === 'user') {
      userText += message.content;
    }
    if (message.role === 'agent') {
      assistantText += message.content;
    }
  }
  const stats = {
    system: Math.max(0, Math.ceil(systemPrompt.length * 1.5)),
    user: Math.max(0, Math.ceil(userText.length * 1.5)),
    assistant: Math.max(0, Math.ceil(assistantText.length * 1.5))
  };
  return {
    ...stats,
    messageCount: messages.length,
    total: stats.system + stats.user + stats.assistant,
  };
};

const useChatView = () => {
  const {
    messages, setMessages,
    input, setInput,
    isStreaming, setIsStreaming,
    expandedBlocks, setExpandedBlocks,
    selectedWorldBookId, selectedCharacterCardId,
    setSelectedWorldBookId, setSelectedCharacterCardId,
    userInfo,
    sessions, setSessions,
    sessionId, setSessionId,
    sessionTitle, setSessionTitle,
    activeRun, setActiveRun,
    createNewSession,
    isSessionArchived, setIsSessionArchived,
    contextCompaction, setContextCompaction,
    selectedStylePresetIds, setSelectedStylePresetIds,
    initialStylePresetIds, initialSystemPromptSnapshot, setInitialStylePresetSnapshot
  } = usePartnerChatStore();

  const { worldBooks, characterCards, updateItemFields } = usePartnerStore();
  const settings = useSettingsStore();
  const stylePresets = useStylePresetStore((state) => state.presets);
  const activeModel = useModelStore((s) => s.getActiveModel());

  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const currentThinkingIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeRunRef = useRef(activeRun);
  const messagesRef = useRef(messages);
  const sessionsRef = useRef(sessions);
  const sessionIdRef = useRef(sessionId);
  const sessionTitleRef = useRef(sessionTitle);
  const isSessionArchivedRef = useRef(isSessionArchived);
  const selectedWorldBookIdRef = useRef(selectedWorldBookId);
  const selectedCharacterCardIdRef = useRef(selectedCharacterCardId);
  const contextCompactionRef = useRef<SessionContextCompaction | null>(contextCompaction);
  const selectedStylePresetIdsRef = useRef(selectedStylePresetIds);
  const initialStylePresetIdsRef = useRef(initialStylePresetIds);
  const initialSystemPromptSnapshotRef = useRef(initialSystemPromptSnapshot);

  const [uiState, , setUiField] = useStateGroup<ChatUiState>({
    isSettingsOpen: false,
    isHistoryOpen: false,
    isArchiveModalOpen: false,
    isSaveChoiceOpen: false,
    isAnalyzing: false,
    isSavingConversation: false,
    saveChoiceTitle: '',
    saveChoiceOverwriteAvailable: false,
    archiveAnalysis: null,
    editedTitle: '',
    editedRelationType: '',
    editedRelationModel: '',
    editedRelationBottomLine: '',
    editedEvents: '',
    editingMessageId: null,
    editingContent: '',
  });
  const {
    isSettingsOpen,
    isHistoryOpen,
    isArchiveModalOpen,
    isSaveChoiceOpen,
    isAnalyzing,
    isSavingConversation,
    saveChoiceTitle,
    saveChoiceOverwriteAvailable,
    archiveAnalysis,
    editedTitle,
    editedRelationType,
    editedRelationModel,
    editedRelationBottomLine,
    editedEvents,
    editingMessageId,
    editingContent,
  } = uiState;
  const setIsSettingsOpen = (isSettingsOpen: boolean) => setUiField('isSettingsOpen', isSettingsOpen);
  const setIsHistoryOpen = (isHistoryOpen: boolean) => setUiField('isHistoryOpen', isHistoryOpen);
  const setIsArchiveModalOpen = (isArchiveModalOpen: boolean) => setUiField('isArchiveModalOpen', isArchiveModalOpen);
  const setIsSaveChoiceOpen = (isSaveChoiceOpen: boolean) => setUiField('isSaveChoiceOpen', isSaveChoiceOpen);
  const setIsAnalyzing = (isAnalyzing: boolean) => setUiField('isAnalyzing', isAnalyzing);
  const setIsSavingConversation = (isSavingConversation: boolean) => setUiField('isSavingConversation', isSavingConversation);
  const setSaveChoiceTitle = (saveChoiceTitle: string) => setUiField('saveChoiceTitle', saveChoiceTitle);
  const setSaveChoiceOverwriteAvailable = (saveChoiceOverwriteAvailable: boolean) => setUiField('saveChoiceOverwriteAvailable', saveChoiceOverwriteAvailable);
  const setArchiveAnalysis = (archiveAnalysis: ArchiveAnalysis | null) => setUiField('archiveAnalysis', archiveAnalysis);
  const setEditedTitle = (editedTitle: string) => setUiField('editedTitle', editedTitle);
  const setEditedRelationType = (editedRelationType: string) => setUiField('editedRelationType', editedRelationType);
  const setEditedRelationModel = (editedRelationModel: string) => setUiField('editedRelationModel', editedRelationModel);
  const setEditedRelationBottomLine = (editedRelationBottomLine: string) => setUiField('editedRelationBottomLine', editedRelationBottomLine);
  const setEditedEvents = (editedEvents: string) => setUiField('editedEvents', editedEvents);
  const setEditingMessageId = (editingMessageId: string | null) => setUiField('editingMessageId', editingMessageId);
  const setEditingContent = (editingContent: string) => setUiField('editingContent', editingContent);

  const refreshSessions = useCallback(async () => {
    try {
      const summaries = await listSessions('partner');
      setSessions(summaries);
      sessionsRef.current = summaries;
      return summaries;
    } catch (err) {
      console.error('Failed to load chat history:', err);
      return sessionsRef.current;
    }
  }, [setSessions]);

  const ensureCurrentSessionId = useCallback(() => {
    const nextSessionId = ensureSessionId(sessionIdRef.current, 'partner-session');
    if (nextSessionId !== sessionIdRef.current) {
      sessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
    }
    return nextSessionId;
  }, [setSessionId]);

  const saveCurrentSession = useCallback(async (title = sessionTitleRef.current, sessionIdOverride?: string) => {
    const userMessages = messagesRef.current.filter(m => m.role === 'user');
    if (userMessages.length === 0) return false;
    const currentSessionId = sessionIdOverride
      ? ensureSessionId(sessionIdOverride, 'partner-session')
      : ensureCurrentSessionId();

    try {
      await saveSession('partner', {
        id: currentSessionId,
        title,
        savedAt: Date.now(),
        messages: messagesRef.current,
        todos: [],
        contextCompaction: contextCompactionRef.current,
        isArchived: isSessionArchivedRef.current,
        characterCardId: selectedCharacterCardIdRef.current,
        selectedWorldBookId: selectedWorldBookIdRef.current,
        selectedStylePresetIds: selectedStylePresetIdsRef.current,
        initialStylePresetIds: initialStylePresetIdsRef.current,
        initialSystemPromptSnapshot: initialSystemPromptSnapshotRef.current,
      });
      await refreshSessions();
      return currentSessionId;
    } catch (err) {
      console.error('Failed to save session:', err);
      return false;
    }
  }, [ensureCurrentSessionId, refreshSessions]);

  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);
  useEffect(() => { isSessionArchivedRef.current = isSessionArchived; }, [isSessionArchived]);
  useEffect(() => { selectedWorldBookIdRef.current = selectedWorldBookId; }, [selectedWorldBookId]);
  useEffect(() => { selectedCharacterCardIdRef.current = selectedCharacterCardId; }, [selectedCharacterCardId]);
  useEffect(() => { contextCompactionRef.current = contextCompaction; }, [contextCompaction]);
  useEffect(() => { selectedStylePresetIdsRef.current = selectedStylePresetIds; }, [selectedStylePresetIds]);
  useEffect(() => { initialStylePresetIdsRef.current = initialStylePresetIds; }, [initialStylePresetIds]);
  useEffect(() => { initialSystemPromptSnapshotRef.current = initialSystemPromptSnapshot; }, [initialSystemPromptSnapshot]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const scrollToBottomOnce = () => {
    window.requestAnimationFrame(() => {
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottomOnce();
    }
  }, [messages.length]);

  const selectedWorldBook = worldBooks.find(wb => wb.id === selectedWorldBookId) || null;
  const selectedCharacterCard = characterCards.find(cc => cc.id === selectedCharacterCardId) || null;

  // Compile final Prompt
  const baseSystemPrompt = prependStylePresets(
    settings.partnerChatPrompt || '',
    stylePresets,
    selectedStylePresetIds,
  );
  const effectiveSystemPrompt = compileEffectiveSystemPrompt(
    baseSystemPrompt,
    selectedWorldBook ? selectedWorldBook.content : null,
    selectedCharacterCard ? selectedCharacterCard.content : null,
    userInfo
  );

  /**
   * Build the request object for `streamChat` / `complete`.
   * The api adapter resolves the active model itself, so only the agent id
   * plus generation params are attached here.
   */
  const buildModelRequest = (params: ChatGenParams): ChatRequestWire => {
    return { agentId: 'partnerChat', ...params };
  };

  /** Shared stream-event reducer for the send / edit / regenerate flows. */
  const handleStreamEvent = (event: ChatStreamEventWire, messageId: string) => {
    if (event.event === 'start') {
      activeRunRef.current = { runId: event.runId, messageId };
      setActiveRun({ runId: event.runId, messageId });
      return;
    }

    if (event.event === 'delta') {
      currentThinkingIdRef.current = null;
      setMessages((prev) => prev.map((msg) => (
        msg.id === messageId
          ? { ...msg, content: msg.content + event.delta }
          : msg
      )));
      return;
    }

    if (event.event === 'thinking_delta') {
      setMessages((prev) => prev.map((msg) => {
        if (msg.id !== messageId) return msg;
        let newContent = msg.content;
        const newThinkingBlocks = [...(msg.thinkingBlocks ?? [])];

        if (!currentThinkingIdRef.current) {
          currentThinkingIdRef.current = `thinking-${Date.now()}`;
          newContent += `\n\n[[THINKING:${currentThinkingIdRef.current}]]\n\n`;
          newThinkingBlocks.push({ id: currentThinkingIdRef.current, content: event.delta });
        } else {
          const blockIndex = newThinkingBlocks.findIndex(b => b.id === currentThinkingIdRef.current);
          if (blockIndex >= 0) {
            newThinkingBlocks[blockIndex] = {
              ...newThinkingBlocks[blockIndex],
              content: newThinkingBlocks[blockIndex].content + event.delta
            };
          }
        }

        return {
          ...msg,
          content: newContent,
          thinkingBlocks: newThinkingBlocks,
          thinking: `${msg.thinking ?? ''}${event.delta}`
        };
      }));
      return;
    }

    if (event.event === 'done') {
      currentThinkingIdRef.current = null;
      setMessages((prev) => prev.map((msg) => {
        if (msg.id !== messageId) return msg;
        const next = { ...msg };
        // The stream already appended every delta; `done.text` is the final
        // assembled content. Correct it only when no thinking markers were
        // injected into content (replacing would drop the [[THINKING:...]]
        // markers that FoldBlock rendering depends on).
        const blocks = next.thinkingBlocks ?? [];
        if (event.text && blocks.length === 0) {
          next.content = event.text;
        }
        if (event.reasoning) {
          next.thinking = event.reasoning;
          if (blocks.length > 0) {
            next.thinkingBlocks = blocks.map((block, index) => (
              index === blocks.length - 1 ? { ...block, content: event.reasoning } : block
            ));
          }
        }
        return next;
      }));
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
      return;
    }

    if (event.event === 'error') {
      currentThinkingIdRef.current = null;
      setMessages((prev) => prev.map((msg) => (
        msg.id === messageId
          ? { ...msg, content: event.message ? `Model request failed: ${event.message}` : 'Model request failed' }
          : msg
      )));
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
      message.error(event.message ? `Model request failed: ${event.message}` : 'Model request failed');
      return;
    }

    if (event.event === 'aborted') {
      currentThinkingIdRef.current = null;
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
      return;
    }
  };

  /** Run one streaming generation against `messageId`; abortable via the ref. */
  const startStream = async (messageId: string, modelMessages: WireMessage[]) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const request = buildModelRequest({
      system: effectiveSystemPrompt,
      messages: modelMessages,
      temperature: settings.agentConfigs?.partnerChat?.temperature ?? 0.3,
      maxTokens: settings.agentConfigs?.partnerChat?.maxOutputTokens ?? 32000,
      thinkingDepth: settings.agentConfigs?.partnerChat?.thinkingDepth ?? 'off',
    });

    try {
      await streamChat(request, (event) => {
        handleStreamEvent(event, messageId);
      }, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setMessages((prev) => prev.map((msg) => (
          msg.id === messageId
            ? { ...msg, content: `Model request failed: ${String(err)}` }
            : msg
        )));
      }
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    if (!initialSystemPromptSnapshotRef.current) {
      const initialIds = [...selectedStylePresetIdsRef.current];
      setInitialStylePresetSnapshot(initialIds, effectiveSystemPrompt);
      initialStylePresetIdsRef.current = initialIds;
      initialSystemPromptSnapshotRef.current = effectiveSystemPrompt;
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
      tools: []
    };
    const agentMessageId = `msg-${Date.now() + 1}`;
    const pendingAgentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      tools: []
    };

    const nextMessages = [...messages, userMessage, pendingAgentMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);
    scrollToBottomOnce();

    // Map Zustand Messages to LLM API message schema (thinking/tools dropped)
    const modelMessages: WireMessage[] = nextMessages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content
    }));

    await startStream(agentMessageId, modelMessages);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  };

  const handleStartEdit = (msg: Message) => {
    setEditingMessageId(msg.id);
    setEditingContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleSaveEdit = async (msg: Message) => {
    if (!editingContent.trim()) return;

    if (msg.role === 'agent') {
      const nextMessages = messages.map(m => m.id === msg.id ? { ...m, content: editingContent } : m);
      setMessages(nextMessages);
      messagesRef.current = nextMessages;
      setEditingMessageId(null);
      setEditingContent('');
    } else {
      const userIdx = messages.findIndex(m => m.id === msg.id);
      if (userIdx === -1) return;

      const baseMessages = messages.slice(0, userIdx + 1);
      baseMessages[userIdx] = {
        ...baseMessages[userIdx],
        content: editingContent
      };

      const agentMessageId = `msg-${Date.now()}`;
      const pendingAgentMessage: Message = {
        id: agentMessageId,
        role: 'agent',
        content: '',
        tools: []
      };

      const nextMessages = [...baseMessages, pendingAgentMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setEditingMessageId(null);
      setEditingContent('');
      setIsStreaming(true);
      scrollToBottomOnce();

      const modelMessages: WireMessage[] = baseMessages.map(m => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content
      }));

      await startStream(agentMessageId, modelMessages);
    }
  };

  const handleRegenerateAssistantMessage = async () => {
    if (isStreaming) return;

    const lastAgentIndex = [...messages].reverse().findIndex(m => m.role === 'agent');
    const realLastAgentIndex = lastAgentIndex !== -1 ? messages.length - 1 - lastAgentIndex : -1;
    if (realLastAgentIndex === -1) return;

    const baseMessages = messages.slice(0, realLastAgentIndex);
    const agentMessageId = messages[realLastAgentIndex].id;
    const pendingAgentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      tools: []
    };

    const nextMessages = [...baseMessages, pendingAgentMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setIsStreaming(true);
    scrollToBottomOnce();

    const modelMessages: WireMessage[] = baseMessages.map(msg => ({
      role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content
    }));

    await startStream(agentMessageId, modelMessages);
  };

  const toggleBlock = (id: string) => {
    setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSaveConversation = async () => {
    if (messages.length === 0 || isStreaming || isSessionArchived) {
      message.warning('Nothing to save yet.');
      return;
    }
    setIsSavingConversation(true);
    try {
      const chatHistoryLines: string[] = [];
      for (const m of messages) {
        if (m.role === 'user' || m.role === 'agent') {
          chatHistoryLines.push(`${m.role === 'user' ? 'Me' : 'Narrator & NPCs'}: ${m.content.replace(/\[\[THINKING:[^\]]+\]\]/g, '').trim()}`);
        }
      }
      const chatHistoryText = chatHistoryLines.join('\n\n');
      const firstUserMessage = messages.find(
        (m) => m.role === 'user' && m.content.trim() !== '',
      )?.content.trim() ?? chatHistoryText;
      const finalTitle = await resolveSessionTitle({
        currentTitle: sessionTitleRef.current,
        defaultTitle: 'New Chat',
        messages,
        finalFallback: 'Untitled Session',
        summarize: async () => {
          const response = await complete(buildModelRequest({
            system: 'Summarize the user\u2019s intent from the input message in no more than 15 words.',
            messages: [{ role: 'user', content: firstUserMessage }],
            temperature: 0.3,
            maxTokens: 128,
          }));
          const collapsed = response.text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
          return Array.from(collapsed).slice(0, 30).join('');
        },
      });
      sessionTitleRef.current = finalTitle;
      setSessionTitle(finalTitle);
      const latestSessions = await refreshSessions();
      setSaveChoiceTitle(finalTitle);
      setSaveChoiceOverwriteAvailable(latestSessions.length > 0);
      setIsSaveChoiceOpen(true);
    } catch (err) {
      console.error('Failed to save conversation:', err);
      message.error(`Failed to save conversation: ${String(err)}`);
    } finally {
      setIsSavingConversation(false);
    }
  };

  const handleConfirmSaveChoice = async ({ mode, name, targetId }: SaveChoiceConfirmPayload) => {
    const finalTitle = name || saveChoiceTitle || sessionTitleRef.current || 'Untitled Session';
    const targetSessionId = mode === 'create'
      ? createSessionId('partner-session')
      : targetId || ensureCurrentSessionId();

    setIsSavingConversation(true);
    try {
      const savedSessionId = await saveCurrentSession(finalTitle, targetSessionId);
      if (!savedSessionId) {
        message.error('Failed to save conversation, please try again later');
        return;
      }
      sessionIdRef.current = savedSessionId;
      sessionTitleRef.current = finalTitle;
      setSessionId(savedSessionId);
      setSessionTitle(finalTitle);
      setIsSaveChoiceOpen(false);
      message.success('Conversation saved');
    } catch (err) {
      console.error('Failed to save conversation:', err);
      message.error(`Failed to save conversation: ${String(err)}`);
    } finally {
      setIsSavingConversation(false);
    }
  };

  const openSession = async (id: string) => {
    try {
      const session = await loadSession('partner', id);
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setSessionId(session.id);
      setSessionTitle(session.title);
      setMessages(session.messages);
      setSelectedWorldBookId(session.selectedWorldBookId ?? null);
      setSelectedCharacterCardId(session.characterCardId ?? null);
      setSelectedStylePresetIds(session.selectedStylePresetIds ?? []);
      setInitialStylePresetSnapshot(session.initialStylePresetIds ?? [], session.initialSystemPromptSnapshot ?? '');
      const nextContextCompaction = (session.contextCompaction ?? null) as SessionContextCompaction | null;
      contextCompactionRef.current = nextContextCompaction;
      setContextCompaction(nextContextCompaction);
      setIsStreaming(false);
      setInput('');
      setIsSessionArchived(session.isArchived ?? false);
      scrollToBottomOnce();
    } catch (err) {
      console.error('Failed to open chat history:', err);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession('partner', id);
      message.success('Chat history deleted');
      if (id === sessionIdRef.current) {
        createNewSession();
      }
      await refreshSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
      message.error('Failed to delete session');
    }
  };

  const handleRenameSession = async (id: string, title: string) => {
    const record = await loadSession('partner', id);
    await saveSession('partner', { ...record, title });
    if (id === sessionIdRef.current) {
      sessionTitleRef.current = title;
      setSessionTitle(title);
    }
    await refreshSessions();
  };

  const handleArchiveMemory = async () => {
    if (!selectedCharacterCard || messages.length === 0 || isStreaming || isSessionArchived) return;

    setIsAnalyzing(true);
    setIsArchiveModalOpen(true);
    setArchiveAnalysis(null);

    const chatHistoryLines: string[] = [];
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'agent') {
        continue;
      }
      const sender = m.role === 'user' ? 'Me' : (selectedCharacterCard.name);
      const cleanContent = m.content.replace(/\[\[THINKING:[^\]]+\]\]/g, '').trim();
      if (cleanContent !== '') {
        chatHistoryLines.push(`${sender}: ${cleanContent}`);
      }
    }
    const chatHistoryText = chatHistoryLines.join('\n\n');

    try {
      const archiveConfig = settings.agentConfigs?.chatArchive || {};
      const result = await complete(buildModelRequest({
        system: settings.chatArchivePrompt,
        messages: [{ role: 'user', content: chatHistoryText }],
        temperature: archiveConfig.temperature ?? 0.3,
        maxTokens: archiveConfig.maxOutputTokens ?? 32000,
      }));

      const analysis = parseArchiveAnalysisResponse(result.text);
      setArchiveAnalysis(analysis);
      setEditedTitle(analysis.sessionTitle || sessionTitle || 'Untitled Session');
      setEditedRelationType(analysis.userRelationType || '');
      setEditedRelationModel(analysis.userInteractionModel || '');
      setEditedRelationBottomLine(analysis.userRelationBottomLine || '');
      setEditedEvents(analysis.keyEvents || '');
    } catch (err) {
      console.error('Memory analysis failed:', err);
      message.error(`Memory analysis failed: ${String(err)}`);
      setIsArchiveModalOpen(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!selectedCharacterCard) return;

    try {
      // 1. Update character card fields in usePartnerStore
      updateItemFields(selectedCharacterCard.id, 'character_card', {
        userRelationType: editedRelationType,
        userInteractionModel: editedRelationModel,
        userRelationBottomLine: editedRelationBottomLine,
        keyEvents: editedEvents
      });

      // 2. Set current session archive status to true
      setIsSessionArchived(true);

      // 3. Set the new session title
      const finalTitle = editedTitle.trim() || 'Untitled Session';
      setSessionTitle(finalTitle);
      sessionTitleRef.current = finalTitle;
      isSessionArchivedRef.current = true;

      // 4. Save the archived session
      const saved = await saveCurrentSession();
      if (!saved) {
        throw new Error('Failed to save archived session');
      }

      message.success('Partner memory archived! This session is now locked.');
      setIsArchiveModalOpen(false);
    } catch (err) {
      console.error('Failed to archive memory:', err);
      message.error(`Failed to archive memory: ${String(err)}`);
    }
  };

  // Context ring stats
  const effectiveContextMessages = getEffectiveMessagesForContextStats(messages, contextCompaction);
  const contextStats = estimateContextUsage(effectiveSystemPrompt, effectiveContextMessages, input);
  const maxContext = settings.agentConfigs?.partnerChat?.maxContextTokens ?? 200000;
  const contextPercent = maxContext > 0
    ? Math.min(100, Math.round((contextStats.total / maxContext) * 100))
    : 0;

  const modelLabel = activeModel ? `${activeModel.provider} / ${activeModel.model}` : 'No model configured';

  const contextTooltip = (
    <div className="agent-context-popover">
      <div className="agent-context-popover__header">
        <strong>Context Details</strong>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">Model:</span>
        <span className="agent-context-popover__value">{modelLabel}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">World Book:</span>
        <span className="agent-context-popover__value">{selectedWorldBook?.name || 'Unbound'}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">Character Card:</span>
        <span className="agent-context-popover__value">{selectedCharacterCard?.name || 'Unbound'}</span>
      </div>
      <div className="agent-context-popover__divider" />
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">Messages:</span>
        <span className="agent-context-popover__value">{contextStats.messageCount}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">Total Tokens:</span>
        <span className="agent-context-popover__value agent-context-popover__value--highlight">{contextStats.total} / {maxContext}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">User Messages:</span>
        <span className="agent-context-popover__value">{contextStats.user}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">AI Replies:</span>
        <span className="agent-context-popover__value">{contextStats.assistant}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">System:</span>
        <span className="agent-context-popover__value">{contextStats.system}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">Tool Usage:</span>
        <span className="agent-context-popover__value">0</span>
      </div>
    </div>
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="agent-chat" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#faf9f5' }}>

      {/* Settings Modal */}
      <PartnerChatSettingsModal
        open={isSettingsOpen}
        onCancel={() => setIsSettingsOpen(false)}
      />

      <SaveChoiceModal
        open={isSaveChoiceOpen}
        title="Save Conversation"
        nameLabel="Session Name"
        initialName={saveChoiceTitle || sessionTitle}
        loading={isSavingConversation}
        overwriteAvailable={saveChoiceOverwriteAvailable}
        overwriteTargetLabel="Overwrite Entry"
        overwriteTargets={sessions.map((session) => {
          const targetInfo = buildSessionHistoryDetails(session, worldBooks, characterCards);
          return {
            value: session.id,
            label: session.title || 'Untitled Session',
            description: targetInfo.description,
            details: targetInfo.details,
          };
        })}
        initialOverwriteTargetId={
          sessions.some((session) => session.id === sessionId) ? sessionId : sessions[0]?.id || null
        }
        onCancel={() => setIsSaveChoiceOpen(false)}
        onConfirm={handleConfirmSaveChoice}
      />

      {/* Archive Memory Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '18px', fontWeight: 600 }}>
            <FileProtectOutlined style={{ color: '#d97757' }} />
            <span>Archive Memory & Sync Settings</span>
          </div>
        }
        open={isArchiveModalOpen}
        onCancel={() => !isAnalyzing && setIsArchiveModalOpen(false)}
        onOk={handleConfirmArchive}
        okText="Confirm Sync & Archive"
        cancelText="Cancel"
        confirmLoading={isAnalyzing}
        width={720}
        okButtonProps={{ disabled: isAnalyzing }}
        styles={{
          body: { padding: '16px 24px' }
        }}
      >
        {isAnalyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '16px' }}>
            <Spin size="large" />
            <div style={{ color: '#8c8882', fontSize: '14px' }}>
              Recalling conversation history and distilling long-term partner memories...
            </div>
          </div>
        ) : archiveAnalysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ padding: '12px 16px', background: '#faf6f0', borderRadius: '8px', border: '1px solid #f2e8dc', color: '#8c8882', fontSize: '13px' }}>
              <strong>Note:</strong> the model has analyzed this conversation and generated proposed changes to the partner persona. Please review carefully before syncing — you can also fine-tune the fields below.
            </div>

            {/* Changes Analysis */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Relationship Changes</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalysis.relationChanges}</div>
              </div>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Shared Event Analysis</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalysis.eventChanges}</div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(0,0,0,0.03)' }} />

            {/* Editable fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Session Title</div>
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="Enter a suggested title"
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated Relationship Type</div>
                <Input
                  value={editedRelationType}
                  onChange={(e) => setEditedRelationType(e.target.value)}
                  placeholder="Relationship type..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated Interaction Pattern</div>
                <Input.TextArea
                  value={editedRelationModel}
                  onChange={(e) => setEditedRelationModel(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="Interaction pattern..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated Relationship Bottom Line</div>
                <Input.TextArea
                  value={editedRelationBottomLine}
                  onChange={(e) => setEditedRelationBottomLine(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="Relationship bottom line..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated Key Events</div>
                <Input.TextArea
                  value={editedEvents}
                  onChange={(e) => setEditedEvents(e.target.value)}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  placeholder="Updated key events..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Header */}
      <div className="agent-chat__header" style={{ borderBottom: '1px solid #eae6df', padding: '16px 24px' }}>
        <div className="agent-chat__title">
          <MessageOutlined style={{ color: '#d97757', fontSize: 18 }} />
          <h3 style={{ margin: 0, fontWeight: 600, color: '#33312e' }}>
            Partner Chat
            {selectedCharacterCard && (
              <span style={{ fontSize: 13, color: '#8c8882', fontWeight: 400, marginLeft: 8 }}>
                (Bound: {selectedCharacterCard.name})
              </span>
            )}
          </h3>
        </div>

        <div className="agent-chat__header-actions">
          {selectedCharacterCard && (
            <>
              <Tooltip title="Save current conversation">
                <Button
                  type="text"
                  loading={isSavingConversation}
                  disabled={isStreaming || isSessionArchived || messages.length === 0 || isSavingConversation}
                  icon={<SaveOutlined />}
                  onClick={() => void handleSaveConversation()}
                  style={{
                    color: (isSessionArchived || messages.length === 0) ? '#8c8882' : '#d97757',
                    fontWeight: 500,
                    fontSize: 13,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  Save
                </Button>
              </Tooltip>
              <Tooltip title={isSessionArchived ? "This session's memories are archived to the character card" : "Archive this session's memories to the character card"}>
                <Button
                  type="text"
                  disabled={isStreaming || isSessionArchived || messages.length === 0}
                  icon={<FileProtectOutlined />}
                  onClick={handleArchiveMemory}
                  style={{
                    color: (isSessionArchived || messages.length === 0) ? '#8c8882' : '#d97757',
                    fontWeight: 500,
                    fontSize: 13,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  Archive
                </Button>
              </Tooltip>
            </>
          )}

          <Tooltip title="Clear current context">
            <Button type="text" icon={<ReloadOutlined />} onClick={createNewSession} />
          </Tooltip>

          <Tooltip title="Chat history">
            <Button
              aria-label="Chat history"
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => {
                void refreshSessions();
                setIsHistoryOpen(true);
              }}
            />
          </Tooltip>
        </div>
      </div>

      <SessionHistoryModal
        open={isHistoryOpen}
        title="Chat History"
        emptyText="No chat history yet"
        sessions={sessions}
        worldBooks={worldBooks}
        characterCards={characterCards}
        onClose={() => setIsHistoryOpen(false)}
        onOpenSession={openSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />

      {/* Main chat layout */}
      {hasMessages ? (
        <div ref={chatHistoryRef} className="agent-chat__history" style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <div className="agent-message-row agent-message-row--system">
            <div className="agent-message-bubble agent-message-bubble--system">
              <FoldBlock
                icon={<InfoCircleOutlined />}
                variant="thinking"
                title="System Prompt (with settings merged)"
                preview={(hasMessages && initialSystemPromptSnapshot ? initialSystemPromptSnapshot : effectiveSystemPrompt).slice(0, 80) + ((hasMessages && initialSystemPromptSnapshot ? initialSystemPromptSnapshot : effectiveSystemPrompt).length > 80 ? '...' : '')}
                detail={hasMessages && initialSystemPromptSnapshot ? initialSystemPromptSnapshot : effectiveSystemPrompt}
                expanded={Boolean(expandedBlocks['system-prompt'])}
                onToggle={() => toggleBlock('system-prompt')}
              />
            </div>
          </div>

          {messages.map((msg, index) => {
            const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
            const realLastUserIndex = lastUserIndex !== -1 ? messages.length - 1 - lastUserIndex : -1;

            const lastAgentIndex = [...messages].reverse().findIndex(m => m.role === 'agent');
            const realLastAgentIndex = lastAgentIndex !== -1 ? messages.length - 1 - lastAgentIndex : -1;

            const isLastUser = index === realLastUserIndex;
            const isLastAgent = index === realLastAgentIndex;

            return (
              <div className={`agent-message-row agent-message-row--${msg.role}`} key={msg.id}>
                <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '88%', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div className={`agent-message-bubble agent-message-bubble--${msg.role}`} style={{ width: '100%', maxWidth: '100%' }}>
                    {editingMessageId === msg.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '240px' }}>
                        <Input.TextArea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 6 }}
                          style={{
                            borderRadius: '6px',
                            borderColor: msg.role === 'user' ? 'rgba(255,255,255,0.2)' : '#eae6df',
                            background: msg.role === 'user' ? 'rgba(0,0,0,0.1)' : '#ffffff',
                            color: msg.role === 'user' ? '#ffffff' : '#33312e'
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <Button
                            size="small"
                            onClick={handleCancelEdit}
                            style={{
                              borderRadius: '4px',
                              borderColor: msg.role === 'user' ? 'rgba(255,255,255,0.3)' : undefined,
                              background: msg.role === 'user' ? 'transparent' : undefined,
                              color: msg.role === 'user' ? '#ffffff' : undefined
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="primary"
                            size="small"
                            onClick={() => handleSaveEdit(msg)}
                            style={{
                              borderRadius: '4px',
                              backgroundColor: msg.role === 'user' ? '#ffffff' : '#d97757',
                              borderColor: msg.role === 'user' ? '#ffffff' : '#d97757',
                              color: msg.role === 'user' ? '#d97757' : '#ffffff',
                              fontWeight: 500
                            }}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {msg.thinking && (!msg.thinkingBlocks || msg.thinkingBlocks.length === 0) && (
                          <FoldBlock
                            icon={<BulbOutlined />}
                            variant="thinking"
                            title="Thinking"
                            preview={msg.thinking}
                            expanded={Boolean(expandedBlocks[`${msg.id}-thinking`])}
                            onToggle={() => toggleBlock(`${msg.id}-thinking`)}
                          />
                        )}

                        {(() => {
                          const parts = msg.content ? msg.content.split(/(\[\[(?:THINKING):[^\]]+\]\])/) : [''];
                          const getMarkdownPartKey = createStableContentKey(`${msg.id}-md`);

                          return parts.map((part) => {
                            const thinkingMatch = part.match(/^\[\[THINKING:([^\]]+)\]\]$/);
                            if (thinkingMatch) {
                              const thinkingId = thinkingMatch[1];
                              const block = msg.thinkingBlocks?.find(b => b.id === thinkingId);
                              if (block) {
                                return (
                                  <FoldBlock
                                    icon={<BulbOutlined />}
                                    variant="thinking"
                                    key={`thinking-${thinkingId}`}
                                    title="Thinking"
                                    preview={block.content}
                                    expanded={Boolean(expandedBlocks[`${msg.id}-thinking-${thinkingId}`])}
                                    onToggle={() => toggleBlock(`${msg.id}-thinking-${thinkingId}`)}
                                  />
                                );
                              }
                              return null;
                            }

                            return part.trim() ? (
                              <div className="agent-markdown" key={getMarkdownPartKey(part)}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {part}
                                </ReactMarkdown>
                              </div>
                            ) : null;
                          });
                        })()}
                      </>
                    )}
                  </div>

                  {!isSessionArchived && editingMessageId !== msg.id && (
                    <>
                      {isLastUser && msg.role === 'user' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', paddingRight: '4px' }}>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            disabled={isStreaming}
                            onClick={() => handleStartEdit(msg)}
                            style={{ color: '#d97757', fontSize: '12px', padding: '0 4px', height: 'auto', display: 'flex', alignItems: 'center' }}
                          >
                            Edit
                          </Button>
                        </div>
                      )}
                      {isLastAgent && msg.role === 'agent' && (
                        <div style={{ display: 'flex', gap: '12px', marginTop: '4px', paddingLeft: '4px' }}>
                          <Button
                            type="text"
                            size="small"
                            icon={<RedoOutlined />}
                            disabled={isStreaming}
                            onClick={handleRegenerateAssistantMessage}
                            style={{ color: '#d97757', fontSize: '12px', padding: '0 4px', height: 'auto', display: 'flex', alignItems: 'center' }}
                          >
                            Regenerate
                          </Button>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            disabled={isStreaming}
                            onClick={() => handleStartEdit(msg)}
                            style={{ color: '#d97757', fontSize: '12px', padding: '0 4px', height: 'auto', display: 'flex', alignItems: 'center' }}
                          >
                            Edit
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty/Home State - Center Input Box */
        <div style={CHAT_EMPTY_STATE_STYLE}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <MessageOutlined style={{ fontSize: '56px', color: '#d97757', marginBottom: '16px', opacity: 0.9 }} />
            <h2 style={{ fontSize: '26px', fontWeight: 600, color: '#33312e', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
              Partner Chat
            </h2>
            <p style={{ color: '#8c8882', fontSize: '15px', margin: 0 }}>
              Start an immersive conversation with your ideal character, grounded in world book and character card settings
            </p>
          </div>

          {/* Quick Bind Cards */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '32px', width: '100%', maxWidth: '640px', justifyContent: 'center' }}>
            <Tag icon={<BookOutlined />} color={selectedWorldBook ? "orange" : "default"} style={{ padding: '4px 12px', fontSize: '13px', borderRadius: '4px', border: '1px solid #eae6df' }}>
              World Book: {selectedWorldBook ? selectedWorldBook.name : 'Unbound'}
            </Tag>
            <Tag icon={<UserOutlined />} color={selectedCharacterCard ? "orange" : "default"} style={{ padding: '4px 12px', fontSize: '13px', borderRadius: '4px', border: '1px solid #eae6df' }}>
              Character Card: {selectedCharacterCard ? selectedCharacterCard.name : 'Unbound'}
            </Tag>
          </div>
          <div style={{ width: '100%', maxWidth: 640, marginBottom: 20 }}>
            <StylePresetSelector target="chat" value={selectedStylePresetIds[0] || null} onChange={(id) => setSelectedStylePresetIds(id ? [id] : [])} />
          </div>
        </div>
      )}

      {/* Composer Input Area */}
      <div className="agent-composer" style={{
        padding: hasMessages ? '16px 24px 24px 24px' : '0 24px 100px 24px',
        width: '100%',
        maxWidth: hasMessages ? '100%' : '688px',
        margin: '0 auto',
        boxSizing: 'border-box'
      }}>
        <div id="agent-composer-box" className="agent-composer__box" style={{
          boxShadow: hasMessages ? '0 2px 12px rgba(0, 0, 0, 0.04)' : '0 10px 30px rgba(217, 119, 87, 0.06)',
          border: '1px solid #eae6df',
          borderRadius: '12px',
          background: '#ffffff',
          position: 'relative'
        }}>
          <Input.TextArea
            className="agent-composer__textarea"
            autoSize={{ minRows: hasMessages ? 1 : 2, maxRows: 8 }}
            disabled={isSessionArchived}
            onChange={(e) => setInput(e.target.value)}
            style={{ zIndex: 2, position: 'relative', background: 'transparent', boxShadow: 'none', border: 'none', padding: '16px 16px 40px 16px', fontSize: '15px' }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              isSessionArchived
                ? "This session's memories are archived; you can't send more messages"
                : selectedCharacterCard
                  ? `Chat with ${selectedCharacterCard.name}, press Cmd/Ctrl + Enter to send...`
                  : "Click Settings at the bottom left to pick a character card, then start chatting..."
            }
            value={input}
          />

          <div
            className="agent-composer__actions"
            style={{
              ...CHAT_COMPOSER_ACTIONS_STYLE,
              justifyContent: hasMessages ? 'flex-end' : 'space-between',
            }}
          >
            {!hasMessages && (
              <Button
                aria-label="Partner settings"
                icon={<SettingOutlined />}
                onClick={() => setIsSettingsOpen(true)}
                shape="circle"
                type={selectedCharacterCard ? 'primary' : 'default'}
                style={{
                  backgroundColor: selectedCharacterCard ? '#d97757' : undefined,
                  borderColor: selectedCharacterCard ? '#d97757' : '#eae6df',
                  color: selectedCharacterCard ? '#ffffff' : '#5c5751'
                }}
                title="Partner settings"
              />
            )}

            <div className="agent-send-cluster" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Tooltip color="#fff" placement="topRight" title={contextTooltip} overlayInnerStyle={{ width: 'max-content', maxWidth: 320, padding: '8px 12px', border: '1px solid #eae6df' }}>
                <button
                  aria-label="View context details"
                  className="agent-context-ring"
                  style={{ '--context-fill': `${contextPercent}%` } as React.CSSProperties}
                  type="button"
                >
                  <span>{contextPercent}%</span>
                </button>
              </Tooltip>

              <Tooltip title={isStreaming ? 'Stop' : isSessionArchived ? 'Session archived' : 'Send'}>
                <Button
                  className="de-ai-agent-run-button"
                  disabled={isSessionArchived || (!isStreaming && !input.trim())}
                  icon={isStreaming ? <StopOutlined /> : <PlayCircleOutlined />}
                  onClick={isStreaming ? handleStop : handleSend}
                  shape="circle"
                  type={isStreaming ? "default" : "primary"}
                  danger={isStreaming}
                  style={isStreaming ? undefined : {
                    backgroundColor: '#d97757',
                    borderColor: '#d97757',
                    color: '#ffffff'
                  }}
                />
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function FoldBlock({
  icon,
  title,
  preview,
  detail,
  expanded,
  onToggle,
  variant = 'tool',
}: {
  icon: React.ReactNode;
  title: string;
  preview: string;
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
  variant?: 'tool' | 'thinking';
}) {
  return (
    <div className={`agent-fold-block agent-fold-block--${variant}`}>
      <button className="agent-fold-block__summary" onClick={onToggle} type="button">
        <span className="agent-fold-block__title">{icon}{title}</span>
        <span className="agent-fold-block__preview">{preview || 'No content yet'}</span>
      </button>
      {expanded && <pre className="agent-fold-block__detail">{detail ?? preview}</pre>}
    </div>
  );
}

export const ChatPage: React.FC = () => useChatView();
