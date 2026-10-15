import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSyncStorage } from '../syncStorage';

export interface CustomField {
  id: string;
  moduleId: string;
  label: string;
  value: string;
}

export interface PartnerItemFields {
  // World book fields
  theme?: string;         // Theme
  era?: string;           // Era
  techLevel?: string;     // Technology level
  magicLevel?: string;    // Magic level
  geography?: string;     // Geography
  keyScenes?: string;     // Key scenes
  culturalFeatures?: string; // Cultural features
  history?: string;       // History
  conflict?: string;      // Core conflict

  // Character card fields
  // Basic info
  name?: string;          // Name
  age?: string;           // Age
  gender?: string;        // Gender
  race?: string;          // Race
  birthplace?: string;    // Birthplace
  occupation?: string;    // Occupation
  socialClass?: string;   // Social class
  
  // Identity tags
  identityTags?: string[]; // Identity tags
  
  // Appearance & presence
  heightBuild?: string;     // Height & build
  iconicFeatures?: string;  // Iconic features
  clothingStyle?: string;   // Clothing style
  overallVibe?: string;     // Overall vibe

  // Personality
  externalPersonality?: string; // Outer personality
  internalPersonality?: string; // Inner personality
  coreDesire?: string;          // Core desire
  fearWeakness?: string;        // Fears & weaknesses
  moralValues?: string;         // Moral values
  quirk?: string;               // Quirks

  // Skills & expertise
  skills?: string;
  
  // Backstory
  backgroundStory?: string;
  
  // Relationships
  relationships?: string;
  
  // Speaking style
  speakingStyle?: string;
  
  // Typical reactions
  typicalReactions?: string;

  // Character memory
  relationMemory?: string; // Relationship memory (kept for backward compatibility)
  userRelationType?: string; // Relationship type with user
  userInteractionModel?: string; // Interaction style with user
  userRelationBottomLine?: string; // Relationship boundaries with user
  keyEvents?: string;      // Key events

  // Custom fields
  customFields?: CustomField[];
}

export interface PartnerItem {
  id: string;
  name: string;
  type: 'world_book' | 'character_card';
  content: string;
  fields?: PartnerItemFields;
  worldBookId?: string | null;
}

export type PartnerImportExportType = 'world_book' | 'character_card';

export interface PartnerItemsPackage {
  schema: 'museai.partner-items';
  version: 1;
  exportedAt: string;
  worldBooks: Array<{
    id?: string;
    name: string;
    fields?: PartnerItemFields;
  }>;
  characterCards: Array<{
    id?: string;
    name: string;
    fields?: PartnerItemFields;
    worldBookId?: string | null;
  }>;
}

export interface PartnerImportResult {
  worldBookIds: string[];
  characterCardIds: string[];
  failedCount?: number;
}

interface PartnerState {
  worldBooks: PartnerItem[];
  characterCards: PartnerItem[];
  selectedId: string | null;
  selectedType: 'world_book' | 'character_card' | null;
  addWorldBook: () => void;
  addCharacterCard: () => void;
  selectItem: (id: string | null, type: 'world_book' | 'character_card' | null) => void;
  deleteItem: (id: string, type: 'world_book' | 'character_card') => void;
  deleteWorldBookWithCharacterCards: (id: string) => void;
  updateItemName: (id: string, type: 'world_book' | 'character_card', name: string) => void;
  updateItemContent: (id: string, type: 'world_book' | 'character_card', content: string) => void;
  updateItemFields: (id: string, type: 'world_book' | 'character_card', fields: PartnerItemFields) => void;
  updateCharacterCardWorldBook: (id: string, worldBookId: string | null) => void;
  addCustomField: (id: string, type: 'world_book' | 'character_card', moduleId: string) => void;
  updateCustomField: (id: string, type: 'world_book' | 'character_card', fieldId: string, updates: Partial<Pick<CustomField, 'label' | 'value'>>) => void;
  removeCustomField: (id: string, type: 'world_book' | 'character_card', fieldId: string) => void;
  importGeneratedItems: (items: {
    worldBooks: Array<{ name: string; fields: PartnerItemFields }>;
    characterCards: Array<{ name: string; fields: PartnerItemFields; worldBookId?: string | null }>;
  }) => { worldBookIds: string[]; characterCardIds: string[] };
  exportPartnerItems: (type: PartnerImportExportType) => PartnerItemsPackage;
  exportPartnerItem: (type: PartnerImportExportType, id: string) => PartnerItemsPackage;
  exportPartnerItemBundle: (type: PartnerImportExportType, id: string) => PartnerItemsPackage;
  importPartnerItemsPackage: (packageText: string, type: PartnerImportExportType) => PartnerImportResult;
  importPartnerItemsPackages: (packageTexts: string[], type: PartnerImportExportType) => PartnerImportResult;
}

