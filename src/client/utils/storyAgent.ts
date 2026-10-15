import type { AgentToolEntry, Message, ThinkingBlock } from '../stores/useAgentStore';
import { sanitizeToolArguments } from '../utils/toolArguments';

const USER_INFO_LABELS: Record<string, string> = {
  name: 'Name',
  age: 'Age',
  gender: 'Gender',
  race: 'Race',
  birthplace: 'Birthplace',
  occupation: 'Occupation',
  socialClass: 'Social class',
  identityTags: 'Identity tags',
  heightBuild: 'Height/build',
  iconicFeatures: 'Iconic features',
  clothingStyle: 'Clothing style',
  overallVibe: 'Overall vibe',
  externalPersonality: 'External personality',
  internalPersonality: 'Internal personality',
  coreDesire: 'Core desire',
  fearWeakness: 'Fears & weaknesses',
  moralValues: 'Moral values',
  quirk: 'Quirk',
  skills: 'Skills',
  backgroundStory: 'Background story',
  relationships: 'Relationships',
  speakingStyle: 'Speaking style',
  typicalReactions: 'Typical reactions',
};

export interface StoryCharacterPromptSource {
  name: string;
  content: string;
}

export interface StoryPromptOptions {
  basePrompt: string;
  worldBookContent: string | null;
  characterCards: StoryCharacterPromptSource[];
  userInfo: Record<string, unknown>;
  dynamicRoleLoadingEnabled: boolean;
}

export interface StoryModelMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  thinkingBlocks?: ThinkingBlock[];
}

const filterBlankMarkdownFields = (content: string): string => {
  const lines = content.split('\n');
  const afterListFilter = lines.filter(line => !/^\s*-\s*\*\*[^*]+:\s*$/.test(line));
  const result: string[] = [];
  let i = 0;
  while (i < afterListFilter.length) {
    const line = afterListFilter[i];
    if (/^##\s/.test(line)) {
      let j = i + 1;
      while (j < afterListFilter.length && afterListFilter[j].trim() === '') {
        j++;
      }
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

export function compileStorySystemPrompt({
  basePrompt,
  worldBookContent,
  characterCards,
  userInfo,
  dynamicRoleLoadingEnabled,
}: StoryPromptOptions): string {
  let prompt = basePrompt.trim();

  if (worldBookContent && worldBookContent.trim()) {
    prompt += `\n\n## Story world setting\nStrictly follow the world setting below when narrating; do not go beyond its scope:\n${filterBlankMarkdownFields(worldBookContent.trim())}`;
  }

  if (dynamicRoleLoadingEnabled) {
    if (characterCards.length > 0) {
      const roleNames = characterCards.map((card) => `- ${card.name}`).join('\n');
      prompt += `\n\n## Dynamically callable characters\nThe following characters can speak in their own voice via the role_play tool by passing the character name. When you need a character to speak as themselves, you must call the role_play tool with the character name:\n${roleNames}`;
      prompt += `\n\n## Active story characters (background NPCs)\nThe following are the active NPC character profiles participating in this adventure. Even with dynamic loading enabled, you must understand these characters' existence, relationships, and boundaries of action; only call role_play when a character needs to speak as themselves:`;
      characterCards.forEach((card, index) => {
        prompt += `\n\n[NPC character ${index + 1}: ${card.name}]\n${filterBlankMarkdownFields(card.content.trim())}`;
      });
    }
  } else if (characterCards.length > 0) {
    prompt += `\n\n## Active story characters (background NPCs)\nThe following are the active NPC character profiles participating in this adventure. When you play these characters, their tone, speech, mannerisms, and actions must stay highly consistent with their personas:`;
    characterCards.forEach((card, index) => {
      prompt += `\n\n[NPC character ${index + 1}: ${card.name}]\n${filterBlankMarkdownFields(card.content.trim())}`;
    });
  }

  const userFields = formatUserInfo(userInfo);
  if (userFields) {
    prompt += `\n\n## My (the user's) character profile\nThis is the profile of the adventure protagonist played by the user. Remember this profile and use it to determine how the NPCs treat and react to them:\n${userFields}`;
  }

  return prompt;
}

export function buildStoryModelMessages(messages: Message[]): StoryModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role === 'user') {
      return [{ id: message.id, role: 'user' as const, content: message.content }];
    }
    return buildAssistantHistoryMessages(message);
  });
}

export function getStoryAllowedTools(dynamicRoleLoadingEnabled: boolean): string[] {
  return dynamicRoleLoadingEnabled ? ['role_play'] : [];
}

export function getRolePlayCharacterName(argumentsText?: string): string {
  if (!argumentsText) return 'character';
  try {
    const parsed = JSON.parse(argumentsText);
    const value = parsed.characterName ?? parsed.character_name;
    return typeof value === 'string' && value.trim() ? value.trim() : 'character';
  } catch {
    return 'character';
  }
}

function formatUserInfo(userInfo: Record<string, unknown>): string {
  return Object.entries(userInfo)
    .map(([key, value]) => {
      if (!USER_INFO_LABELS[key]) return null;
      if (typeof value === 'string' && value.trim() !== '') {
        return `- **${USER_INFO_LABELS[key]}**: ${value.trim()}`;
      }
      if (Array.isArray(value) && value.length > 0) {
        return `- **${USER_INFO_LABELS[key]}**: ${value.join(', ')}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function buildAssistantHistoryMessages(message: Message): StoryModelMessage[] {
  const tools = message.tools ?? [];
  const toolsById = new Map(
    tools.flatMap((tool): Array<[string, AgentToolEntry]> => (
      tool.id ? [[tool.id, tool]] : []
    ))
  );
  const emittedToolIds = new Set<string>();
  const modelMessages: StoryModelMessage[] = [];
  const parts = message.content.split(/(\[\[TOOL:[^\]]+\]\])/);
  let assistantText = '';

  parts.forEach((part) => {
    const match = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
    if (!match) {
      assistantText += part;
      return;
    }

    const tool = toolsById.get(match[1]);
    if (!tool) return;

    modelMessages.push(buildAssistantToolCallMessage(assistantText, [tool], message.thinkingBlocks));
    modelMessages.push(buildToolResultMessage(tool));
    emittedToolIds.add(match[1]);
    assistantText = '';
  });

  const remainingTools = tools.filter((tool) => !tool.id || !emittedToolIds.has(tool.id));
  if (remainingTools.length > 0) {
    modelMessages.push(buildAssistantToolCallMessage(assistantText, remainingTools, message.thinkingBlocks));
    remainingTools.forEach((tool) => modelMessages.push(buildToolResultMessage(tool)));
    assistantText = '';
  }

  if (assistantText.trim()) {
    modelMessages.push({
      id: message.id,
      role: 'assistant',
      content: assistantText,
      thinkingBlocks: message.thinkingBlocks,
    });
  }

  return modelMessages;
}

function buildAssistantToolCallMessage(
  content: string,
  tools: AgentToolEntry[],
  thinkingBlocks?: ThinkingBlock[],
): StoryModelMessage {
  return {
    id: tools[0]?.id ? `assistant-tool-${tools[0].id}` : undefined,
    role: 'assistant',
    content,
    toolCalls: tools.map((tool, index) => ({
      id: tool.id || `tool-${index}`,
      name: tool.name,
      arguments: sanitizeToolArguments(tool.arguments || '{}'),
    })),
    thinkingBlocks,
  };
}

function buildToolResultMessage(tool: AgentToolEntry): StoryModelMessage {
  return {
    id: tool.id ? `tool-result-${tool.id}` : undefined,
    role: 'tool',
    content: tool.result,
    toolCallId: tool.id,
  };
}
