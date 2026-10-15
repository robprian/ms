import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Tooltip, Tag, Input, message, Modal, Spin, Select, Radio, Checkbox, Switch, Tree } from 'antd';
import {
  BookOutlined,
  BulbOutlined,
  HistoryOutlined,
  ReloadOutlined,
  CompassOutlined,
  StopOutlined,
  PlayCircleOutlined,
  InfoCircleOutlined,
  UserOutlined,
  FileProtectOutlined,
  SaveOutlined,
  CommentOutlined,
  ExperimentOutlined,
  BranchesOutlined,
  RedoOutlined,
  EditOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useSettingsStore } from '../stores/useSettingsStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useStoryStore } from '../stores/useStoryStore';

import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { SessionHistoryModal } from '../components/SessionHistoryModal';
import SaveChoiceModal, { type SaveChoiceConfirmPayload } from '../components/SaveChoiceModal';
import { Message, SessionContextCompaction, AgentToolEntry } from '../stores/useAgentStore';
import {
  buildStoryModelMessages,
  compileStorySystemPrompt,
  getRolePlayCharacterName,
} from '../utils/storyAgent';
import type { StoryModelMessage } from '../utils/storyAgent';
import { parseArchiveAnalysisResponse } from '../utils/archiveAnalysis';
import { getCharacterCardIdsForWorldBook, groupCharacterCardsByWorldBook } from '../utils/characterCardGroups';
import { createStableContentKey, createStableToolKey } from '../utils/renderKeys';
import { useStateGroup } from '../utils/reducerState';
import { createSessionId, ensureSessionId } from '../utils/sessionIds';
import { getEffectiveMessagesForContextStats } from '../utils/contextCompaction';
import { resolveSessionTitle } from '../utils/sessionTitle';
import { buildSessionHistoryDetails } from '../utils/sessionHistory';
import { StylePresetSelector } from '../components/StylePresetSelector';
import { useStylePresetStore } from '../stores/useStylePresetStore';
import { prependStylePresets } from '../utils/stylePresets';
import { filterItemsById } from '../utils/collectionSelection';

import { streamChat, complete, listSessions, loadSession, saveSession, deleteSession } from '../api';
import type { ChatRequestWire, ChatStreamEventWire, WireMessage } from '../api';

/** Parsed archive-analysis result (MuseAI analyze_character_memory JSON). */
interface ArchiveAnalysisResult {
  userRelationType?: string;
  userInteractionModel?: string;
  userRelationBottomLine?: string;
  keyEvents?: string;
  sessionTitle?: string;
  relationChanges?: string;
  eventChanges?: string;
}

interface AdventureUiState {
  isArchiveModalOpen: boolean;
  isSaveChoiceOpen: boolean;
  isAnalyzing: boolean;
  isSavingConversation: boolean;
  saveChoiceTitle: string;
  saveChoiceOverwriteAvailable: boolean;
  archiveAnalyses: Record<string, ArchiveAnalysisResult>;
  selectedTargetCardId: string;
  editedTitle: string;
  editedRelationTypes: Record<string, string>;
  editedRelationModels: Record<string, string>;
  editedRelationBottomLines: Record<string, string>;
  editedEventsMap: Record<string, string>;
  editingMessageId: string | null;
  editingContent: string;
  tempSelectedCardIds: string[];
  hasStartedAnalysis: boolean;
  expandedCharacterGroupKeys: React.Key[];
  isHistoryOpen: boolean;
}

const BACKGROUND_LINK_BUTTON_STYLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 400,
  color: '#d97757',
  cursor: 'pointer',
  border: 0,
  background: 'transparent',
  padding: 0,
  fontFamily: 'inherit',
  lineHeight: 'inherit',
};
const CHARACTER_GROUP_TITLE_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  color: '#8c8882',
  fontSize: 13,
  cursor: 'pointer',
  border: 0,
  background: 'transparent',
  padding: 0,
  fontFamily: 'inherit',
};

const estimateContextUsage = (systemPrompt: string, messages: Message[], draft: string) => {
  let userContent = draft;
  let assistantContent = '';
  for (const message of messages) {
    if (message.role === 'user') {
      userContent += message.content;
    } else if (message.role === 'agent') {
      assistantContent += message.content;
    }
  }

  const stats = {
    system: Math.max(0, Math.ceil(systemPrompt.length * 1.5)),
    user: Math.max(0, Math.ceil(userContent.length * 1.5)),
    assistant: Math.max(0, Math.ceil(assistantContent.length * 1.5))
  };
  return {
    ...stats,
    total: stats.system + stats.user + stats.assistant,
  };
};

/**
 * Map StoryModelMessage[] (buildStoryModelMessages output) to the DSH wire
 * shape [{role:'user'|'assistant', content}]. Tool-result messages and
 * thinking blocks are dropped — DSH has no tool/thinking channels.
 */
const buildWireMessages = (modelMessages: StoryModelMessage[]): WireMessage[] =>
  modelMessages
    .filter((message) => message.role !== 'tool')
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.content,
    }));

interface AnalyzeMemoryUserPromptInput {
  targetName: string;
  targetContent: string;
  chatHistory: string;
  currentUserRelationType: string;
  currentUserInteractionModel: string;
  currentUserRelationBottomLine: string;
  currentEvents: string;
}

/**
 * Faithful replica of MuseAI's backend `build_analyze_memory_user_prompt`
 * (src-tauri/src/agent/sessions.rs), inlined into the user message because
 * the DSH `complete` bridge only carries system + messages.
 */