const MODULE_NAMES: Record<string, string> = {
  world_basic: 'Basic World Settings',
  world_core: 'Core Worldview Framework',
  char_basic: 'Basics & Tags',
  char_appearance: 'Appearance & Personality',
  char_ability: 'Abilities & History',
  char_memory: 'Character Memory',
};

const fieldToText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const text = fieldToText(item);
        return text ? [text] : [];
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return '';
};

const normalizeCustomFields = (fields?: CustomField[]): CustomField[] | undefined => {
  if (!Array.isArray(fields)) return undefined;
  return fields.map((field) => ({
    id: fieldToText(field.id) || `cf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    moduleId: fieldToText(field.moduleId),
    label: fieldToText(field.label) || 'Custom field',
    value: fieldToText(field.value),
  }));
};

export const normalizePartnerFields = (fields?: PartnerItemFields): PartnerItemFields => {
  const source = (fields || {}) as Record<string, unknown>;
  const normalized: PartnerItemFields = {};
  const textFields = [
    'theme',
    'era',
    'techLevel',
    'magicLevel',
    'geography',
    'keyScenes',
    'culturalFeatures',
    'history',
    'conflict',
    'name',
    'age',
    'gender',
    'race',
    'birthplace',
    'occupation',
    'socialClass',
    'heightBuild',
    'iconicFeatures',
    'clothingStyle',
    'overallVibe',
    'externalPersonality',
    'internalPersonality',
    'coreDesire',
    'fearWeakness',
    'moralValues',
    'quirk',
    'skills',
    'backgroundStory',
    'relationships',
    'speakingStyle',
    'typicalReactions',
    'relationMemory',
    'userRelationType',
    'userInteractionModel',
    'userRelationBottomLine',
    'keyEvents',
  ] as const;

  textFields.forEach((key) => {
    const value = fieldToText(source[key]);
    if (value) {
      normalized[key] = value;
    }
  });

  const identityTags = source.identityTags;
  if (Array.isArray(identityTags)) {
    normalized.identityTags = identityTags.flatMap((tag) => {
      const text = fieldToText(tag);
      return text ? [text] : [];
    });
  } else {
    const tags = fieldToText(identityTags)
      .split(/[\n,，、；;]+/)
      .flatMap((tag) => {
        const trimmed = tag.trim();
        return trimmed ? [trimmed] : [];
      });
    if (tags.length > 0) {
      normalized.identityTags = tags;
    }
  }

  const customFields = normalizeCustomFields(source.customFields as CustomField[] | undefined);
  if (customFields) {
    normalized.customFields = customFields;
  }

  return normalized;
};

const formatFieldLine = (label: string, value?: string) => {
  const trimmed = (value || '').trim();
  return trimmed ? `- **${label}**: ${trimmed}` : '';
};

const buildListSection = (title: string, items: { label: string; value?: string }[]) => {
  const lines = items.flatMap((item) => {
    const line = formatFieldLine(item.label, item.value);
    return line ? [line] : [];
  });
  if (lines.length === 0) return '';
  return `## ${title}\n${lines.join('\n')}\n\n`;
};

const buildCustomFieldsSection = (title: string, fields: CustomField[]) => {
  const lines = fields.flatMap((field) => {
    const line = formatFieldLine(field.label, field.value);
    return line ? [line] : [];
  });
  if (lines.length === 0) return '';
  return `### ${title}\n${lines.join('\n')}\n\n`;
};

const compileCustomFields = (fields?: CustomField[]): string => {
  if (!fields || fields.length === 0) return '';

  const byModule: Record<string, CustomField[]> = {};
  fields.forEach(f => {
    if (!byModule[f.moduleId]) byModule[f.moduleId] = [];
    byModule[f.moduleId].push(f);
  });

  const sections = Object.entries(byModule).flatMap(([moduleId, moduleFields]) => {
    const section = buildCustomFieldsSection(MODULE_NAMES[moduleId] || moduleId, moduleFields);
    return section ? [section] : [];
  });

  if (sections.length === 0) return '';
  return `## Additional Custom Settings\n\n${sections.join('')}`;
};

export const compileItemToMarkdown = (name: string, type: 'world_book' | 'character_card', fields: PartnerItemFields): string => {
  fields = normalizePartnerFields(fields);
  if (type === 'world_book') {
    const core = buildListSection('Core Settings', [
      { label: 'Theme', value: fields.theme },
      { label: 'Era', value: fields.era },
      { label: 'Technology Level', value: fields.techLevel },
      { label: 'Magic Level', value: fields.magicLevel },
    ]);
    const geography = (fields.geography || '').trim() ? `## Geography\n${fields.geography}\n\n` : '';
    const keyScenes = (fields.keyScenes || '').trim() ? `## Key Scenes\n${fields.keyScenes}\n\n` : '';
    const cultural = (fields.culturalFeatures || '').trim() ? `## Cultural Features\n${fields.culturalFeatures}\n\n` : '';
    const history = (fields.history || '').trim() ? `## History\n${fields.history}\n\n` : '';
    const conflict = (fields.conflict || '').trim() ? `## Core Conflict\n${fields.conflict}\n\n` : '';
    const custom = compileCustomFields(fields.customFields);
    return `# ${name}\n\n${core}${geography}${keyScenes}${cultural}${history}${conflict}${custom}`.trim() + '\n';
  } else {
    const tagsStr = (fields.identityTags || []).map(t => `\`${t}\``).join(' ');
    const basic = buildListSection('Basic Info', [
      { label: 'Name', value: name },
      { label: 'Age', value: fields.age },
      { label: 'Gender', value: fields.gender },
      { label: 'Race', value: fields.race },
      { label: 'Birthplace', value: fields.birthplace },
      { label: 'Occupation', value: fields.occupation },
      { label: 'Social Class', value: fields.socialClass },
    ]);
    const identity = tagsStr ? `## Identity Tags\n${tagsStr}\n\n` : '';
    const appearance = buildListSection('Appearance & Presence', [
      { label: 'Height & Build', value: fields.heightBuild },
      { label: 'Iconic Features', value: fields.iconicFeatures },
      { label: 'Clothing Style', value: fields.clothingStyle },
      { label: 'Overall Vibe', value: fields.overallVibe },
    ]);
    const personality = buildListSection('Personality', [
      { label: 'Outer Personality', value: fields.externalPersonality },
      { label: 'Inner Personality', value: fields.internalPersonality },
      { label: 'Core Desire', value: fields.coreDesire },
      { label: 'Fears & Weaknesses', value: fields.fearWeakness },
      { label: 'Moral Values', value: fields.moralValues },
      { label: 'Quirks', value: fields.quirk },
    ]);
    const skills = (fields.skills || '').trim() ? `## Skills & Expertise\n${fields.skills}\n\n` : '';
    const background = (fields.backgroundStory || '').trim() ? `## Backstory\n${fields.backgroundStory}\n\n` : '';
    const relationships = (fields.relationships || '').trim() ? `## Relationships\n${fields.relationships}\n\n` : '';
    const speaking = (fields.speakingStyle || '').trim() ? `## Speaking Style\n${fields.speakingStyle}\n\n` : '';
    const reactions = (fields.typicalReactions || '').trim() ? `## Typical Reactions\n${fields.typicalReactions}\n\n` : '';
    const memory = buildListSection('Character Memory', [
      { label: 'Relationship Type with User', value: fields.userRelationType },
      { label: 'Interaction Style with User', value: fields.userInteractionModel },
      { label: 'Relationship Boundaries with User', value: fields.userRelationBottomLine },
    ]);
    const events = (fields.keyEvents || '').trim() ? `## Key Events\n${fields.keyEvents}\n\n` : '';
    const custom = compileCustomFields(fields.customFields);
    return `# Character Card: ${name}\n\n${basic}${identity}${appearance}${personality}${skills}${background}${relationships}${speaking}${reactions}${memory}${events}${custom}`.trim() + '\n';
  }
};

const PACKAGE_SCHEMA = 'museai.partner-items' as const;
const PACKAGE_VERSION = 1 as const;

const toPackageWorldBook = (item: PartnerItem): PartnerItemsPackage['worldBooks'][number] => ({
  id: item.id,
  name: item.name,
  fields: normalizePartnerFields(item.fields),
});

const toPackageCharacterCard = (item: PartnerItem): PartnerItemsPackage['characterCards'][number] => ({
  id: item.id,
  name: item.name,
  fields: normalizePartnerFields(item.fields),
  worldBookId: item.worldBookId ?? null,
});

const createPartnerItemsPackage = (
  worldBooks: PartnerItem[],
  characterCards: PartnerItem[],
  type: PartnerImportExportType,
): PartnerItemsPackage => ({
  schema: PACKAGE_SCHEMA,
  version: PACKAGE_VERSION,
  exportedAt: new Date().toISOString(),
  worldBooks: type === 'world_book' ? worldBooks.map(toPackageWorldBook) : [],
  characterCards: type === 'character_card' ? characterCards.map(toPackageCharacterCard) : [],
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readPackageItems = (value: unknown): PartnerItemsPackage => {
  if (!isRecord(value) || value.schema !== PACKAGE_SCHEMA || value.version !== PACKAGE_VERSION) {
    throw new Error('File is not a valid MuseAI world book / character card import format');
  }

  const worldBookInputs = Array.isArray(value.worldBooks) ? value.worldBooks : [];
  const characterCardInputs = Array.isArray(value.characterCards) ? value.characterCards : [];

  const worldBooks = worldBookInputs.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : undefined,
      name: fieldToText(item.name) || 'Untitled World Book',
      fields: normalizePartnerFields(item.fields as PartnerItemFields | undefined),
    }];
  });

  const characterCards = characterCardInputs.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      id: typeof item.id === 'string' ? item.id : undefined,
      name: fieldToText(item.name) || 'Untitled Character Card',
      fields: normalizePartnerFields(item.fields as PartnerItemFields | undefined),
      worldBookId: typeof item.worldBookId === 'string' ? item.worldBookId : null,
    }];
  });

  return {
    schema: PACKAGE_SCHEMA,
    version: PACKAGE_VERSION,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : new Date().toISOString(),
    worldBooks,
    characterCards,
  };
};

const parsePartnerItemsPackage = (packageText: string): PartnerItemsPackage => {
  try {
    return readPackageItems(JSON.parse(packageText));
  } catch (error) {
    if (error instanceof Error && error.message.includes('MuseAI')) {
      throw error;
    }
    throw new Error('File content is not valid JSON and cannot be imported');
  }
};

const initialWorldBooks: PartnerItem[] = [
  {
    id: 'wb-initial-1',
    name: 'Magic Continent Setting Compendium',
    type: 'world_book',
    content: '', // Will be compiled on load or defined below
    fields: {
      theme: 'Magic Adventure / Fantasy Epic',
      era: 'Age of the Magical Industrial Revolution',
      techLevel: 'Steam engines and early electrical technology',
      magicLevel: 'A high-magic world where aether is widely used',
      geography: 'The Oran Kingdom sits on the fertile eastern plains, while the Red Empire holds the rugged mountainous north; the two powers face off across the "Stasis Mountains" that span the continent.',
      keyScenes: 'The Grand Library of the Oran Academy of Magic; the Red Empire’s Aether Heavy Industries furnace works; the Stasis Mountains grand-canyon outpost',
      culturalFeatures: 'Aether worship: magic is seen as nature’s sacred gift. In the northern Red Empire, machinery and efficiency are revered, and magic is treated as a quantifiable secondary energy source.',
      history: 'The "Aether Storm War" thirty years ago left both nations devastated; they finally signed an armistice in the Stasis Mountains.',
      conflict: 'The irreconcilable conflict between dwindling aether resources plus the Red Empire’s growing territorial ambitions, and the conservative old magical aristocracy of the Oran Kingdom.',
    }
  }
];
initialWorldBooks[0].content = compileItemToMarkdown(initialWorldBooks[0].name, 'world_book', initialWorldBooks[0].fields!);