function buildAnalyzeMemoryUserMessage(input: AnalyzeMemoryUserPromptInput): string {
  const targetName = input.targetName || 'current character';
  const targetContent = input.targetContent || 'not provided';
  return `Based on the conversation records below, analyze and generate new relationship settings with the user, key events, and a suggested session title.

### 0. Target character allowed to be updated this time
- **Target character**: ${targetName}
- **Target character card content**:
${targetContent}

Important constraints: only analyze and output the relationship, interaction patterns, relationship boundaries, and key events between the "target character" and the user. Other characters, narrators, NPCs, or group events appearing in the conversation may only serve as background context — you are strictly forbidden from writing other characters' relationships, emotions, promises, intimacy, or key events with the user into the target character's memory.

Length constraints: "userRelationType" must not exceed 50 characters; "userInteractionModel" and "userRelationBottomLine" must each not exceed 100 characters. "keyEvents" must keep the original key-event content and may add at most 100 characters on top of it; the added part must be preceded by a blank line, and the new content must be formatted as "[EventName] event details".

### 1. Chat history of this session
${input.chatHistory}

### 2. Target character's current relationship settings with the user
- **Relationship type with user**: ${input.currentUserRelationType}
- **Interaction pattern with user**: ${input.currentUserInteractionModel}
- **Relationship boundary with user**: ${input.currentUserRelationBottomLine}

### 3. Target character's current key-event records
${input.currentEvents}

Based on the conversation above, analyze:
1. Relationship-setting changes: after this conversation, how should the target character's "relationship type with user", "interaction pattern with user", and "relationship boundary with user" change, deepen, or be established? If the interaction pattern or relationship boundary was updated, adjust and refine them accordingly.
2. Key-event changes: did this conversation contain a milestone or memorable shared experience affecting the target character's relationship with the user? If so, only append events the target character personally experienced or clearly participated in, with at most 100 added characters, and only after leaving a blank line following the original key events, then write "[EventName] event details"; if not, keep them unchanged.
3. Session title: give this session a fitting title that reflects the conversation's theme, no more than 15 characters.

Output in pure JSON format. Do not include markdown format markers (e.g. \`\`\`json) or extra explanatory text. The JSON structure must strictly satisfy the following fields:
{
  "userRelationType": "updated complete relationship-type-with-user content, no more than 50 characters",
  "userInteractionModel": "updated complete interaction-pattern-with-user content, no more than 100 characters",
  "userRelationBottomLine": "updated complete relationship-boundary-with-user content, no more than 100 characters",
  "keyEvents": "keep the original key-event content; if adding, leave a blank line first, then append no more than 100 characters of [EventName] event details",
  "sessionTitle": "suggested title for this session (no more than 15 characters)",
  "relationChanges": "description of changes to the target character's relationship settings with the user (type, pattern, or boundary); write 'no changes' if unchanged",
  "eventChanges": "description of changes to the target character's key events; write 'no changes' if unchanged"
}`;
}



const useAdventureView = () => {
  const {
    messages, setMessages,
    input, setInput,
    inputMode, setInputMode,
    isStreaming, setIsStreaming,
    expandedBlocks, setExpandedBlocks,
    selectedWorldBookId, setSelectedWorldBookId,
    selectedCharacterCardIds, setSelectedCharacterCardIds,
    sessions, setSessions,
    sessionId, setSessionId,
    sessionTitle, setSessionTitle,
    activeRun, setActiveRun,
    isSessionArchived, setIsSessionArchived,
    initialPlot, setInitialPlot,
    contextCompaction, setContextCompaction,
    dynamicRoleLoadingEnabled, setDynamicRoleLoadingEnabled,
    selectedStylePresetIds, setSelectedStylePresetIds,
    initialStylePresetIds, initialSystemPromptSnapshot, setInitialStylePresetSnapshot,
    createNewSession
  } = useStoryStore();

  const { worldBooks, characterCards, updateItemFields, selectItem } = usePartnerStore();

  const { userInfo: partnerChatUserInfo } = usePartnerChatStore();
  const settings = useSettingsStore();
  const stylePresets = useStylePresetStore((state) => state.presets);

  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const currentThinkingIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeRunRef = useRef(activeRun);
  const messagesRef = useRef(messages);
  const sessionsRef = useRef(sessions);
  const sessionIdRef = useRef(sessionId);
  const sessionTitleRef = useRef(sessionTitle);
  const isSessionArchivedRef = useRef(isSessionArchived);
  const selectedCharacterCardIdsRef = useRef(selectedCharacterCardIds);
  const contextCompactionRef = useRef<SessionContextCompaction | null>(contextCompaction);
  const selectedStylePresetIdsRef = useRef(selectedStylePresetIds);
  const initialStylePresetIdsRef = useRef(initialStylePresetIds);
  const initialSystemPromptSnapshotRef = useRef(initialSystemPromptSnapshot);

  const [uiState, , setUiField] = useStateGroup<AdventureUiState>({
    isArchiveModalOpen: false,
    isSaveChoiceOpen: false,
    isAnalyzing: false,
    isSavingConversation: false,
    saveChoiceTitle: '',
    saveChoiceOverwriteAvailable: false,
    archiveAnalyses: {},
    selectedTargetCardId: '',
    editedTitle: '',
    editedRelationTypes: {},
    editedRelationModels: {},
    editedRelationBottomLines: {},
    editedEventsMap: {},
    editingMessageId: null,
    editingContent: '',
    tempSelectedCardIds: [],
    hasStartedAnalysis: false,
    expandedCharacterGroupKeys: [],
    isHistoryOpen: false,
  });
  const {
    isArchiveModalOpen,
    isSaveChoiceOpen,
    isAnalyzing,
    isSavingConversation,
    saveChoiceTitle,
    saveChoiceOverwriteAvailable,
    archiveAnalyses,
    selectedTargetCardId,
    editedTitle,
    editedRelationTypes,
    editedRelationModels,
    editedRelationBottomLines,
    editedEventsMap,
    editingMessageId,
    editingContent,
    tempSelectedCardIds,
    hasStartedAnalysis,
    expandedCharacterGroupKeys,
    isHistoryOpen,
  } = uiState;
  const setIsArchiveModalOpen = (isArchiveModalOpen: boolean) => setUiField('isArchiveModalOpen', isArchiveModalOpen);
  const setIsSaveChoiceOpen = (isSaveChoiceOpen: boolean) => setUiField('isSaveChoiceOpen', isSaveChoiceOpen);
  const setIsAnalyzing = (isAnalyzing: boolean) => setUiField('isAnalyzing', isAnalyzing);
  const setIsSavingConversation = (isSavingConversation: boolean) => setUiField('isSavingConversation', isSavingConversation);
  const setSaveChoiceTitle = (saveChoiceTitle: string) => setUiField('saveChoiceTitle', saveChoiceTitle);
  const setSaveChoiceOverwriteAvailable = (saveChoiceOverwriteAvailable: boolean) => setUiField('saveChoiceOverwriteAvailable', saveChoiceOverwriteAvailable);
  const setArchiveAnalyses = (archiveAnalyses: Record<string, ArchiveAnalysisResult>) => setUiField('archiveAnalyses', archiveAnalyses);
  const setSelectedTargetCardId = (selectedTargetCardId: string) => setUiField('selectedTargetCardId', selectedTargetCardId);
  const setEditedTitle = (editedTitle: string) => setUiField('editedTitle', editedTitle);
  const setEditedRelationTypes = (editedRelationTypes: React.SetStateAction<Record<string, string>>) => setUiField('editedRelationTypes', editedRelationTypes);
  const setEditedRelationModels = (editedRelationModels: React.SetStateAction<Record<string, string>>) => setUiField('editedRelationModels', editedRelationModels);
  const setEditedRelationBottomLines = (editedRelationBottomLines: React.SetStateAction<Record<string, string>>) => setUiField('editedRelationBottomLines', editedRelationBottomLines);
  const setEditedEventsMap = (editedEventsMap: React.SetStateAction<Record<string, string>>) => setUiField('editedEventsMap', editedEventsMap);
  const setEditingMessageId = (editingMessageId: string | null) => setUiField('editingMessageId', editingMessageId);
  const setEditingContent = (editingContent: string) => setUiField('editingContent', editingContent);
  const setTempSelectedCardIds = (tempSelectedCardIds: React.SetStateAction<string[]>) => setUiField('tempSelectedCardIds', tempSelectedCardIds);
  const setHasStartedAnalysis = (hasStartedAnalysis: boolean) => setUiField('hasStartedAnalysis', hasStartedAnalysis);
  const setExpandedCharacterGroupKeys = (expandedCharacterGroupKeys: React.SetStateAction<React.Key[]>) => setUiField('expandedCharacterGroupKeys', expandedCharacterGroupKeys);
  const setIsHistoryOpen = (isHistoryOpen: boolean) => setUiField('isHistoryOpen', isHistoryOpen);


  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);
  useEffect(() => { isSessionArchivedRef.current = isSessionArchived; }, [isSessionArchived]);
  useEffect(() => { selectedCharacterCardIdsRef.current = selectedCharacterCardIds; }, [selectedCharacterCardIds]);
  useEffect(() => { contextCompactionRef.current = contextCompaction; }, [contextCompaction]);
  useEffect(() => { selectedStylePresetIdsRef.current = selectedStylePresetIds; }, [selectedStylePresetIds]);
  useEffect(() => { initialStylePresetIdsRef.current = initialStylePresetIds; }, [initialStylePresetIds]);
  useEffect(() => { initialSystemPromptSnapshotRef.current = initialSystemPromptSnapshot; }, [initialSystemPromptSnapshot]);

  const refreshSessions = useCallback(async () => {
    try {
      const summaries = await listSessions('story');
      setSessions(summaries);
      sessionsRef.current = summaries;
      return summaries;
    } catch (err) {
      console.error('Failed to load story sessions:', err);
      return sessionsRef.current;
    }
  }, [setSessions]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Per-request stream event handler. The DSH stream only emits
  // start/delta/thinking_delta/done/error/aborted — there are no tool or
  // compaction events, so those branches of the MuseAI listener are gone.
  const handleStreamEvent = useCallback((event: ChatStreamEventWire, agentMessageId: string) => {
    if (event.event === 'delta' && event.delta) {
      currentThinkingIdRef.current = null;
      setMessages((prev) => prev.map((msg) => (
        msg.id === agentMessageId
          ? { ...msg, content: msg.content + event.delta }
          : msg
      )));
      return;
    }

    if (event.event === 'thinking_delta' && event.delta) {
      setMessages((prev) => prev.map((msg) => {
        if (msg.id !== agentMessageId) return msg;
        let newContent = msg.content;
        const newThinkingBlocks = [...(msg.thinkingBlocks ?? [])];

        if (!currentThinkingIdRef.current) {
          currentThinkingIdRef.current = `thinking-${Date.now()}`;
          newContent += `\n\n[[THINKING:${currentThinkingIdRef.current}]]\n\n`;
          newThinkingBlocks.push({ id: currentThinkingIdRef.current, content: event.delta! });
        } else {
          const blockIndex = newThinkingBlocks.findIndex(b => b.id === currentThinkingIdRef.current);
          if (blockIndex >= 0) {
            newThinkingBlocks[blockIndex] = {
              ...newThinkingBlocks[blockIndex],
              content: newThinkingBlocks[blockIndex].content + event.delta!
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

    if (event.event === 'error') {
      currentThinkingIdRef.current = null;
      setMessages((prev) => prev.map((msg) => (
        msg.id === agentMessageId
          ? { ...msg, content: event.message ? `Adventure simulation failed: ${event.message}` : 'Adventure simulation failed' }
          : msg
      )));
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
      return;
    }

    if (event.event === 'aborted' || event.event === 'done') {
      currentThinkingIdRef.current = null;
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
    }
  }, [setActiveRun, setIsStreaming, setMessages]);

  const runStoryStream = async (request: ChatRequestWire, agentMessageId: string) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      await streamChat(request, (event) => {
        if (event.event === 'start') {
          activeRunRef.current = { runId: event.runId, messageId: agentMessageId };
          setActiveRun({ runId: event.runId, messageId: agentMessageId });
        }
        handleStreamEvent(event, agentMessageId);
      }, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        // User-initiated stop: the stream was cut locally; keep content as-is.
        currentThinkingIdRef.current = null;
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        setIsStreaming(false);
        return;
      }
      currentThinkingIdRef.current = null;
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
      setMessages((prev) => prev.map((msg) => (
        msg.id === agentMessageId
          ? { ...msg, content: `Adventure request failed: ${String(err)}` }
          : msg
      )));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

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
  const selectedCards = filterItemsById(characterCards, selectedCharacterCardIds);
  const tempSelectedCardIdSet = new Set(tempSelectedCardIds);
  const characterCardGroups = useMemo(
    () => groupCharacterCardsByWorldBook(worldBooks, characterCards),
    [worldBooks, characterCards],
  );
  const characterCardGroupKeys = useMemo(
    () => characterCardGroups.map((group) => group.key),
    [characterCardGroups],
  );
  const characterCardGroupKeySet = useMemo(
    () => new Set(characterCardGroupKeys),
    [characterCardGroupKeys],
  );
  const characterCardIdSet = new Set(characterCards.map((card) => card.id));
  useEffect(() => {
    setUiField('expandedCharacterGroupKeys', (keys) => keys.filter((key) => characterCardGroupKeySet.has(String(key))));
  }, [characterCardGroupKeySet, setUiField]);

  const toggleCharacterGroup = (groupKey: string) => {
    setExpandedCharacterGroupKeys((keys) =>
      keys.includes(groupKey) ? keys.filter((key) => key !== groupKey) : [...keys, groupKey]
    );
  };

  const characterCardTreeData = characterCardGroups.map((group) => ({
    key: group.key,
    title: (
      <button
        type="button"
        style={CHARACTER_GROUP_TITLE_BUTTON_STYLE}
        onClick={(event) => {
          event.stopPropagation();
          toggleCharacterGroup(group.key);
        }}
      >
        <BookOutlined style={{ color: group.worldBookId ? '#d97757' : '#c0bbb4' }} />
        {group.title}
      </button>
    ),
    selectable: false,
    children: group.cards.map((card) => ({
      key: card.id,
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#33312e' }}>
          <UserOutlined style={{ color: '#8c8882' }} />
          {card.name}
        </span>
      ),
      isLeaf: true,
    })),
  }));
  const handleWorldBookChange = (worldBookId: string) => {
    setSelectedWorldBookId(worldBookId);
    setSelectedCharacterCardIds(getCharacterCardIdsForWorldBook(worldBookId, characterCards));
  };
  const handleCharacterCardCheck = (checkedKeys: React.Key[] | { checked: React.Key[] }) => {
    const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
    setSelectedCharacterCardIds(keys.reduce<string[]>((ids, key) => {
      const id = String(key);
      if (characterCardIdSet.has(id)) ids.push(id);
      return ids;
    }, []));
  };

  // Compile final Prompt
  const adventureBaseSystemPrompt = dynamicRoleLoadingEnabled
    ? settings.storyDynamicAgentPrompt || ''
    : settings.storyAgentPrompt || '';
  const baseSystemPrompt = prependStylePresets(adventureBaseSystemPrompt, stylePresets, selectedStylePresetIds);
  const effectiveSystemPrompt = compileStorySystemPrompt({
    basePrompt: baseSystemPrompt,
    worldBookContent: selectedWorldBook ? selectedWorldBook.content : null,
    characterCards: selectedCards.map((card) => ({ name: card.name, content: card.content })),
    userInfo: partnerChatUserInfo,
    dynamicRoleLoadingEnabled,
  });
  const storyAgentConfigId = dynamicRoleLoadingEnabled ? 'storyDynamicAgent' : 'storyAgent';
  const storyAgentConfig = settings.agentConfigs?.[storyAgentConfigId] || {
    temperature: 0.3,
    maxOutputTokens: 32000,
    maxContextTokens: 200000,
    thinkingDepth: 'off',
  };

  const buildStoryChatRequest = (wireMessages: WireMessage[]): ChatRequestWire => ({
    agentId: 'storyAgent',
    system: effectiveSystemPrompt,
    messages: wireMessages,
    temperature: storyAgentConfig.temperature ?? 0.3,
    maxTokens: storyAgentConfig.maxOutputTokens ?? 32000,
    thinkingDepth: storyAgentConfig.thinkingDepth ?? 'off',
  });

  const startAdventure = async () => {
    if (!selectedWorldBookId || !initialPlot.trim()) {
      message.warning('Please select a world book and enter the initial plot setup first!');
      return;
    }

    const initialIds = [...selectedStylePresetIdsRef.current];
    setInitialStylePresetSnapshot(initialIds, effectiveSystemPrompt);
    initialStylePresetIdsRef.current = initialIds;
    initialSystemPromptSnapshotRef.current = effectiveSystemPrompt;

    const formattedPlot = initialPlot.trim();
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: formattedPlot,
      tools: []
    };
    const agentMessageId = `msg-${Date.now() + 1}`;
    const pendingAgentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      tools: []
    };

    const nextMessages = [userMessage, pendingAgentMessage];
    contextCompactionRef.current = null;
    setContextCompaction(null);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    // Initial fallback title
    const fallbackTitle = formattedPlot.length > 15 ? `${formattedPlot.slice(0, 15)}...` : formattedPlot;
    sessionTitleRef.current = fallbackTitle;
    setSessionTitle(fallbackTitle);
    setIsStreaming(true);

    // Try background title summary
    complete({
      agentId: 'storyAgent',
      system: 'Use the user input message to summarize the user intent in no more than 15 characters.',
      messages: [{ role: 'user', content: formattedPlot }],
      temperature: 0.3,
      maxTokens: 128,
    }).then((result) => {
      const generatedTitle = result.text.trim();
      if (generatedTitle) {
        sessionTitleRef.current = generatedTitle;
        setSessionTitle(generatedTitle);
      }
    }).catch((e) => {
      console.error('Failed to generate adventure title:', e);
    });

    void runStoryStream(
      buildStoryChatRequest([{ role: 'user', content: formattedPlot }]),
      agentMessageId,
    );
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    // Apply input format rules based on mode
    let formattedText = trimmed;
    if (inputMode === 'speech') {
      formattedText = `I: "${trimmed}"`;
    } else if (inputMode === 'behavior') {
      formattedText = `(I ${trimmed})`;
    } else if (inputMode === 'plot') {
      formattedText = `[Plot advance] ${trimmed}`;
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: formattedText,
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

    const wireMessages = buildWireMessages(buildStoryModelMessages(nextMessages.slice(0, -1)));
    void runStoryStream(buildStoryChatRequest(wireMessages), agentMessageId);
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

      const wireMessages = buildWireMessages(buildStoryModelMessages(baseMessages));
      void runStoryStream(buildStoryChatRequest(wireMessages), agentMessageId);
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

    const wireMessages = buildWireMessages(buildStoryModelMessages(baseMessages));
    void runStoryStream(buildStoryChatRequest(wireMessages), agentMessageId);
  };

  const toggleBlock = (id: string) => {
    setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const ensureCurrentSessionId = useCallback(() => {
    const nextSessionId = ensureSessionId(sessionIdRef.current, 'story-session');
    if (nextSessionId !== sessionIdRef.current) {
      sessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
    }
    return nextSessionId;
  }, [setSessionId]);

  const saveCurrentSession = async (title = sessionTitleRef.current, sessionIdOverride?: string) => {
    const userMessages = messagesRef.current.filter(m => m.role === 'user');
    if (userMessages.length === 0) return false;
    const currentSessionId = sessionIdOverride
      ? ensureSessionId(sessionIdOverride, 'story-session')
      : ensureCurrentSessionId();

    try {
      await saveSession('story', {
        id: currentSessionId,
        title,
        savedAt: Date.now(),
        sessionKind: 'story',
        messages: messagesRef.current,
        todos: [],
        contextCompaction: contextCompactionRef.current,
        isArchived: isSessionArchivedRef.current,
        selectedWorldBookId,
        dynamicRoleLoadingEnabled,
        characterCardIds: selectedCharacterCardIdsRef.current,
        selectedStylePresetIds: selectedStylePresetIdsRef.current,
        initialStylePresetIds: initialStylePresetIdsRef.current,
        initialSystemPromptSnapshot: initialSystemPromptSnapshotRef.current,
      });
      await refreshSessions();
      return currentSessionId;
    } catch (err) {
      console.error('Failed to save story session:', err);
      return false;
    }
  };

  const handleSaveConversation = async () => {
    if (messages.length === 0 || isStreaming || isSessionArchived) {
      message.warning('There is no conversation to save right now');
      return;
    }
    setIsSavingConversation(true);
    try {
      const chatHistoryText = messages.reduce<string[]>((lines, m) => {
        if (m.role === 'user' || m.role === 'agent') {
          lines.push(`${m.role === 'user' ? 'I' : 'Story narrator & NPCs'}: ${m.content.replace(/\[\[THINKING:[^\]]+\]\]/g, '').trim()}`);
        }
        return lines;
      }, []).join('\n\n');
      const finalTitle = await resolveSessionTitle({
        currentTitle: sessionTitleRef.current,
        defaultTitle: 'New story',
        messages,
        finalFallback: 'Untitled story',
        summarize: () => complete({
          agentId: 'storyAgent',
          system: 'Use the user input message to summarize the user intent in no more than 15 characters.',
          messages: [{ role: 'user', content: chatHistoryText }],
          temperature: 0.3,
          maxTokens: 128,
        }).then((result) => result.text),
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
    const finalTitle = name || saveChoiceTitle || sessionTitleRef.current || 'Untitled story';
    const targetSessionId = mode === 'create'
      ? createSessionId('story-session')
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
      const session = await loadSession('story', id);
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setSessionId(session.id);
      setSessionTitle(session.title);
      setMessages(session.messages);
      setSelectedWorldBookId(session.selectedWorldBookId ?? null);
      setSelectedCharacterCardIds(session.characterCardIds ?? []);
      setDynamicRoleLoadingEnabled(session.dynamicRoleLoadingEnabled ?? false);
      setSelectedStylePresetIds(session.selectedStylePresetIds ?? []);
      setInitialStylePresetSnapshot(session.initialStylePresetIds ?? [], session.initialSystemPromptSnapshot ?? '');
      const restoredCompaction = (session.contextCompaction as SessionContextCompaction | null | undefined) ?? null;
      contextCompactionRef.current = restoredCompaction;
      setContextCompaction(restoredCompaction);
      setIsStreaming(false);
      setInput('');
      setIsSessionArchived(session.isArchived ?? false);
      scrollToBottomOnce();
    } catch (err) {
      console.error('Failed to open story session:', err);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession('story', id);
      message.success('Adventure record deleted');
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
    const record = await loadSession('story', id);
    await saveSession('story', { ...record, title });
    if (id === sessionIdRef.current) {
      sessionTitleRef.current = title;
      setSessionTitle(title);
    }
    await refreshSessions();
  };

  const handleArchiveMemory = async () => {
    if (messages.length === 0 || isStreaming || isSessionArchived) return;

    if (selectedCards.length === 0) {
      message.warning('This adventure has no character cards bound yet, so its memory cannot be archived!');
      return;
    }

    setTempSelectedCardIds(selectedCards.map(c => c.id));
    setHasStartedAnalysis(false);
    setArchiveAnalyses({});
    setIsArchiveModalOpen(true);
  };

  const startAnalyzingSelectedCards = async () => {
    if (tempSelectedCardIds.length === 0) return;

    setIsAnalyzing(true);
    setHasStartedAnalysis(true);
    setSelectedTargetCardId(tempSelectedCardIds[0]);

    const chatHistoryText = messages.reduce<string[]>((lines, m) => {
      if (m.role === 'user' || m.role === 'agent') {
        const sender = m.role === 'user' ? 'I' : 'Story narrator & NPCs';
        const cleanContent = m.content.replace(/\[\[THINKING:[^\]]+\]\]/g, '').trim();
        if (cleanContent !== '') {
          lines.push(`${sender}: ${cleanContent}`);
        }
      }
      return lines;
    }, []).join('\n\n');

    try {
      const archiveConfig = settings.agentConfigs?.storyArchive || {};
      const selectedCardIds = new Set(tempSelectedCardIds);
      const promises: Promise<{ cardId: string; analysis: ArchiveAnalysisResult }>[] = [];
      for (const card of selectedCards) {
        if (!selectedCardIds.has(card.id)) {
          continue;
        }
        promises.push(complete({
          agentId: 'storyAgent',
          system: settings.storyArchivePrompt || undefined,
          messages: [{ role: 'user', content: buildAnalyzeMemoryUserMessage({
            targetName: card.name,
            targetContent: card.content,
            chatHistory: chatHistoryText,
            currentUserRelationType: card.fields?.userRelationType || '',
            currentUserInteractionModel: card.fields?.userInteractionModel || '',
            currentUserRelationBottomLine: card.fields?.userRelationBottomLine || '',
            currentEvents: card.fields?.keyEvents || 'No shared key events yet.',
          }) }],
          temperature: archiveConfig.temperature ?? 0.3,
          maxTokens: archiveConfig.maxOutputTokens ?? 32000,
          thinkingDepth: archiveConfig.thinkingDepth ?? 'off',
        }).then((result) => ({
          cardId: card.id,
          analysis: parseArchiveAnalysisResponse(result.text) as ArchiveAnalysisResult,
        })));
      }

      const results = await Promise.all(promises);
      const analyses: Record<string, ArchiveAnalysisResult> = {};
      const relationTypes: Record<string, string> = {};
      const relationModels: Record<string, string> = {};
      const relationBottomLines: Record<string, string> = {};
      const events: Record<string, string> = {};
      let firstSessionTitle = '';

      for (const res of results) {
        analyses[res.cardId] = res.analysis;
        relationTypes[res.cardId] = res.analysis.userRelationType || '';
        relationModels[res.cardId] = res.analysis.userInteractionModel || '';
        relationBottomLines[res.cardId] = res.analysis.userRelationBottomLine || '';
        events[res.cardId] = res.analysis.keyEvents || '';
        if (!firstSessionTitle) {
          firstSessionTitle = res.analysis.sessionTitle || '';
        }
      }

      setArchiveAnalyses(analyses);
      setEditedRelationTypes(relationTypes);
      setEditedRelationModels(relationModels);
      setEditedRelationBottomLines(relationBottomLines);
      setEditedEventsMap(events);
      setEditedTitle(firstSessionTitle || sessionTitle || 'Untitled story');
    } catch (err) {
      console.error('Failed to analyze story memory:', err);
      message.error(`Failed to analyze story memory: ${String(err)}`);
      setIsArchiveModalOpen(false);
      setHasStartedAnalysis(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTargetCardChange = (cardId: string) => {
    setSelectedTargetCardId(cardId);
  };

  const handleConfirmArchive = async () => {
    try {
      // 1. Update all character card fields
      const filteredCards = filterItemsById(selectedCards, tempSelectedCardIds);
      for (const card of filteredCards) {
        const relationType = editedRelationTypes[card.id] || '';
        const relationModel = editedRelationModels[card.id] || '';
        const relationBottomLine = editedRelationBottomLines[card.id] || '';
        const events = editedEventsMap[card.id] || '';
        updateItemFields(card.id, 'character_card', {
          userRelationType: relationType,
          userInteractionModel: relationModel,
          userRelationBottomLine: relationBottomLine,
          keyEvents: events
        });
      }

      // 2. Archive session state
      setIsSessionArchived(true);
      const finalTitle = editedTitle.trim() || 'Untitled story';
      setSessionTitle(finalTitle);
      sessionTitleRef.current = finalTitle;
      isSessionArchivedRef.current = true;

      // 3. Save the archived session
      const saved = await saveCurrentSession();
      if (!saved) {
        throw new Error('Failed to save the archived session');
      }

      message.success('Adventure memory archived to the selected character cards! This session is now locked as archived.');
      setIsArchiveModalOpen(false);
    } catch (err) {
      console.error('Failed to archive story memory:', err);
      message.error(`Failed to archive story memory: ${String(err)}`);
    }
  };

  // Context Stats
  const effectiveContextMessages = getEffectiveMessagesForContextStats(messages, contextCompaction);
  const contextStats = estimateContextUsage(effectiveSystemPrompt, effectiveContextMessages, input);
  const maxContext = storyAgentConfig.maxContextTokens ?? 200000;
  const contextPercent = maxContext > 0
    ? Math.min(100, Math.round((contextStats.total / maxContext) * 100))
    : 0;

  const contextTooltip = (
    <div className="agent-context-popover">
      <div className="agent-context-popover__header">
        <strong>Adventure context details</strong>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">World book:</span>
        <span className="agent-context-popover__value">{selectedWorldBook?.name || 'Not bound'}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">Active characters:</span>
        <span className="agent-context-popover__value">{selectedCards.map(c => c.name).join(', ') || 'Not bound'}</span>
      </div>
      <div className="agent-context-popover__divider" />
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">Estimated tokens:</span>
        <span className="agent-context-popover__value agent-context-popover__value--highlight">{contextStats.total} / {maxContext}</span>
      </div>
    </div>
  );

  const hasMessages = messages.length > 0;


  return (
    <div className="agent-chat" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#faf9f5' }}>

      <SaveChoiceModal
        open={isSaveChoiceOpen}
        title="Save conversation"
        nameLabel="Session name"
        initialName={saveChoiceTitle || sessionTitle}
        loading={isSavingConversation}
        overwriteAvailable={saveChoiceOverwriteAvailable}
        overwriteTargetLabel="Overwrite record"
        overwriteTargets={sessions.map((session) => {
          const targetInfo = buildSessionHistoryDetails(session, worldBooks, characterCards);
          return {
            value: session.id,
            label: session.title || 'Untitled story',
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
            <span>Archive adventure memory & sync settings</span>
          </div>
        }
        open={isArchiveModalOpen}
        onCancel={() => !isAnalyzing && setIsArchiveModalOpen(false)}
        width={720}
        styles={{ body: { padding: '16px 24px' } }}
        footer={
          !hasStartedAnalysis ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setIsArchiveModalOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                disabled={tempSelectedCardIds.length === 0}
                onClick={startAnalyzingSelectedCards}
                style={{
                  backgroundColor: tempSelectedCardIds.length > 0 ? '#d97757' : undefined,
                  borderColor: tempSelectedCardIds.length > 0 ? '#d97757' : undefined,
                  borderRadius: '6px',
                  color: tempSelectedCardIds.length > 0 ? '#ffffff' : undefined
                }}
              >
                Start analysis & archive
              </Button>
            </div>
          ) : isAnalyzing ? null : (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setIsArchiveModalOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                onClick={handleConfirmArchive}
                style={{
                  backgroundColor: '#d97757',
                  borderColor: '#d97757',
                  borderRadius: '6px',
                  color: '#ffffff'
                }}
              >
                Confirm sync & archive
              </Button>
            </div>
          )
        }
      >
        {!hasStartedAnalysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px 0' }}>
            <div style={{ fontSize: '14px', color: '#5c5751', fontWeight: 500 }}>
              Check the character cards to update with this archived memory:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '8px 0' }}>
              {selectedCards.map((card) => {
                const isChecked = tempSelectedCardIdSet.has(card.id);
                return (
                  <Checkbox
                    key={card.id}
                    checked={isChecked}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setTempSelectedCardIds((prev) =>
                        checked ? [...prev, card.id] : prev.filter((id) => id !== card.id)
                      );
                    }}
                    className={`adventure-archive-checkbox ${isChecked ? 'is-selected' : ''}`}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{card.name}</span>
                  </Checkbox>
                );
              })}
            </div>
          </div>
        ) : isAnalyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '16px' }}>
            <Spin size="large" />
            <div style={{ color: '#8c8882', fontSize: '14px' }}>
              Distilling relationships and milestone events from this adventure...
            </div>
          </div>
        ) : archiveAnalyses[selectedTargetCardId] ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Target Character Card Sync Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#faf6f0', padding: '12px 16px', borderRadius: '8px', border: '1px solid #f2e8dc' }}>
              <strong style={{ color: '#33312e', fontSize: '14px' }}>Select the character card to sync:</strong>
              <Select
                value={selectedTargetCardId}
                onChange={handleTargetCardChange}
                style={{ width: 220 }}
                options={selectedCards.reduce<{ value: string; label: string }[]>((options, c) => {
                  if (tempSelectedCardIdSet.has(c.id)) {
                    options.push({ value: c.id, label: c.name });
                  }
                  return options;
                }, [])}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Relationship changes</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalyses[selectedTargetCardId]?.relationChanges}</div>
              </div>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>Milestone events</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalyses[selectedTargetCardId]?.eventChanges}</div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(0,0,0,0.03)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Adventure title</div>
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="Adventure title"
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated relationship type with user ({selectedCards.find(c => c.id === selectedTargetCardId)?.name})</div>
                <Input
                  value={editedRelationTypes[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedRelationTypes(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  placeholder="Relationship type with user..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated interaction pattern with user ({selectedCards.find(c => c.id === selectedTargetCardId)?.name})</div>
                <Input.TextArea
                  value={editedRelationModels[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedRelationModels(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="Interaction pattern with user..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated relationship boundary with user ({selectedCards.find(c => c.id === selectedTargetCardId)?.name})</div>
                <Input.TextArea
                  value={editedRelationBottomLines[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedRelationBottomLines(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="Relationship boundary with user..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>Updated key-event records ({selectedCards.find(c => c.id === selectedTargetCardId)?.name})</div>
                <Input.TextArea
                  value={editedEventsMap[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedEventsMap(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  autoSize={{ minRows: 4, maxRows: 8 }}
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
          <CompassOutlined style={{ color: '#d97757', fontSize: 18 }} />
          <h3 style={{ margin: 0, fontWeight: 600, color: '#33312e', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {hasMessages ? sessionTitle : 'Adventure'}
            <span style={{ fontSize: 12, color: '#8c8882', fontWeight: 400 }}>
              ({selectedWorldBook?.name || 'No world book'} · {selectedCards.length} active characters{dynamicRoleLoadingEnabled ? ' · dynamic loading' : ''})
            </span>
          </h3>
        </div>

        <div className="agent-chat__header-actions">
          {selectedCards.length > 0 && (
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
                  Save conversation
                </Button>
              </Tooltip>
              <Tooltip title={isSessionArchived ? "This adventure record has been archived" : "Archive this adventure's memory and lock the session"}>
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
                  Archive memory
                </Button>
              </Tooltip>
            </>
          )}

          <Tooltip title="Start a new adventure">
            <Button type="text" icon={<ReloadOutlined />} onClick={createNewSession} />
          </Tooltip>

          <Tooltip title="History">
            <Button
              aria-label="History"
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
        title="Adventure history"
        emptyText="No past adventures yet"
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

          {/* Foldable System Prompt */}
          <div className="agent-message-row agent-message-row--system">
            <div className="agent-message-bubble agent-message-bubble--system">
              <FoldBlock
                icon={<InfoCircleOutlined />}
                variant="thinking"
                title={dynamicRoleLoadingEnabled ? 'Adventure system prompt (dynamic character card loading)' : 'Adventure system prompt (world book & character cards merged)'}
                preview={(hasMessages && initialSystemPromptSnapshot ? initialSystemPromptSnapshot : effectiveSystemPrompt).slice(0, 80) + ((hasMessages && initialSystemPromptSnapshot ? initialSystemPromptSnapshot : effectiveSystemPrompt).length > 80 ? '...' : '')}
                detail={hasMessages && initialSystemPromptSnapshot ? initialSystemPromptSnapshot : effectiveSystemPrompt}
                expanded={Boolean(expandedBlocks['story-system-prompt'])}
                onToggle={() => toggleBlock('story-system-prompt')}
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
                            title="Reasoning"
                            preview={msg.thinking}
                            expanded={Boolean(expandedBlocks[`${msg.id}-thinking`])}
                            onToggle={() => toggleBlock(`${msg.id}-thinking`)}
                          />
                        )}

                        {(() => {
                          let contentToRender = msg.content || '';
                          const choicesMatch = contentToRender.match(/<choices>\s*(\[[\s\S]*?\])(?:\s*<\/choices>)?/);
                          let choices: string[] = [];
                          if (choicesMatch) {
                            contentToRender = contentToRender.replace(choicesMatch[0], '');
                            try {
                              choices = JSON.parse(choicesMatch[1]);
                            } catch (e) { }
                          }

                          const parts = contentToRender.split(/(\[\[(?:TOOL|THINKING):[^\]]+\]\])/);
                          const renderedToolIds = new Set<string>();
                          const getMarkdownPartKey = createStableContentKey(`${msg.id}-md`);
                          const getToolKey = createStableToolKey(`${msg.id}-tool`);
                          const getChoiceKey = createStableContentKey(`${msg.id}-choice`);

                          const renderedParts = parts.map((part) => {
                            const toolMatch = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
                            if (toolMatch) {
                              const toolId = toolMatch[1];
                              const tool = msg.tools?.find(t => t.id === toolId);
                              if (tool) {
                                const toolKey = getToolKey(tool);
                                renderedToolIds.add(toolId);
                                return renderStoryTool(
                                  tool,
                                  toolKey,
                                  Boolean(expandedBlocks[toolKey]),
                                  () => toggleBlock(toolKey),
                                );
                              }
                              return null;
                            }

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
                                    title="Thought process"
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

                          const unrenderedTools = (msg.tools ?? []).map((tool) => {
                            if (tool.id && renderedToolIds.has(tool.id)) return null;
                            const toolKey = getToolKey(tool);
                            return renderStoryTool(
                              tool,
                              toolKey,
                              Boolean(expandedBlocks[toolKey]),
                              () => toggleBlock(toolKey),
                            );
                          });

                          return (
                            <>
                              {renderedParts}
                              {unrenderedTools}
                              {choices.length > 0 && !isSessionArchived && isLastAgent && (
                                <div className="book-travel-suggested-choices" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {choices.map((choice) => (
                                    <Button
                                      key={getChoiceKey(choice)}
                                      type="dashed"
                                      style={{ textAlign: 'left', height: 'auto', padding: '8px 12px', whiteSpace: 'normal', color: '#d97757', borderColor: '#d97757' }}
                                      onClick={() => {
                                        setInput(choice);
                                        setInputMode('behavior');
                                      }}
                                    >
                                      {choice}
                                    </Button>
                                  ))}
                                </div>
                              )}
                            </>
                          );
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
        /* Empty/Wizard Setup State */
        <div className="adventure-setup">
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <CompassOutlined style={{ fontSize: '56px', color: '#d97757', marginBottom: '16px', opacity: 0.9 }} />
            <h2 style={{ fontSize: '26px', fontWeight: 600, color: '#33312e', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
              Adventure
            </h2>
            <p style={{ color: '#8c8882', fontSize: '15px', margin: 0 }}>
              Pick a world setting and adventure characters, then set off on a one-of-a-kind fantasy journey
            </p>
          </div>

          <div className="adventure-setup-card">
            {/* World Book Dropdown Selector */}
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#33312e', marginBottom: '8px' }}>
                Choose an adventure world setting (World Book)
              </div>
              <Select
                aria-label="Choose an adventure world book"
                placeholder="Choose a world setting..."
                value={selectedWorldBookId}
                onChange={handleWorldBookChange}
                style={{ width: '100%' }}
                options={worldBooks.map((wb) => ({ value: wb.id, label: wb.name }))}
              />
            </div>

            {/* Character Cards Multi Selector */}
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#33312e', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span>Choose character cards for the adventure (multi-select)</span>
                <button
                  type="button"
                  style={BACKGROUND_LINK_BUTTON_STYLE}
                  onClick={() => selectItem(null, null)}
                >
                  Create a persona on the Background page &gt;
                </button>
              </div>

              {characterCards.length > 0 ? (
                <div style={{ border: '1px solid #eae6df', borderRadius: 6, background: '#faf9f5', padding: '8px 4px' }}>
                  <Tree
                    checkable
                    expandedKeys={expandedCharacterGroupKeys}
                    onExpand={(keys) => setExpandedCharacterGroupKeys(keys)}
                    selectable={false}
                    onClick={(_, node) => {
                      const nextKey = String(node.key);
                      if (characterCardGroupKeys.includes(nextKey)) {
                        toggleCharacterGroup(nextKey);
                      }
                    }}
                    checkedKeys={selectedCharacterCardIds}
                    onCheck={handleCharacterCardCheck}
                    treeData={characterCardTreeData}
                    style={{ background: 'transparent' }}
                  />
                </div>
              ) : (
                <div className="adventure-empty-card">
                  No character cards yet — create one on the Background page!
                </div>
              )}
            </div>

            <StylePresetSelector target="adventure" value={selectedStylePresetIds[0] || null} onChange={(id) => setSelectedStylePresetIds(id ? [id] : [])} />

            {/* Initial Plot TextArea */}
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#33312e', marginBottom: '8px' }}>
                Set the initial plot
              </div>
              <Input.TextArea
                value={initialPlot}
                onChange={(e) => setInitialPlot(e.target.value)}
                placeholder="Roughly describe how the story opens, e.g. 'We wake up in a pitch-black valley, lightning streaks across the sky, and the roar of beasts echoes in the distance. I hold only a rusty iron sword, everyone gathered around me...'"
                autoSize={{ minRows: 4, maxRows: 8 }}
                style={{
                  borderRadius: '8px',
                  borderColor: '#eae6df',
                  backgroundColor: '#faf9f5',
                  fontSize: '14px',
                  lineHeight: 1.6
                }}
              />
            </div>

            <div className="adventure-dynamic-role-card">
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#33312e' }}>
                  Dynamic character card loading
                </div>
                <div style={{ fontSize: '12px', color: '#8c8882', marginTop: 4 }}>
                  When enabled, the agent calls character cards by name to reply during the adventure
                </div>
              </div>
              <Switch
                checked={dynamicRoleLoadingEnabled}
                onChange={setDynamicRoleLoadingEnabled}
              />
            </div>

            {/* Start Button */}
            <Button
              type="primary"
              size="large"
              icon={<PlayCircleOutlined />}
              onClick={startAdventure}
              disabled={!selectedWorldBookId || !initialPlot.trim()}
              style={{
                backgroundColor: (selectedWorldBookId && initialPlot.trim()) ? '#d97757' : undefined,
                borderColor: (selectedWorldBookId && initialPlot.trim()) ? '#d97757' : undefined,
                borderRadius: '8px',
                fontWeight: 600,
                marginTop: '12px'
              }}
            >
              Start the adventure
            </Button>
          </div>

        </div>
      )}

      {/* Composer Input Area */}
      {hasMessages && (
        <div className="agent-composer" style={{
          padding: '16px 24px 24px 24px',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          {/* Formatted Text input helper overlay inside composer box */}
          <div id="agent-composer-box" className="agent-composer__box" style={{
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.04)',
            border: '1px solid #eae6df',
            borderRadius: '12px',
            background: '#ffffff',
            position: 'relative',
            paddingTop: '40px' // Leave space for Segment Tabs
          }}>

            {/* Input Action Segment Controller */}
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '12px',
              zIndex: 10,
              display: 'flex',
              gap: '6px'
            }}>
              <Radio.Group
                value={inputMode}
                onChange={(e) => setInputMode(e.target.value)}
                size="small"
                buttonStyle="solid"
              >
                <Radio.Button value="speech" style={{ borderRadius: '4px 0 0 4px' }}>
                  <CommentOutlined style={{ marginRight: 4 }} />
                  Speak as character
                </Radio.Button>
                <Radio.Button value="behavior">
                  <ExperimentOutlined style={{ marginRight: 4 }} />
                  Character action
                </Radio.Button>
                <Radio.Button value="plot" style={{ borderRadius: '0 4px 4px 0' }}>
                  <BranchesOutlined style={{ marginRight: 4 }} />
                  Advance plot objectively
                </Radio.Button>
              </Radio.Group>
            </div>

            <Input.TextArea
              className="agent-composer__textarea"
              autoSize={{ minRows: 1, maxRows: 8 }}
              disabled={isSessionArchived}
              onChange={(e) => setInput(e.target.value)}
              style={{ zIndex: 2, position: 'relative', background: 'transparent', boxShadow: 'none', border: 'none', padding: '12px 16px 40px 16px', fontSize: '15px' }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                isSessionArchived
                  ? "This adventure's memory has been archived, so no more commands can be sent"
                  : inputMode === 'speech'
                    ? "Type dialogue in your character's voice, press Cmd/Ctrl + Enter to submit..."
                    : inputMode === 'behavior'
                      ? "Describe the specific action your character takes (e.g. picking a lock, casting a spell, hiding)..."
                      : "Describe plot developments in a narrator's voice (e.g. the sky suddenly clears, a monster attacks)..."
              }
              value={input}
            />

            <div className="agent-composer__actions adventure-composer-actions">

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#8c8882' }}>
                  Current mode:
                  <Tag color="orange" style={{ margin: 0 }}>
                    {inputMode === 'speech' ? 'Speak (I: "text")' : inputMode === 'behavior' ? 'Act ((I action))' : 'Third-party plot advance'}
                  </Tag>
                </span>
              </div>

              <div className="agent-send-cluster" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Tooltip color="#fff" placement="topRight" title={contextTooltip} overlayInnerStyle={{ width: 'max-content', maxWidth: 320, padding: '8px 12px', border: '1px solid #eae6df' }}>
                  <button
                    aria-label="View context"
                    className="agent-context-ring"
                    style={{ '--context-fill': `${contextPercent}%` } as React.CSSProperties}
                    type="button"
                  >
                    <span>{contextPercent}%</span>
                  </button>
                </Tooltip>

                <Tooltip title={isStreaming ? 'Stop' : isSessionArchived ? 'This story is archived' : 'Submit action'}>
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
      )}
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

function renderStoryTool(
  tool: AgentToolEntry,
  blockId: string,
  expanded: boolean,
  onToggle: () => void,
) {
  if (tool.name === 'role_play') {
    if (!tool.result.trim()) {
      return null;
    }
    return <RolePlayToolBubble key={`role-play-${tool.id || blockId}`} tool={tool} />;
  }

  return (
    <FoldBlock
      icon={<InfoCircleOutlined />}
      variant="tool"
      key={`tool-${tool.id || blockId}`}
      title={`Tool: ${tool.name}`}
      preview={tool.result}
      expanded={expanded}
      onToggle={onToggle}
    />
  );
}

function RolePlayToolBubble({ tool }: { tool: AgentToolEntry }) {
  const characterName = getRolePlayCharacterName(tool.arguments);
  return (
    <div style={{
      width: '100%',
      border: '1px solid #f1dfd4',
      borderRadius: '8px',
      background: '#fffaf6',
      padding: '12px 14px',
      margin: '8px 0'
    }}>
      <div style={{
        fontSize: '13px',
        fontWeight: 700,
        color: '#d97757',
        marginBottom: '8px'
      }}>
        {characterName}
      </div>
      <div className="agent-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {tool.result || 'The character has not responded yet.'}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export const AdventurePage: React.FC = () => useAdventureView();

export default AdventurePage;