const initialCharacterCards: PartnerItem[] = [
  {
    id: 'cc-initial-1',
    name: 'Lin Yi (Protagonist)',
    type: 'character_card',
    worldBookId: 'wb-initial-1',
    content: '',
    fields: {
      age: '18 years old',
      gender: 'Male',
      race: 'Human',
      birthplace: 'A border town of the Oran Kingdom',
      occupation: 'Senior student at the Oran Academy of Magic',
      socialClass: 'Commoner-born, admitted on scholarship for exceptional talent',
      identityTags: ['Isekai traveler', 'Magic prodigy', 'Academy elite', 'Seeker of knowledge'],
      heightBuild: '178 cm, lean and well-proportioned, with the scholar’s build of someone who has spent years poring over books',
      iconicFeatures: 'A faint pale-blue aether circuit sigil on the back of his right hand, which glows softly when he is nervous',
      clothingStyle: 'Usually wears a faded-but-neat dark-blue academy robe, with a brown leather pouch for spellcasting materials at his waist',
      overallVibe: 'Gentle and composed in bearing, with a depth and calm in his eyes beyond his years, occasionally flashing with wariness',
      externalPersonality: 'Gentle and humble, eager to help — a model student in the teachers’ eyes and a reliable companion to classmates',
      internalPersonality: 'Calm and self-controlled, clear-eyed about costs and benefits, heavily guarded, and keenly observant of everything around him',
      coreDesire: 'To uncover the "first principles" underlying this world’s magic, and to find a safe way home',
      fearWeakness: 'Fears that his secret as a soul from another world will be seen through by the academy’s leaders or the temple, and that he will be purged as a heretic',
      moralValues: 'Respects life and never harms others unprovoked; but when his own safety is threatened, he defends and strikes back with decisive force, without hesitation',
      quirk: 'Unconsciously taps his temple with his index finger when thinking through a hard problem',
      skills: 'Proficient in high-tier wind magic (airflow manipulation, gale dash, wind blades); born with exceptionally strong spiritual perception that lets him directly see aether particles flowing',
      backgroundStory: 'A year ago he unexpectedly transmigrated into the body of a dying magic apprentice. Drawing on the original host’s memory fragments and his own scientific mindset, he quickly stood out at the academy — and is now entangled in the aether crisis deep within it.',
      relationships: 'Mentor: Professor Raven (trusted, yet guarded against); rival and friend: the young heiress Lu Xueying (bickering duo who admire each other); best buddy: chubby Tang Xiaoshan.',
      speakingStyle: 'Precise wording, even tone, rarely emotional. Likes to open with "Based on my observations…" or "Generally speaking…".',
      typicalReactions: 'In a crisis: pupils contract but no panic — he steps back half a pace, uses the surroundings to set up defenses, mind racing through odds and escape routes. When praised: a polite, modest smile, eyes calm and unreadable.',
    }
  }
];
initialCharacterCards[0].content = compileItemToMarkdown(initialCharacterCards[0].name, 'character_card', initialCharacterCards[0].fields!);

export const usePartnerStore = create<PartnerState>()(
  persist<PartnerState>(
    (set, get) => ({
      worldBooks: initialWorldBooks,
      characterCards: initialCharacterCards,
      selectedId: 'wb-initial-1',
      selectedType: 'world_book',

      addWorldBook: () => set((state) => {
        const newId = `wb-${Date.now()}`;
        const defaultFields: PartnerItemFields = {
          theme: '',
          era: '',
          techLevel: '',
          magicLevel: '',
          geography: '',
          keyScenes: '',
          culturalFeatures: '',
          history: '',
          conflict: ''
        };
        const name = 'Untitled World Book';
        const content = compileItemToMarkdown(name, 'world_book', defaultFields);
        const newItem: PartnerItem = {
          id: newId,
          name,
          type: 'world_book',
          content,
          fields: defaultFields
        };
        return {
          worldBooks: [...state.worldBooks, newItem],
          selectedId: newId,
          selectedType: 'world_book'
        };
      }),

      addCharacterCard: () => set((state) => {
        const newId = `cc-${Date.now()}`;
        const defaultFields: PartnerItemFields = {
          age: '',
          gender: '',
          race: '',
          birthplace: '',
          occupation: '',
          socialClass: '',
          identityTags: [],
          heightBuild: '',
          iconicFeatures: '',
          clothingStyle: '',
          overallVibe: '',
          externalPersonality: '',
          internalPersonality: '',
          coreDesire: '',
          fearWeakness: '',
          moralValues: '',
          quirk: '',
          skills: '',
          backgroundStory: '',
          relationships: '',
          speakingStyle: '',
          typicalReactions: '',
          relationMemory: '',
          userRelationType: '',
          userInteractionModel: '',
          userRelationBottomLine: '',
          keyEvents: ''
        };
        const name = 'Untitled Character Card';
        const content = compileItemToMarkdown(name, 'character_card', defaultFields);
        const newItem: PartnerItem = {
          id: newId,
          name,
          type: 'character_card',
          worldBookId: null,
          content,
          fields: defaultFields
        };
        return {
          characterCards: [...state.characterCards, newItem],
          selectedId: newId,
          selectedType: 'character_card'
        };
      }),

      selectItem: (selectedId, selectedType) => set({ selectedId, selectedType }),

      deleteItem: (id, type) => set((state) => {
        const isSelected = (
          (type === 'world_book' && state.selectedType === 'world_book' && state.selectedId === id) ||
          (type === 'character_card' && state.selectedType === 'character_card' && state.selectedId === id)
        );
        let newSelectedId = state.selectedId;
        let newSelectedType = state.selectedType;

        const nextWorldBooks = type === 'world_book'
          ? state.worldBooks.filter((item) => item.id !== id)
          : state.worldBooks;
        const nextCharacterCards = type === 'world_book'
          ? state.characterCards.map((item) => (
            item.worldBookId === id ? { ...item, worldBookId: null } : item
          ))
          : state.characterCards.filter((item) => item.id !== id);

        if (isSelected) {
          if (type === 'world_book' && nextWorldBooks.length > 0) {
            newSelectedId = nextWorldBooks[nextWorldBooks.length - 1].id;
            newSelectedType = 'world_book';
          } else if (type === 'character_card' && nextCharacterCards.length > 0) {
            newSelectedId = nextCharacterCards[nextCharacterCards.length - 1].id;
            newSelectedType = 'character_card';
          } else if (nextWorldBooks.length > 0) {
            newSelectedId = nextWorldBooks[nextWorldBooks.length - 1].id;
            newSelectedType = 'world_book';
          } else if (nextCharacterCards.length > 0) {
            newSelectedId = nextCharacterCards[nextCharacterCards.length - 1].id;
            newSelectedType = 'character_card';
          } else {
            newSelectedId = null;
            newSelectedType = null;
          }
        }

        return {
          worldBooks: nextWorldBooks,
          characterCards: nextCharacterCards,
          selectedId: newSelectedId,
          selectedType: newSelectedType,
        };
      }),

      deleteWorldBookWithCharacterCards: (id) => set((state) => {
        const removedCharacterIds = new Set(
          state.characterCards.flatMap((item) => (
            item.worldBookId === id ? [item.id] : []
          ))
        );
        const nextWorldBooks = state.worldBooks.filter((item) => item.id !== id);
        const nextCharacterCards = state.characterCards.filter((item) => item.worldBookId !== id);
        const isSelectedRemoved = (
          (state.selectedType === 'world_book' && state.selectedId === id) ||
          (state.selectedType === 'character_card' && state.selectedId != null && removedCharacterIds.has(state.selectedId))
        );

        let selectedId = state.selectedId;
        let selectedType = state.selectedType;
        if (isSelectedRemoved) {
          if (nextWorldBooks.length > 0) {
            selectedId = nextWorldBooks[nextWorldBooks.length - 1].id;
            selectedType = 'world_book';
          } else if (nextCharacterCards.length > 0) {
            selectedId = nextCharacterCards[nextCharacterCards.length - 1].id;
            selectedType = 'character_card';
          } else {
            selectedId = null;
            selectedType = null;
          }
        }

        return {
          worldBooks: nextWorldBooks,
          characterCards: nextCharacterCards,
          selectedId,
          selectedType,
        };
      }),

      updateItemName: (id, type, name) => set((state) => {
        if (type === 'world_book') {
          return {
            worldBooks: state.worldBooks.map((item) => {
              if (item.id === id) {
                const nextFields = item.fields || {};
                return {
                  ...item,
                  name,
                  content: compileItemToMarkdown(name, 'world_book', nextFields)
                };
              }
              return item;
            }),
          };
        } else {
          return {
            characterCards: state.characterCards.map((item) => {
              if (item.id === id) {
                const nextFields = item.fields || {};
                return {
                  ...item,
                  name,
                  content: compileItemToMarkdown(name, 'character_card', nextFields)
                };
              }
              return item;
            }),
          };
        }
      }),

      updateItemContent: (id, type, content) => set((state) => {
        if (type === 'world_book') {
          return {
            worldBooks: state.worldBooks.map((item) =>
              item.id === id ? { ...item, content } : item
            ),
          };
        } else {
          return {
            characterCards: state.characterCards.map((item) =>
              item.id === id ? { ...item, content } : item
            ),
          };
        }
      }),

      updateItemFields: (id, type, fields) => set((state) => {
        if (type === 'world_book') {
          return {
            worldBooks: state.worldBooks.map((item) => {
              if (item.id === id) {
                const nextFields = normalizePartnerFields({ ...(item.fields || {}), ...fields });
                return {
                  ...item,
                  fields: nextFields,
                  content: compileItemToMarkdown(item.name, 'world_book', nextFields)
                };
              }
              return item;
            }),
          };
        } else {
          return {
            characterCards: state.characterCards.map((item) => {
              if (item.id === id) {
                const nextFields = normalizePartnerFields({ ...(item.fields || {}), ...fields });
                return {
                  ...item,
                  fields: nextFields,
                  content: compileItemToMarkdown(item.name, 'character_card', nextFields)
                };
              }
              return item;
            }),
          };
        }
      }),

      updateCharacterCardWorldBook: (id, worldBookId) => set((state) => {
        const nextWorldBookId = worldBookId && state.worldBooks.some((item) => item.id === worldBookId)
          ? worldBookId
          : null;
        return {
          characterCards: state.characterCards.map((item) => (
            item.id === id ? { ...item, worldBookId: nextWorldBookId } : item
          )),
        };
      }),

      addCustomField: (id, type, moduleId) => set((state) => {
        const newField: CustomField = {
          id: `cf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          moduleId,
          label: 'Custom field',
          value: ''
        };
        const updateItems = (items: PartnerItem[]) => items.map((item) => {
          if (item.id !== id) return item;
          const nextFields = {
            ...(item.fields || {}),
            customFields: [...(item.fields?.customFields || []), newField]
          };
          return {
            ...item,
            fields: nextFields,
            content: compileItemToMarkdown(item.name, item.type, nextFields)
          };
        });
        if (type === 'world_book') {
          return { worldBooks: updateItems(state.worldBooks) };
        }
        return { characterCards: updateItems(state.characterCards) };
      }),

      updateCustomField: (id, type, fieldId, updates) => set((state) => {
        const updateItems = (items: PartnerItem[]) => items.map((item) => {
          if (item.id !== id) return item;
          const nextCustomFields = (item.fields?.customFields || []).map((f) =>
            f.id === fieldId ? { ...f, ...updates } : f
          );
          const nextFields = {
            ...(item.fields || {}),
            customFields: nextCustomFields
          };
          return {
            ...item,
            fields: nextFields,
            content: compileItemToMarkdown(item.name, item.type, nextFields)
          };
        });
        if (type === 'world_book') {
          return { worldBooks: updateItems(state.worldBooks) };
        }
        return { characterCards: updateItems(state.characterCards) };
      }),

      removeCustomField: (id, type, fieldId) => set((state) => {
        const updateItems = (items: PartnerItem[]) => items.map((item) => {
          if (item.id !== id) return item;
          const nextCustomFields = (item.fields?.customFields || []).filter((f) => f.id !== fieldId);
          const nextFields = {
            ...(item.fields || {}),
            customFields: nextCustomFields
          };
          return {
            ...item,
            fields: nextFields,
            content: compileItemToMarkdown(item.name, item.type, nextFields)
          };
        });
        if (type === 'world_book') {
          return { worldBooks: updateItems(state.worldBooks) };
        }
        return { characterCards: updateItems(state.characterCards) };
      }),

      importGeneratedItems: (items) => {
        const time = Date.now();
        const worldBookInputs = items.worldBooks || [];
        const characterCardInputs = items.characterCards || [];
        const worldBookIds = worldBookInputs.map((_, index) => `wb-ai-${time}-${index}`);
        const characterCardIds = characterCardInputs.map((_, index) => `cc-ai-${time}-${index}`);

        set((state) => {
        const newWorldBooks: PartnerItem[] = worldBookInputs.map((wb, index) => {
          const id = worldBookIds[index];
          const fields = normalizePartnerFields(wb.fields);
          return {
            id,
            name: wb.name || 'Untitled World Book',
            type: 'world_book',
            content: compileItemToMarkdown(wb.name || 'Untitled World Book', 'world_book', fields),
            fields
          };
        });

        const validWorldBookIds = new Set([...state.worldBooks, ...newWorldBooks].map((item) => item.id));
        const newCharacterCards: PartnerItem[] = characterCardInputs.map((cc, index) => {
          const id = characterCardIds[index];
          const fields = normalizePartnerFields(cc.fields);
          const worldBookId = cc.worldBookId && validWorldBookIds.has(cc.worldBookId) ? cc.worldBookId : null;
          return {
            id,
            name: cc.name || 'Untitled Character Card',
            type: 'character_card',
            worldBookId,
            content: compileItemToMarkdown(cc.name || 'Untitled Character Card', 'character_card', fields),
            fields
          };
        });

        const nextWorldBooks = [...state.worldBooks, ...newWorldBooks];
        const nextCharacterCards = [...state.characterCards, ...newCharacterCards];

        let selectedId = state.selectedId;
        let selectedType = state.selectedType;

        if (newWorldBooks.length > 0) {
          selectedId = newWorldBooks[0].id;
          selectedType = 'world_book';
        } else if (newCharacterCards.length > 0) {
          selectedId = newCharacterCards[0].id;
          selectedType = 'character_card';
        }

        return {
          worldBooks: nextWorldBooks,
          characterCards: nextCharacterCards,
          selectedId,
          selectedType
        };
        });

        return { worldBookIds, characterCardIds };
      },

      exportPartnerItems: (type: PartnerImportExportType) => {
        const state = get();
        return createPartnerItemsPackage(state.worldBooks, state.characterCards, type);
      },

      exportPartnerItem: (type: PartnerImportExportType, id: string) => {
        const state = get();
        const worldBooks = type === 'world_book'
          ? state.worldBooks.filter((item) => item.id === id)
          : [];
        const characterCards = type === 'character_card'
          ? state.characterCards.filter((item) => item.id === id)
          : [];
        return createPartnerItemsPackage(worldBooks, characterCards, type);
      },

      exportPartnerItemBundle: (type: PartnerImportExportType, id: string) => {
        const state = get();
        if (type === 'world_book') {
          const worldBooks = state.worldBooks.filter((item) => item.id === id);
          const characterCards = state.characterCards.filter((item) => item.worldBookId === id);
          const basePackage = createPartnerItemsPackage(worldBooks, [], 'world_book');
          return {
            ...basePackage,
            characterCards: characterCards.map(toPackageCharacterCard),
          };
        }
        const characterCards = state.characterCards.filter((item) => item.id === id);
        return createPartnerItemsPackage([], characterCards, 'character_card');
      },

      importPartnerItemsPackage: (packageText: string, type: PartnerImportExportType) => {
        const parsed = parsePartnerItemsPackage(packageText);
        if (type === 'world_book' && parsed.worldBooks.length === 0) {
          throw new Error('The import file contains no importable world books');
        }
        if (type === 'character_card' && parsed.characterCards.length === 0) {
          throw new Error('The import file contains no importable character cards');
        }

        const time = Date.now();
        const importedWorldBooks = type === 'world_book'
          ? parsed.worldBooks
          : parsed.worldBooks.filter((worldBook) =>
              parsed.characterCards.some((card) => card.worldBookId && card.worldBookId === worldBook.id)
            );
        const importedWorldBookSourceIds = new Set(importedWorldBooks.flatMap((worldBook) => (
          worldBook.id ? [worldBook.id] : []
        )));
        const importedCharacterCards = type === 'character_card'
          ? parsed.characterCards
          : parsed.characterCards.filter((card) => card.worldBookId && importedWorldBookSourceIds.has(card.worldBookId));
        const worldBookIds = importedWorldBooks.map((_, index) => `wb-import-${time}-${index}`);
        const characterCardIds = importedCharacterCards.map((_, index) => `cc-import-${time}-${index}`);

        set((state) => {
          const sourceToLocalWorldBookId = new Map<string, string>();
          const newWorldBooks: PartnerItem[] = importedWorldBooks.map((worldBook, index) => {
            const id = worldBookIds[index];
            if (worldBook.id) {
              sourceToLocalWorldBookId.set(worldBook.id, id);
            }
            const fields = normalizePartnerFields(worldBook.fields);
            return {
              id,
              name: worldBook.name || 'Untitled World Book',
              type: 'world_book',
              content: compileItemToMarkdown(worldBook.name || 'Untitled World Book', 'world_book', fields),
              fields,
            };
          });

          const validWorldBookIds = new Set([...state.worldBooks, ...newWorldBooks].map((item) => item.id));
          const newCharacterCards: PartnerItem[] = importedCharacterCards.map((card, index) => {
            const id = characterCardIds[index];
            const fields = normalizePartnerFields(card.fields);
            const mappedWorldBookId = card.worldBookId ? sourceToLocalWorldBookId.get(card.worldBookId) : null;
            const candidateWorldBookId = mappedWorldBookId ?? card.worldBookId ?? null;
            const worldBookId = candidateWorldBookId && validWorldBookIds.has(candidateWorldBookId)
              ? candidateWorldBookId
              : null;
            return {
              id,
              name: card.name || 'Untitled Character Card',
              type: 'character_card',
              worldBookId,
              content: compileItemToMarkdown(card.name || 'Untitled Character Card', 'character_card', fields),
              fields,
            };
          });

          return {
            worldBooks: [...state.worldBooks, ...newWorldBooks],
            characterCards: [...state.characterCards, ...newCharacterCards],
            selectedId: newWorldBooks[0]?.id ?? newCharacterCards[0]?.id ?? state.selectedId,
            selectedType: newWorldBooks.length > 0 ? 'world_book' : newCharacterCards.length > 0 ? 'character_card' : state.selectedType,
          };
        });

        return { worldBookIds, characterCardIds };
      },

      importPartnerItemsPackages: (packageTexts: string[], type: PartnerImportExportType) => {
        const packages: PartnerItemsPackage[] = [];
        let failedCount = 0;
        packageTexts.forEach((text) => {
          try {
            packages.push(parsePartnerItemsPackage(text));
          } catch {
            failedCount += 1;
          }
        });

        const combined: PartnerItemsPackage = {
          schema: PACKAGE_SCHEMA,
          version: PACKAGE_VERSION,
          exportedAt: new Date().toISOString(),
          worldBooks: packages.flatMap((item) => item.worldBooks),
          characterCards: packages.flatMap((item) => item.characterCards),
        };

        const result = get().importPartnerItemsPackage(JSON.stringify(combined), type);
        return { ...result, failedCount };
      },
    }),
    {
      name: 'museai-partner-storage',
      storage: createJSONStorage(() => createSyncStorage('partners', 'museai-partner-storage')),
    }
  )
);
