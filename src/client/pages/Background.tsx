import React, { useEffect, useRef, useMemo } from 'react';
import { Button, Input, Tooltip, Empty, Card, Tabs, Tag, Row, Col, Space, Radio, Modal, message, Tree, Select } from 'antd';
import type { InputRef } from 'antd';
import { 
  GlobalOutlined, 
  UserOutlined, 
  PlusOutlined, 
  DeleteOutlined, 
  EditOutlined,
  CompassOutlined,
  EyeOutlined,
  EditFilled,
  ThunderboltOutlined,
  BookOutlined,
  FileProtectOutlined,
  LoadingOutlined,
  DownloadOutlined,
  UploadOutlined
} from '@ant-design/icons';
import { usePartnerStore, PartnerItem, PartnerItemFields, CustomField, PartnerImportExportType, PartnerItemsPackage, normalizePartnerFields } from '../stores/usePartnerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { groupCharacterCardsByWorldBook } from '../utils/characterCardGroups';
import { useStateGroup } from '../utils/reducerState';
import { SillyTavernExportPreviewModal } from '../components/SillyTavernExportPreviewModal';
import { StylePresetManager } from '../components/StylePresetManager';
import { StylePresetEditor } from '../components/StylePresetEditor';
import { useStylePresetStore } from '../stores/useStylePresetStore';
import { complete } from '../api';

const DIRECTORY_WIDTH = 280;

/** System prompt for memory condensation (equivalent to the original Rust built-in prompt). */
const MEMORY_OPTIMIZER_SYSTEM_PROMPT =
  'You are a character memory curator. Based on the character card\u2019s key events, condense and refine them into a sharper, more expressive key-event list \u2014 one event per line. Output only the curated event text.';

/** "Unassigned" character-card group id (same value as the constant in utils/characterCardGroups; form-only on this page). */
const UNASSIGNED_CHARACTER_CARD_GROUP_ID = '__unassigned_character_cards__';

interface BackgroundUiState {
  isMemModalOpen: boolean;
  optimizedEvents: string;
  isOptimizing: boolean;
  pendingWorldBookDelete: PartnerItem | null;
  editingId: string | null;
  editName: string;
  activeMode: 'edit' | 'preview';
  tagInputVisible: boolean;
  tagInputValue: string;
  expandedCharacterGroupKeys: React.Key[];
  exportFormatModalItem: PartnerItem | null;
  sillyTavernPreviewOpen: boolean;
  sillyTavernPreviewJson: string | null;
  sillyTavernConverting: boolean;
  sillyTavernConvertError: string | null;
  sillyTavernExportItem: PartnerItem | null;
}

const partnerTypeLabel = (type: PartnerImportExportType) => type === 'world_book' ? 'World Book' : 'Character Card';

const partnerPackageText = (data: PartnerItemsPackage) => JSON.stringify(data, null, 2);

/** Browser-side Blob download of a single JSON file (equivalent to the original export_json_files_to_downloads). */
const downloadPartnerItemFile = (relativePath: string, content: string): void => {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = relativePath.split(/[\\/]/).pop() || relativePath;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** Extract the outermost JSON fragment from raw model output (equivalent to the original Rust clean_json_response). */
const extractJsonText = (text: string): string => {
  const trimmed = text.trim();
  const openers = ['{', '['].map((ch) => trimmed.indexOf(ch)).filter((index) => index >= 0);
  const closers = ['}', ']'].map((ch) => trimmed.lastIndexOf(ch)).filter((index) => index >= 0);
  if (openers.length === 0 || closers.length === 0) {
    return trimmed;
  }
  const start = Math.min(...openers);
  const end = Math.max(...closers);
  return start < end ? trimmed.slice(start, end + 1) : trimmed;
};

/** Build the user message for the SillyTavern conversion (equivalent to the original Rust build_silly_tavern_user_prompt). */
const buildSillyTavernUserPrompt = (
  sourceCharacterCard: { name: string; fields: PartnerItemFields; content: string },
  worldBookEntries?: { name: string; fields: PartnerItemFields; content: string },
): string => {
  const cardJson = JSON.stringify(sourceCharacterCard, null, 2);
  const worldBookSection = worldBookEntries
    ? `\n\n### Associated World Book Entries\n${JSON.stringify(worldBookEntries, null, 2)}\n`
    : '';
  return `Convert the following MuseAI character card into a SillyTavern Character Card V2 JSON. Preserve the source facts, organize them into coherent, usable English character instructions, and map them to V2 fields per the rules.\n\n### Source Character Card JSON\n${cardJson}${worldBookSection}Output pure JSON conforming to the V2 spec only; the top level and the data field must mirror each other exactly.`;
};

interface CustomFieldsBlockProps {
  item: PartnerItem;
  moduleId: string;
  addCustomField: (id: string, type: 'world_book' | 'character_card', moduleId: string) => void;
  updateCustomField: (
    id: string,
    type: 'world_book' | 'character_card',
    fieldId: string,
    updates: Partial<Pick<CustomField, 'label' | 'value'>>,
  ) => void;
  removeCustomField: (id: string, type: 'world_book' | 'character_card', fieldId: string) => void;
}

const CustomFieldsBlock: React.FC<CustomFieldsBlockProps> = ({
  item,
  moduleId,
  addCustomField,
  updateCustomField,
  removeCustomField,
}) => {
  const fields = item.fields?.customFields?.filter((field: CustomField) => field.moduleId === moduleId) || [];

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed rgba(0,0,0,0.06)' }}>
      <Row gutter={[16, 16]}>
        {fields.map((field: CustomField) => (
          <Col span={8} key={field.id}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Input
                  value={field.label}
                  placeholder="Field name"
                  onChange={(event) => updateCustomField(item.id, item.type, field.id, { label: event.target.value })}
                  style={{ flex: 1, fontSize: 12, fontWeight: 500 }}
                  className="custom-form-input"
                />
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                    onClick={() => removeCustomField(item.id, item.type, field.id)}
                    style={{ width: 22, height: 22, padding: 0 }}
                  />
                </Tooltip>
              </div>
              <Input
                value={field.value}
                placeholder={`Enter ${field.label || 'content'}`}
                onChange={(event) => updateCustomField(item.id, item.type, field.id, { value: event.target.value })}
                className="custom-form-input"
              />
            </div>
          </Col>
        ))}
      </Row>
      <Button
        type="dashed"
        size="small"
        icon={<PlusOutlined />}
        onClick={() => addCustomField(item.id, item.type, moduleId)}
        style={{ marginTop: 16, height: 28, fontSize: 12, color: '#8c8882', borderColor: 'rgba(0,0,0,0.1)' }}
      >
        Add Custom Field
      </Button>
    </div>
  );
};

const useBackgroundView = () => {
  const { 
    worldBooks, 
    characterCards, 
    selectedId, 
    selectedType,
    addWorldBook,
    addCharacterCard,
    selectItem,
    deleteItem,
    deleteWorldBookWithCharacterCards,
    updateItemName,
    updateItemFields,
    updateCharacterCardWorldBook,
    addCustomField,
    updateCustomField,
    removeCustomField,
    exportPartnerItemBundle,
    importPartnerItemsPackages
  } = usePartnerStore();

  const settings = useSettingsStore();
  const stylePresetStore = useStylePresetStore();
  const selectedStylePreset = stylePresetStore.presets.find((preset) => preset.id === stylePresetStore.selectedPresetId) || null;

  const [uiState, , setUiField] = useStateGroup<BackgroundUiState>({
    isMemModalOpen: false,
    optimizedEvents: '',
    isOptimizing: false,
    pendingWorldBookDelete: null,
    editingId: null,
    editName: '',
    activeMode: 'edit',
    tagInputVisible: false,
    tagInputValue: '',
    expandedCharacterGroupKeys: [],
    exportFormatModalItem: null,
    sillyTavernPreviewOpen: false,
    sillyTavernPreviewJson: null,
    sillyTavernConverting: false,
    sillyTavernConvertError: null,
    sillyTavernExportItem: null,
  });
  const {
    isMemModalOpen,
    optimizedEvents,
    isOptimizing,
    pendingWorldBookDelete,
    editingId,
    editName,
    activeMode,
    tagInputVisible,
    tagInputValue,
    expandedCharacterGroupKeys,
    exportFormatModalItem,
    sillyTavernPreviewOpen,
    sillyTavernPreviewJson,
    sillyTavernConverting,
    sillyTavernConvertError,
    sillyTavernExportItem,
  } = uiState;
  const setIsMemModalOpen = (isMemModalOpen: boolean) => setUiField('isMemModalOpen', isMemModalOpen);
  const setOptimizedEvents = (optimizedEvents: string) => setUiField('optimizedEvents', optimizedEvents);
  const setIsOptimizing = (isOptimizing: boolean) => setUiField('isOptimizing', isOptimizing);
  const setPendingWorldBookDelete = (pendingWorldBookDelete: PartnerItem | null) => setUiField('pendingWorldBookDelete', pendingWorldBookDelete);
  const setEditingId = (editingId: string | null) => setUiField('editingId', editingId);
  const setEditName = (editName: string) => setUiField('editName', editName);
  const setActiveMode = (activeMode: BackgroundUiState['activeMode']) => setUiField('activeMode', activeMode);
  const setTagInputVisible = (tagInputVisible: boolean) => setUiField('tagInputVisible', tagInputVisible);
  const setTagInputValue = (tagInputValue: string) => setUiField('tagInputValue', tagInputValue);
  const setExpandedCharacterGroupKeys = (expandedCharacterGroupKeys: React.SetStateAction<React.Key[]>) => setUiField('expandedCharacterGroupKeys', expandedCharacterGroupKeys);

  const handleOptimizeMemories = async (currentEvents: string) => {
    if (!currentEvents.trim()) {
      message.warning('Key event memory is empty \u2014 nothing to condense or resolve.');
      return;
    }

    setIsOptimizing(true);
    try {
      const result = await complete({
        agentId: 'backgroundWorldBook',
        system: MEMORY_OPTIMIZER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: currentEvents }],
        temperature: 0,
        maxTokens: 4096,
      });

      setOptimizedEvents(result.text);
      setIsMemModalOpen(true);
    } catch (err) {
      console.error('Memory optimization failed:', err);
      message.error(`Memory condensation failed: ${String(err)}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleConfirmOptimize = () => {
    if (selectedItem) {
      updateItemFields(selectedItem.id, selectedItem.type, { keyEvents: optimizedEvents });
      message.success('Key event memory updated!');
      setIsMemModalOpen(false);
    }
  };

  const tagInputRef = useRef<InputRef>(null);
  const renameInputRef = useRef<InputRef>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImportTypeRef = useRef<PartnerImportExportType>('world_book');
  const knownCharacterGroupKeysRef = useRef<string[]>([]);
  const hasInitializedCharacterGroupsRef = useRef(false);

  // Focus rename input when editing starts
  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingId]);

  // Focus tag input when visible
  useEffect(() => {
    if (tagInputVisible && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [tagInputVisible]);

  const handleStartRename = (item: PartnerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditName(item.name);
  };

  const handleSaveRename = (item: PartnerItem) => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.name) {
      updateItemName(item.id, item.type, trimmed);
    }
    setEditingId(null);
  };

  const handleDeleteItem = (id: string, type: 'world_book' | 'character_card', e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === 'world_book') {
      const item = worldBooks.find((worldBook) => worldBook.id === id);
      if (item) {
        setPendingWorldBookDelete(item);
      }
      return;
    }
    deleteItem(id, type);
  };

  const handleDeleteWorldBookOnly = () => {
    if (!pendingWorldBookDelete) return;
    deleteItem(pendingWorldBookDelete.id, 'world_book');
    setPendingWorldBookDelete(null);
  };

  const handleDeleteWorldBookWithCards = () => {
    if (!pendingWorldBookDelete) return;
    deleteWorldBookWithCharacterCards(pendingWorldBookDelete.id);
    setPendingWorldBookDelete(null);
  };

  const exportFilesForItem = (item: PartnerItem) => {
    const data = exportPartnerItemBundle(item.type, item.id);
    if (item.type === 'world_book') {
      const worldBookPackage = {
        ...data,
        characterCards: [],
      };
      const characterFiles = data.characterCards.map((card) => ({
        relativePath: `Character Cards/${card.name || 'Unnamed Character Card'}.json`,
        content: partnerPackageText({
          ...data,
          worldBooks: [],
          characterCards: [card],
        }),
      }));
      return {
        directoryName: item.name || 'Unnamed World Book',
        files: [
          {
            relativePath: 'World Book and Character Cards.json',
            content: partnerPackageText(data),
          },
          {
            relativePath: 'World Book.json',
            content: partnerPackageText(worldBookPackage),
          },
          ...characterFiles,
        ],
      };
    }

    return {
      directoryName: null,
      files: [
        {
          relativePath: `museai-character-card-${item.name || 'unnamed-character-card'}.json`,
          content: partnerPackageText(data),
        },
      ],
    };
  };

  const handleExportPartnerItem = (item: PartnerItem) => {
    try {
      const payload = exportFilesForItem(item);
      payload.files.forEach((file) => downloadPartnerItemFile(file.relativePath, file.content));
      const targetText = item.type === 'world_book'
        ? `Downloaded ${payload.files.length} files (browser download)`
        : `Downloaded: ${payload.files[0]?.relativePath || ''}`;
      message.success(`${partnerTypeLabel(item.type)} exported, ${targetText}`);
    } catch (err) {
      message.error(`${partnerTypeLabel(item.type)} export failed: ${String(err)}`);
    }
  };

  const handleChooseMuseAiFormat = () => {
    const item = exportFormatModalItem;
    setUiField('exportFormatModalItem', null);
    if (item) {
      handleExportPartnerItem(item);
    }
  };

  const handleStartSillyTavernConvert = async (item: PartnerItem) => {
    setUiField('exportFormatModalItem', null);
    setUiField('sillyTavernExportItem', item);
    setUiField('sillyTavernPreviewOpen', true);
    setUiField('sillyTavernConverting', true);
    setUiField('sillyTavernConvertError', null);
    setUiField('sillyTavernPreviewJson', null);

    const sourceCharacterCard = {
      name: item.name,
      fields: normalizePartnerFields(item.fields),
      content: item.content,
    };
    const worldBook = item.worldBookId
      ? worldBooks.find((wb) => wb.id === item.worldBookId)
      : null;
    const worldBookEntries = worldBook
      ? { name: worldBook.name, fields: normalizePartnerFields(worldBook.fields), content: worldBook.content }
      : undefined;

    const agentConfig = settings.agentConfigs?.sillyTavernExporter || {};

    try {
      const result = await complete({
        agentId: 'sillyTavernExporter',
        system: settings.sillyTavernExporterPrompt,
        messages: [{ role: 'user', content: buildSillyTavernUserPrompt(sourceCharacterCard, worldBookEntries) }],
        temperature: agentConfig.temperature ?? 0,
        maxTokens: agentConfig.maxOutputTokens ?? 32000,
        thinkingDepth: agentConfig.thinkingDepth ?? 'high',
      });
      const cleaned = extractJsonText(result.text);
      try {
        JSON.parse(cleaned);
      } catch (parseError) {
        throw new Error(`The model did not return valid JSON, please retry: ${String(parseError)}`);
      }
      setUiField('sillyTavernPreviewJson', cleaned);
    } catch (err) {
      setUiField('sillyTavernConvertError', String(err));
    } finally {
      setUiField('sillyTavernConverting', false);
    }
  };

  const handleRetrySillyTavernConvert = () => {
    const item = sillyTavernExportItem;
    if (item) {
      handleStartSillyTavernConvert(item);
    }
  };

  const handleConfirmSillyTavernExport = () => {
    const item = sillyTavernExportItem;
    const cardJson = sillyTavernPreviewJson;
    if (!item || !cardJson) return;

    try {
      const fileName = `sillytavern-character-card-${item.name || 'unnamed-character-card'}.json`;
      downloadPartnerItemFile(fileName, cardJson);
      message.success('SillyTavern character card exported, download started');
      setUiField('sillyTavernPreviewOpen', false);
      setUiField('sillyTavernPreviewJson', null);
      setUiField('sillyTavernExportItem', null);
      setUiField('sillyTavernConvertError', null);
    } catch (err) {
      message.error(`SillyTavern character card export failed: ${String(err)}`);
    }
  };

  const handleCancelSillyTavernPreview = () => {
    setUiField('sillyTavernPreviewOpen', false);
    setUiField('sillyTavernPreviewJson', null);
    setUiField('sillyTavernConvertError', null);
    setUiField('sillyTavernExportItem', null);
  };

  const handleRequestImportPartnerItems = (type: PartnerImportExportType) => {
    pendingImportTypeRef.current = type;
    if (importInputRef.current) {
      importInputRef.current.value = '';
      importInputRef.current.click();
    }
  };

  const handleImportPartnerItemsFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const type = pendingImportTypeRef.current;
    try {
      const texts = await Promise.all(files.map((file) => file.text()));
      const result = importPartnerItemsPackages(texts, type);
      const worldBookCount = result.worldBookIds.length;
      const characterCardCount = result.characterCardIds.length;
      const failedCount = result.failedCount || 0;
      if (worldBookCount === 0 && characterCardCount === 0) {
        throw new Error('No importable content found in the selected files');
      }
      const countText = type === 'world_book'
        ? `Added ${worldBookCount} world book${worldBookCount === 1 ? '' : 's'}${characterCardCount > 0 ? `, ${characterCardCount} character card${characterCardCount === 1 ? '' : 's'}` : ''}`
        : `Added ${characterCardCount} character card${characterCardCount === 1 ? '' : 's'}${worldBookCount > 0 ? `, ${worldBookCount} world book${worldBookCount === 1 ? '' : 's'}` : ''}`;
      const failText = failedCount > 0 ? `, ${failedCount} file${failedCount === 1 ? '' : 's'} failed to import` : '';
      message.success(`${partnerTypeLabel(type)} import complete: ${countText}${failText}`);
    } catch (err) {
      message.error(`${partnerTypeLabel(type)} import failed: ${String(err)}`);
    } finally {
      event.target.value = '';
    }
  };

  // Find currently selected item
  const selectedItem = selectedType === 'world_book' 
    ? worldBooks.find(b => b.id === selectedId) 
    : characterCards.find(c => c.id === selectedId);
  const characterCardGroups = useMemo(
    () => groupCharacterCardsByWorldBook(worldBooks, characterCards),
    [worldBooks, characterCards],
  );
  const characterCardGroupKeys = useMemo(
    () => characterCardGroups.map((group) => group.key),
    [characterCardGroups],
  );

  useEffect(() => {
    const previousGroupKeys = knownCharacterGroupKeysRef.current;
    knownCharacterGroupKeysRef.current = characterCardGroupKeys;
    const characterCardGroupKeySet = new Set(characterCardGroupKeys);
    const previousGroupKeySet = new Set(previousGroupKeys);

    setUiField('expandedCharacterGroupKeys', (previousKeys) => {
      if (!hasInitializedCharacterGroupsRef.current) {
        hasInitializedCharacterGroupsRef.current = true;
        return characterCardGroupKeys;
      }

      const validKeys = previousKeys.filter((key) => characterCardGroupKeySet.has(String(key)));
      const newKeys = characterCardGroupKeys.filter((key) => !previousGroupKeySet.has(key));
      return [...validKeys, ...newKeys];
    });
  }, [characterCardGroupKeys, setUiField]);

  // Sync editName when item name changes or new item is selected
  const handleFieldChange = (key: keyof PartnerItemFields, value: string | string[] | CustomField[] | undefined) => {
    if (selectedItem) {
      updateItemFields(selectedItem.id, selectedItem.type, { [key]: value });
    }
  };

  // Tag manipulation for Character Card
  const handleRemoveTag = (removedTag: string) => {
    if (selectedItem) {
      const currentTags = selectedItem.fields?.identityTags || [];
      const nextTags = currentTags.filter(tag => tag !== removedTag);
      handleFieldChange('identityTags', nextTags);
    }
  };

  const handleAddTagConfirm = () => {
    if (selectedItem && tagInputValue.trim()) {
      const currentTags = selectedItem.fields?.identityTags || [];
      if (!currentTags.includes(tagInputValue.trim())) {
        const nextTags = [...currentTags, tagInputValue.trim()];
        handleFieldChange('identityTags', nextTags);
      }
    }
    setTagInputVisible(false);
    setTagInputValue('');
  };

  const showTagInput = () => {
    setTagInputVisible(true);
  };

  const renderDirectoryItem = (item: PartnerItem) => {
    const isSelected = selectedId === item.id;
    const isEditing = editingId === item.id;

    return (
      <div
        key={item.id}
        role="treeitem"
        aria-selected={isSelected}
        tabIndex={0}
        onClick={() => {
          stylePresetStore.selectPreset(null);
          selectItem(item.id, item.type);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            stylePresetStore.selectPreset(null);
            selectItem(item.id, item.type);
          }
        }}
        onDoubleClick={(e) => handleStartRename(item, e)}
        className={`directory-item-hover background-directory-item ${isSelected ? 'is-selected' : ''}`}
      >
        <div className="background-directory-item__body">
          {item.type === 'world_book' ? (
            <GlobalOutlined style={{ fontSize: 15, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          ) : (
            <UserOutlined style={{ fontSize: 15, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          )}

          {isEditing ? (
            <Input
              ref={renameInputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleSaveRename(item)}
              onPressEnter={() => handleSaveRename(item)}
              size="small"
              style={{
                height: 22,
                padding: '0 4px',
                fontSize: 13,
                borderColor: '#d97757',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="background-directory-item__name">
              {item.name}
            </span>
          )}
        </div>

        {!isEditing && (
          <div className="directory-item-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip title="Rename" mouseEnterDelay={0.8}>
              <Button 
                type="text" 
                size="small" 
                icon={<EditOutlined style={{ fontSize: 12 }} />} 
                onClick={(e) => handleStartRename(item, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
            <Tooltip title="Delete" mouseEnterDelay={0.8}>
              <Button 
                aria-label={`${item.type === 'world_book' ? 'Delete world book' : 'Delete character card'} ${item.name}`}
                type="text" 
                danger
                size="small" 
                icon={<DeleteOutlined style={{ fontSize: 12 }} />} 
                onClick={(e) => handleDeleteItem(item.id, item.type, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
          </div>
        )}
      </div>
    );
  };

  const renderCharacterCardTreeTitle = (item: PartnerItem) => {
    const isSelected = selectedType === 'character_card' && selectedId === item.id;
    const isEditing = editingId === item.id;

    return (
      <div
        className={`character-tree-item ${isSelected ? 'is-selected' : ''}`}
        onDoubleClick={(e) => handleStartRename(item, e)}
      >
        <div className="background-directory-item__body">
          <UserOutlined style={{ fontSize: 14, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          {isEditing ? (
            <Input
              ref={renameInputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleSaveRename(item)}
              onPressEnter={() => handleSaveRename(item)}
              size="small"
              style={{ height: 22, padding: '0 4px', fontSize: 13, borderColor: '#d97757' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="background-directory-item__name">
              {item.name}
            </span>
          )}
        </div>

        {!isEditing && (
          <div className="directory-item-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip title="Rename" mouseEnterDelay={0.8}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined style={{ fontSize: 12 }} />}
                onClick={(e) => handleStartRename(item, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
            <Tooltip title="Delete" mouseEnterDelay={0.8}>
              <Button
                aria-label={`${item.type === 'world_book' ? 'Delete world book' : 'Delete character card'} ${item.name}`}
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                onClick={(e) => handleDeleteItem(item.id, item.type, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
          </div>
        )}
      </div>
    );
  };

  const toggleCharacterGroup = (groupKey: string) => {
    setExpandedCharacterGroupKeys((keys) =>
      keys.includes(groupKey) ? keys.filter((key) => key !== groupKey) : [...keys, groupKey]
    );
  };

  const characterCardTreeData = characterCardGroups.map((group) => ({
    key: group.key,
    selectable: false,
    title: (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8c8882', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
      >
        <BookOutlined style={{ fontSize: 13, color: group.worldBookId ? '#d97757' : '#c0bbb4' }} />
        {group.title}
      </span>
    ),
    children: group.cards.map((card) => ({
      key: card.id,
      title: renderCharacterCardTreeTitle(card),
      isLeaf: true,
    })),
  }));

  // Rendering World Book Config UI
  const renderWorldBookForm = (item: PartnerItem) => {
    const fields = normalizePartnerFields(item.fields);

    return (
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Card className="custom-form-card" title={<span className="form-section-title"><CompassOutlined style={{ color: '#d97757' }} /> Basic World Settings</span>} size="small">
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <div className="input-label">World Name</div>
              <Input 
                value={item.name} 
                className="custom-form-input"
                placeholder="Enter the world name"
                onChange={(e) => updateItemName(item.id, item.type, e.target.value)}
              />
            </Col>
            <Col span={12}>
              <div className="input-label">Core Theme</div>
              <Input 
                value={fields.theme || ''} 
                className="custom-form-input"
                placeholder="e.g. Magical Adventure / Fantasy Epic / Steampunk"
                onChange={(e) => handleFieldChange('theme', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">Era</div>
              <Input 
                value={fields.era || ''} 
                className="custom-form-input"
                placeholder="e.g. Magical Industrial Age / Late Medieval"
                onChange={(e) => handleFieldChange('era', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">Technology Level</div>
              <Input 
                value={fields.techLevel || ''} 
                className="custom-form-input"
                placeholder="e.g. Steam engines and simple electrics"
                onChange={(e) => handleFieldChange('techLevel', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">Magic Level</div>
              <Input 
                value={fields.magicLevel || ''} 
                className="custom-form-input"
                placeholder="e.g. High-magic world / widespread aether use"
                onChange={(e) => handleFieldChange('magicLevel', e.target.value)}
              />
            </Col>
          </Row>
          <CustomFieldsBlock
            item={item}
            moduleId="world_basic"
            addCustomField={addCustomField}
            updateCustomField={updateCustomField}
            removeCustomField={removeCustomField}
          />
        </Card>

        <Card className="custom-form-card" title={<span className="form-section-title"><GlobalOutlined style={{ color: '#d97757' }} /> Core Worldview</span>} size="small">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <div className="input-label">Geography</div>
              <Input.TextArea 
                value={fields.geography || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="Describe continent layout, major geographic features and climate..."
                onChange={(e) => handleFieldChange('geography', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">Key Scenes</div>
              <Input.TextArea 
                value={fields.keyScenes || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="List the core scene landmarks where the story unfolds, e.g. “The Grand Library of Oran Magic Academy”..."
                onChange={(e) => handleFieldChange('keyScenes', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">Cultural Traits</div>
              <Input.TextArea 
                value={fields.culturalFeatures || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="Describe each group’s customs, beliefs, and societal views on magic/technology..."
                onChange={(e) => handleFieldChange('culturalFeatures', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">Historical Events</div>
              <Input.TextArea 
                value={fields.history || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="List far-reaching wars, treaties or turning points in this world..."
                onChange={(e) => handleFieldChange('history', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">Core Conflict</div>
              <Input.TextArea 
                value={fields.conflict || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="Describe the world’s sharpest conflict, e.g. “Magic conservatives vs. the tech-industrial faction”..."
                onChange={(e) => handleFieldChange('conflict', e.target.value)}
              />
            </div>
            <CustomFieldsBlock
              item={item}
              moduleId="world_core"
              addCustomField={addCustomField}
              updateCustomField={updateCustomField}
              removeCustomField={removeCustomField}
            />
          </Space>
        </Card>
      </Space>
    );
  };

  // Rendering Character Card Config UI
  const renderCharacterCardForm = (item: PartnerItem) => {
    const fields = normalizePartnerFields(item.fields);
    const ownerSelectValue = item.worldBookId && worldBooks.some((worldBook) => worldBook.id === item.worldBookId)
      ? item.worldBookId
      : UNASSIGNED_CHARACTER_CARD_GROUP_ID;

    const tabItems = [
      {
        key: '1',
        label: 'Basics & Tags',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="Basic Identity" size="small">
              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <div className="input-label">Name</div>
                  <Input 
                    value={item.name} 
                    className="custom-form-input"
                    placeholder="Enter the character name"
                    onChange={(e) => updateItemName(item.id, item.type, e.target.value)}
                  />
                </Col>
                <Col span={12}>
                  <div className="input-label">Assigned World Book</div>
                  <Select
                    aria-label="Assigned World Book"
                    value={ownerSelectValue}
                    onChange={(value) => updateCharacterCardWorldBook(
                      item.id,
                      value === UNASSIGNED_CHARACTER_CARD_GROUP_ID ? null : value,
                    )}
                    options={[
                      { value: UNASSIGNED_CHARACTER_CARD_GROUP_ID, label: 'Unassigned' },
                      ...worldBooks.map((worldBook) => ({ value: worldBook.id, label: worldBook.name })),
                    ]}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col span={6}>
                  <div className="input-label">Age</div>
                  <Input 
                    value={fields.age || ''} 
                    className="custom-form-input"
                    placeholder="e.g. 18"
                    onChange={(e) => handleFieldChange('age', e.target.value)}
                  />
                </Col>
                <Col span={6}>
                  <div className="input-label">Gender</div>
                  <Input 
                    value={fields.gender || ''} 
                    className="custom-form-input"
                    placeholder="e.g. Male"
                    onChange={(e) => handleFieldChange('gender', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">Race</div>
                  <Input 
                    value={fields.race || ''} 
                    className="custom-form-input"
                    placeholder="e.g. Human / Elf"
                    onChange={(e) => handleFieldChange('race', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">Birthplace</div>
                  <Input 
                    value={fields.birthplace || ''} 
                    className="custom-form-input"
                    placeholder="e.g. Border town"
                    onChange={(e) => handleFieldChange('birthplace', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">Occupation</div>
                  <Input 
                    value={fields.occupation || ''} 
                    className="custom-form-input"
                    placeholder="e.g. Senior academy student"
                    onChange={(e) => handleFieldChange('occupation', e.target.value)}
                  />
                </Col>
                <Col span={24}>
                  <div className="input-label">Social Class</div>
                  <Input 
                    value={fields.socialClass || ''} 
                    className="custom-form-input"
                    placeholder="Describe the character’s social standing, e.g. “Common-born, admitted on a talent scholarship”"
                    onChange={(e) => handleFieldChange('socialClass', e.target.value)}
                  />
                </Col>
              </Row>
            </Card>

            <Card className="custom-sub-card" title="Identity Tags (press Enter or blur to save)" size="small">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 4px', alignItems: 'center' }}>
                {(fields.identityTags || []).map((tag) => (
                  <Tag
                    key={tag}
                    closable
                    onClose={() => handleRemoveTag(tag)}
                    className="background-identity-tag"
                  >
                    {tag}
                  </Tag>
                ))}
                {tagInputVisible ? (
                  <Input
                    ref={tagInputRef}
                    type="text"
                    size="small"
                    style={{ width: 100, height: 26 }}
                    value={tagInputValue}
                    onChange={(e) => setTagInputValue(e.target.value)}
                    onBlur={handleAddTagConfirm}
                    onPressEnter={handleAddTagConfirm}
                  />
                ) : (
                  <Button 
                    type="dashed" 
                    size="small" 
                    icon={<PlusOutlined />} 
                    onClick={showTagInput}
                    style={{ 
                      height: 26, 
                      fontSize: 12, 
                      borderRadius: 4,
                      color: '#8c8882',
                      borderColor: 'rgba(0,0,0,0.1)'
                    }}
                  >
                    New Tag
                  </Button>
                )}
              </div>
            </Card>
            <CustomFieldsBlock
              item={item}
              moduleId="char_basic"
              addCustomField={addCustomField}
              updateCustomField={updateCustomField}
              removeCustomField={removeCustomField}
            />
          </Space>
        )
      },
      {
        key: '2',
        label: 'Appearance & Personality',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="Appearance & Demeanor" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">Height & Build</div>
                    <Input 
                      value={fields.heightBuild || ''} 
                      className="custom-form-input"
                      placeholder="e.g. “178cm, lean and well-proportioned”"
                      onChange={(e) => handleFieldChange('heightBuild', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">Signature Features</div>
                    <Input 
                      value={fields.iconicFeatures || ''} 
                      className="custom-form-input"
                      placeholder="e.g. “Pale-blue aether brand on the back of the hand”"
                      onChange={(e) => handleFieldChange('iconicFeatures', e.target.value)}
                    />
                  </Col>
                </Row>
                <div>
                  <div className="input-label">Clothing Style</div>
                  <Input.TextArea 
                    value={fields.clothingStyle || ''} 
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    className="custom-form-input"
                    placeholder="Describe the character's usual attire and carried items..."
                    onChange={(e) => handleFieldChange('clothingStyle', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">Overall Vibe</div>
                  <Input.TextArea 
                    value={fields.overallVibe || ''} 
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    className="custom-form-input"
                    placeholder="The impression they leave, e.g. “Gentle and calm, with a flicker of wariness”..."
                    onChange={(e) => handleFieldChange('overallVibe', e.target.value)}
                  />
                </div>
              </Space>
            </Card>

            <Card className="custom-sub-card" title="Inner Personality" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">Outer Personality (the face shown to the world)</div>
                    <Input.TextArea 
                      value={fields.externalPersonality || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="e.g. “Gentle and humble, helpful, a reliable companion”"
                      onChange={(e) => handleFieldChange('externalPersonality', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">Inner Personality (the true self)</div>
                    <Input.TextArea 
                      value={fields.internalPersonality || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="e.g. “Calm and restrained, heavily guarded, always weighing options”"
                      onChange={(e) => handleFieldChange('internalPersonality', e.target.value)}
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">Core Desire (strongest inner drive)</div>
                    <Input.TextArea 
                      value={fields.coreDesire || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="e.g. “Uncover the principles beneath magic, get home safely”"
                      onChange={(e) => handleFieldChange('coreDesire', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">Fears & Weaknesses (biggest vulnerability)</div>
                    <Input.TextArea 
                      value={fields.fearWeakness || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="e.g. “Their transmigration secret leaking and being purged as a heretic”"
                      onChange={(e) => handleFieldChange('fearWeakness', e.target.value)}
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">Moral Code (sense of right and wrong)</div>
                    <Input.TextArea 
                      value={fields.moralValues || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="e.g. “Never harms others unprovoked; strikes back decisively when threatened”"
                      onChange={(e) => handleFieldChange('moralValues', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">Quirks (unique habits)</div>
                    <Input.TextArea 
                      value={fields.quirk || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="e.g. “Taps their temple with an index finger when thinking hard”"
                      onChange={(e) => handleFieldChange('quirk', e.target.value)}
                    />
                  </Col>
                </Row>
              </Space>
            </Card>
            <CustomFieldsBlock
              item={item}
              moduleId="char_appearance"
              addCustomField={addCustomField}
              updateCustomField={updateCustomField}
              removeCustomField={removeCustomField}
            />
          </Space>
        )
      },
      {
        key: '3',
        label: 'Abilities & History',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="Core Abilities & History" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">Skills & Expertise</div>
                  <Input.TextArea 
                    value={fields.skills || ''} 
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    className="custom-form-input"
                    placeholder="Describe the character's magic, martial arts, scientific knowledge or other talents..."
                    onChange={(e) => handleFieldChange('skills', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">Backstory</div>
                  <Input.TextArea 
                    value={fields.backgroundStory || ''} 
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    className="custom-form-input"
                    placeholder="Narrate the key formative events of their past — how they became who they are..."
                    onChange={(e) => handleFieldChange('backgroundStory', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">Relationships</div>
                  <Input.TextArea 
                    value={fields.relationships || ''} 
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    className="custom-form-input"
                    placeholder="Describe ties to supporting characters, rival factions, mentors or close friends..."
                    onChange={(e) => handleFieldChange('relationships', e.target.value)}
                  />
                </div>
              </Space>
            </Card>

            <Card className="custom-sub-card" title="Speech Style" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">Way of Speaking</div>
                  <Input.TextArea 
                    value={fields.speakingStyle || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="Verbal tics and rhythm, e.g. “Even-toned, fond of ‘From my observations...’”..."
                    onChange={(e) => handleFieldChange('speakingStyle', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">Typical Reactions</div>
                  <Input.TextArea 
                    value={fields.typicalReactions || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="Instinctive reactions to surprises, e.g. “Pupils contract in a crisis but they never panic”..."
                    onChange={(e) => handleFieldChange('typicalReactions', e.target.value)}
                  />
                </div>
              </Space>
            </Card>
            <CustomFieldsBlock
              item={item}
              moduleId="char_ability"
              addCustomField={addCustomField}
              updateCustomField={updateCustomField}
              removeCustomField={removeCustomField}
            />
          </Space>
        )
      },
      {
        key: '4',
        label: 'Character Memory',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="Relationship with User (extracted by LLM or entered manually)" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">Relationship Type</div>
                  <Input 
                    value={fields.userRelationType || ''} 
                    className="custom-form-input"
                    placeholder="e.g. bickering lovers, sworn friends, mentor and student, fierce rivals..."
                    onChange={(e) => handleFieldChange('userRelationType', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">Interaction Pattern</div>
                  <Input.TextArea 
                    value={fields.userInteractionModel || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="Describe how the character interacts with the user. E.g. sarcastic on the surface but fiercely protective when it matters, polite and measured, warm and jokey..."
                    onChange={(e) => handleFieldChange('userInteractionModel', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">Relationship Bottom Line</div>
                  <Input.TextArea 
                    value={fields.userRelationBottomLine || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="Describe the character's hard boundaries with the user. E.g. never tolerates lies, sides with family when family interests are at stake, never ask about the brand on their right hand..."
                    onChange={(e) => handleFieldChange('userRelationBottomLine', e.target.value)}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div className="input-label" style={{ margin: 0 }}>Key Events</div>
                    <Button
                      type="text"
                      size="small"
                      disabled={isOptimizing}
                      icon={isOptimizing ? <LoadingOutlined spin /> : <ThunderboltOutlined style={{ color: '#d97757' }} />}
                      onClick={() => handleOptimizeMemories(fields.keyEvents || '')}
                      className="background-optimize-button"
                    >
                      {isOptimizing ? 'AI optimizing...' : 'AI Condense & Optimize'}
                    </Button>
                  </div>
                  <Input.TextArea 
                    value={fields.keyEvents || ''} 
                    autoSize={{ minRows: 4, maxRows: 8 }}
                    className="custom-form-input"
                    placeholder="Record the milestones this character shared with the user (bullet list or timeline recommended)..."
                    onChange={(e) => handleFieldChange('keyEvents', e.target.value)}
                  />
                </div>
              </Space>
            </Card>
            <CustomFieldsBlock
              item={item}
              moduleId="char_memory"
              addCustomField={addCustomField}
              updateCustomField={updateCustomField}
              removeCustomField={removeCustomField}
            />
          </Space>
        )
      }
    ];

    return (
      <div className="custom-tab" style={{ width: '100%' }}>
        <Tabs items={tabItems} defaultActiveKey="1" size="middle" />
      </div>
    );
  };

  return (
      <div className="background-page">
      {/* CSS injection for aesthetic styling and theme preservation */}
      <style>{`
        .directory-item-hover:hover {
          background-color: #faf6f0;
        }
        .background-page {
          display: flex;
          height: 100%;
          width: 100%;
          overflow: hidden;
          background: #faf9f5;
        }
        .background-directory-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: relative;
          margin: 4px 8px;
          padding: 8px 12px;
          border-radius: 6px;
          color: #33312e;
          cursor: pointer;
          transition: background-color 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), color 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
        }
        .background-directory-item.is-selected,
        .character-tree-item.is-selected {
          background: #f2e8dc;
          color: #d97757;
        }
        .background-directory-item__body {
          display: flex;
          flex: 1;
          min-width: 0;
          align-items: center;
          gap: 8px;
        }
        .background-directory-item__name {
          overflow: hidden;
          font-size: 13px;
          font-weight: 400;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .background-directory-item.is-selected .background-directory-item__name,
        .character-tree-item.is-selected .background-directory-item__name {
          font-weight: 500;
        }
        .character-tree-item {
          display: flex;
          min-height: 30px;
          align-items: center;
          justify-content: space-between;
          padding: 4px 8px;
          border-radius: 6px;
          color: #33312e;
        }
        .background-identity-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border: 1px solid #f2e8dc;
          border-radius: 4px;
          background-color: #faf6f0;
          color: #d97757;
          font-size: 13px;
        }
        .background-optimize-button.ant-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 22px;
          border: 1px solid #f2e8dc;
          border-radius: 4px;
          background: #faf6f0;
          color: #d97757;
          font-size: 11px;
        }
        .directory-item-hover:hover .action-btn {
          display: inline-flex !important;
        }
        .character-tree-item:hover {
          background-color: #faf6f0 !important;
        }
        .character-tree-item:hover .action-btn,
        .character-tree-item.is-selected .action-btn {
          display: inline-flex !important;
        }
        .character-card-tree .ant-tree-treenode {
          padding: 0 8px 2px 8px !important;
        }
        .character-card-tree .ant-tree-node-content-wrapper {
          flex: 1;
          min-width: 0;
          padding: 0 !important;
          border-radius: 6px !important;
        }
        .character-card-tree .ant-tree-node-content-wrapper.ant-tree-node-selected {
          background: transparent !important;
        }
        .character-card-tree .ant-tree-switcher {
          color: #c0bbb4;
        }
        .directory-item-hover .action-btn:hover {
          background-color: rgba(0, 0, 0, 0.04) !important;
        }
        .add-category-btn {
          color: #8c8882;
          transition: all 0.2s;
        }
        .add-category-btn:hover {
          color: #d97757 !important;
          background-color: #f2e8dc !important;
        }
        .background-ai-button.ant-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 24px;
          padding: 2px 8px;
          border: 1px solid #f2e8dc;
          border-radius: 4px;
          background: #faf6f0;
          color: #d97757;
          font-size: 12px;
        }
        .background-category-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 16px 4px 20px;
          color: #8c8882;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.05em;
        }
        .background-export-button.ant-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          padding: 0;
          border: 1px solid rgba(0, 0, 0, 0.03);
          border-radius: 6px;
          background: #faf9f5;
        }
        .background-character-error-pre {
          max-height: 220px;
          margin: 0;
          padding: 10px;
          overflow: auto;
          border: 1px solid rgba(0, 0, 0, 0.04);
          border-radius: 6px;
          background: #fff;
          font-family: Consolas, Monaco, "Courier New", monospace;
          font-size: 12px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        
        /* Premium custom styles for inputs and forms */
        .input-label {
          font-size: 12px;
          color: #8c8882;
          font-weight: 500;
          margin-bottom: 6px;
        }
        .custom-form-input {
          border-radius: 6px !important;
          border: 1px solid rgba(0, 0, 0, 0.08) !important;
          transition: all 0.2s !important;
          font-family: inherit !important;
        }
        .custom-form-input:focus, .custom-form-input-focused {
          border-color: #d97757 !important;
          box-shadow: 0 0 0 2px rgba(217, 119, 87, 0.1) !important;
        }
        .custom-form-input:hover {
          border-color: #d97757 !important;
        }
        .form-section-title {
          font-size: 14px;
          font-weight: 600;
          color: #33312e;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .custom-form-card {
          background: #ffffff !important;
          border: 1px solid rgba(0, 0, 0, 0.03) !important;
          border-radius: 8px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.01) !important;
        }
        .custom-form-card .ant-card-head {
          border-bottom: 1px solid rgba(0,0,0,0.02) !important;
          background: #fafafa !important;
          border-top-left-radius: 8px !important;
          border-top-right-radius: 8px !important;
        }
        .custom-sub-card {
          background: #ffffff !important;
          border: 1px solid rgba(0, 0, 0, 0.03) !important;
          border-radius: 8px !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.01) !important;
        }
        .custom-sub-card .ant-card-head {
          border-bottom: 1px solid rgba(0,0,0,0.02) !important;
          background: #fbfbfa !important;
          font-size: 13px !important;
          font-weight: 500 !important;
        }
        
        /* Custom tabs styling in warm palette */
        .custom-tab .ant-tabs-nav::before {
          border-bottom: 1px solid rgba(0,0,0,0.03) !important;
        }
        .custom-tab .ant-tabs-tab {
          padding: 8px 12px !important;
        }
        .custom-tab .ant-tabs-tab-btn {
          color: #8c8882 !important;
          font-weight: 400 !important;
        }
        .custom-tab .ant-tabs-tab-btn:hover {
          color: #d97757 !important;
        }
        .custom-tab .ant-tabs-tab-active .ant-tabs-tab-btn {
          color: #d97757 !important;
          font-weight: 600 !important;
        }
        .custom-tab .ant-tabs-ink-bar {
          background: #d97757 !important;
          height: 2px !important;
        }
        
        /* Premium Magazine-like preview styling */
        .markdown-preview-container {
          background-color: #ffffff;
          padding: 32px 40px;
          border-radius: 8px;
          border: 1px solid rgba(0, 0, 0, 0.03);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.01);
          color: #33312e;
          font-family: Georgia, -apple-system-font, "STSong", "Songti SC", serif;
          line-height: 1.8;
          font-size: 15px;
          max-width: 760px;
          margin: 0 auto;
          width: 100%;
        }
        .markdown-preview-container h1 {
          font-size: 26px;
          font-weight: 700;
          border-bottom: 2px solid #f2e8dc;
          padding-bottom: 10px;
          margin-bottom: 24px;
          color: #33312e;
          text-align: center;
        }
        .markdown-preview-container h2 {
          font-size: 18px;
          font-weight: 600;
          margin-top: 28px;
          margin-bottom: 16px;
          color: #d97757;
          border-left: 3px solid #d97757;
          padding-left: 10px;
        }
        .markdown-preview-container p {
          margin-bottom: 16px;
          text-align: justify;
        }
        .markdown-preview-container ul {
          padding-left: 20px;
          margin-bottom: 18px;
        }
        .markdown-preview-container li {
          margin-bottom: 8px;
        }
        .markdown-preview-container code {
          background-color: #faf6f0;
          color: #d97757;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 13px;
          font-family: Consolas, Monaco, monospace;
        }
      `}</style>

      {/* Left Directory Sidebar */}
      <div style={{ 
        width: DIRECTORY_WIDTH, 
        minWidth: DIRECTORY_WIDTH, 
        borderRight: '1px solid rgba(0, 0, 0, 0.04)', 
        display: 'flex', 
        flexDirection: 'column',
        background: '#ffffff'
      }}>
        <input
          ref={importInputRef}
          type="file"
          multiple
          accept="application/json,.json"
          aria-label="Import world book or character card files"
          style={{ display: 'none' }}
          onChange={handleImportPartnerItemsFile}
        />
        {/* Title Header */}
        <div style={{ 
          padding: '16px 20px', 
          borderBottom: '1px solid rgba(0, 0, 0, 0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ 
            fontSize: 16, 
            fontWeight: 600, 
            color: '#33312e',
            fontFamily: '"Inter", sans-serif'
          }}>
            Background
          </span>
        </div>

        {/* Directory Scrollable Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          <StylePresetManager onSelectPreset={() => selectItem(null, null)} />
          
          {/* World Book Category */}
          <div>
            <div className="background-category-header">
              <span>World Books</span>
              <Space size={2}>
                <Tooltip title="Import world book">
                  <Button
                    aria-label="Import world book"
                    type="text"
                    size="small"
                    icon={<UploadOutlined style={{ fontSize: 12 }} />}
                    onClick={() => handleRequestImportPartnerItems('world_book')}
                    style={{ width: 22, height: 22, padding: 0 }}
                    className="add-category-btn"
                  />
                </Tooltip>
                <Tooltip title="New world book">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined style={{ fontSize: 12 }} />}
                    onClick={() => {
                      stylePresetStore.selectPreset(null);
                      addWorldBook();
                    }}
                    style={{ width: 22, height: 22, padding: 0 }}
                    className="add-category-btn"
                  />
                </Tooltip>
              </Space>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              {worldBooks.length === 0 ? (
                <div style={{ padding: '8px 20px', color: '#c0bbb4', fontSize: 12, fontStyle: 'italic' }}>
                  No world books yet
                </div>
              ) : (
                worldBooks.map(renderDirectoryItem)
              )}
            </div>
          </div>

          {/* Character Card Category */}
          <div>
            <div className="background-category-header">
              <span>Character Cards</span>
              <Space size={2}>
                <Tooltip title="Import character card">
                  <Button
                    aria-label="Import character card"
                    type="text"
                    size="small"
                    icon={<UploadOutlined style={{ fontSize: 12 }} />}
                    onClick={() => handleRequestImportPartnerItems('character_card')}
                    style={{ width: 22, height: 22, padding: 0 }}
                    className="add-category-btn"
                  />
                </Tooltip>
                <Tooltip title="New character card">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined style={{ fontSize: 12 }} />}
                    onClick={() => {
                      stylePresetStore.selectPreset(null);
                      addCharacterCard();
                    }}
                    style={{ width: 22, height: 22, padding: 0 }}
                    className="add-category-btn"
                  />
                </Tooltip>
              </Space>
            </div>
            
            <div>
              {characterCards.length === 0 ? (
                <div style={{ padding: '8px 20px', color: '#c0bbb4', fontSize: 12, fontStyle: 'italic' }}>
                  No character cards yet
                </div>
              ) : (
                <Tree
                  className="character-card-tree"
                  expandedKeys={expandedCharacterGroupKeys}
                  onExpand={(keys) => setExpandedCharacterGroupKeys(keys)}
                  selectedKeys={selectedType === 'character_card' && selectedId ? [selectedId] : []}
                  onClick={(_, node) => {
                    const nextKey = String(node.key);
                    if (characterCardGroupKeys.includes(nextKey)) {
                      toggleCharacterGroup(nextKey);
                    }
                  }}
                  onSelect={(keys) => {
                    const nextId = String(keys[0] || '');
                    if (nextId) {
                      stylePresetStore.selectPreset(null);
                      selectItem(nextId, 'character_card');
                    }
                  }}
                  treeData={characterCardTreeData}
                />
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Right Config Panel */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden' 
      }}>
        {selectedStylePreset ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            <div style={{
              padding: '12px 24px',
              background: '#ffffff',
              borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 52,
            }}>
              <FileProtectOutlined style={{ fontSize: 16, color: '#d97757' }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: '#33312e' }}>{selectedStylePreset.name}</span>
              <span style={{ fontSize: 12, background: '#f2e8dc', color: '#d97757', padding: '2px 8px', borderRadius: 12, fontWeight: 500 }}>
                Style Preset
              </span>
            </div>
            <div style={{ flex: 1, padding: '24px 32px 40px', overflowY: 'auto', background: '#faf9f5' }}>
              <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
                <StylePresetEditor preset={selectedStylePreset} />
              </div>
            </div>
          </div>
        ) : selectedItem ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%', 
            width: '100%' 
          }}>
            {/* Header */}
            <div style={{ 
              padding: '12px 24px', 
              background: '#ffffff', 
              borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 52
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {selectedItem.type === 'world_book' ? (
                  <GlobalOutlined style={{ fontSize: 16, color: '#d97757' }} />
                ) : (
                  <UserOutlined style={{ fontSize: 16, color: '#d97757' }} />
                )}
                <span style={{ fontSize: 15, fontWeight: 600, color: '#33312e' }}>
                  {selectedItem.name}
                </span>
                <span style={{ 
                  fontSize: 12,
                  background: '#f2e8dc', 
                  color: '#d97757', 
                  padding: '2px 8px', 
                  borderRadius: 12, 
                  fontWeight: 500
                }}>
                  {selectedItem.type === 'world_book' ? 'World Book' : 'Character Card'}
                </span>
              </div>

              <Space size={8}>
                <Tooltip title={selectedItem.type === 'world_book' ? 'Export this world book and its character cards' : 'Export this character card'}>
                  <Button
                    aria-label={selectedItem.type === 'world_book' ? 'Export this world book' : 'Export this character card'}
                    type="text"
                    size="small"
                    icon={<DownloadOutlined style={{ fontSize: 13, color: '#8c8882' }} />}
                    onClick={() => {
                      if (selectedItem.type === 'character_card') {
                        setUiField('exportFormatModalItem', selectedItem);
                      } else {
                        handleExportPartnerItem(selectedItem);
                      }
                    }}
                    className="background-export-button"
                  />
                </Tooltip>

                {/* Mode Toggle Selector */}
                <Radio.Group
                  value={activeMode}
                  onChange={(e) => setActiveMode(e.target.value)}
                  size="small"
                  style={{
                    padding: 2,
                    background: '#faf9f5',
                    borderRadius: 6,
                    border: '1px solid rgba(0,0,0,0.03)'
                  }}
                >
                  <Radio.Button
                    value="edit"
                    style={{
                      borderRadius: 4,
                      border: 'none',
                      background: activeMode === 'edit' ? '#ffffff' : 'transparent',
                      color: activeMode === 'edit' ? '#d97757' : '#8c8882',
                      boxShadow: activeMode === 'edit' ? '0 1px 4px rgba(0,0,0,0.05)' : 'none',
                      fontWeight: activeMode === 'edit' ? 500 : 400
                    }}
                  >
                    <Space size={4}>
                      <EditFilled style={{ fontSize: 12 }} />
                      <span>Edit</span>
                    </Space>
                  </Radio.Button>
                  <Radio.Button
                    value="preview"
                    style={{
                      borderRadius: 4,
                      border: 'none',
                      background: activeMode === 'preview' ? '#ffffff' : 'transparent',
                      color: activeMode === 'preview' ? '#d97757' : '#8c8882',
                      boxShadow: activeMode === 'preview' ? '0 1px 4px rgba(0,0,0,0.05)' : 'none',
                      fontWeight: activeMode === 'preview' ? 500 : 400
                    }}
                  >
                    <Space size={4}>
                      <EyeOutlined style={{ fontSize: 12 }} />
                      <span>Preview</span>
                    </Space>
                  </Radio.Button>
                </Radio.Group>
              </Space>
            </div>

            {/* Scrollable Work Area */}
            <div style={{ 
              flex: 1, 
              padding: '24px 32px 40px 32px', 
              overflowY: 'auto',
              background: '#faf9f5'
            }}>
              {activeMode === 'edit' ? (
                // Form Editor View
                <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
                  {selectedItem.type === 'world_book' 
                    ? renderWorldBookForm(selectedItem) 
                    : renderCharacterCardForm(selectedItem)
                  }
                </div>
              ) : (
                // Elegant Markdown Preview View
                <div className="markdown-preview-container">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedItem.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            background: '#faf9f5' 
          }}>
            <Empty
              image={<CompassOutlined style={{ fontSize: 64, color: '#c0bbb4' }} />}
              description={
                <span style={{ color: '#8c8882', fontSize: 14 }}>
                  Select or create a style preset, world book or character card in the left directory to view its settings.
                </span>
              }
            />
          </div>
        )}
      </div>

      <Modal
        title="Delete World Book"
        open={Boolean(pendingWorldBookDelete)}
        onCancel={() => setPendingWorldBookDelete(null)}
        footer={[
          <Button key="delete-world" onClick={handleDeleteWorldBookOnly}>
            Delete world book only
          </Button>,
          <Button key="delete-bundle" danger type="primary" onClick={handleDeleteWorldBookWithCards}>
            Delete world book and its character cards
          </Button>,
          <Button key="cancel" onClick={() => setPendingWorldBookDelete(null)}>
            Cancel
          </Button>,
        ]}
      >
        <p style={{ marginBottom: 8 }}>
          Delete “{pendingWorldBookDelete?.name || 'Unnamed World Book'}”?
        </p>
        <p style={{ marginBottom: 0, color: '#8c8882' }}>
          If only the world book is deleted, its character cards become unassigned.
        </p>
      </Modal>

      {/* Memory Optimization Review Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '16px', fontWeight: 600 }}>
            <FileProtectOutlined style={{ color: '#d97757' }} />
            <span>AI Memory Optimization & Contradiction Review</span>
          </div>
        }
        open={isMemModalOpen}
        onCancel={() => setIsMemModalOpen(false)}
        onOk={handleConfirmOptimize}
        okText="Confirm & Write to Card"
        cancelText="Cancel"
        width={680}
        styles={{
          body: { padding: '16px 24px' }
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ padding: '10px 14px', background: '#faf6f0', borderRadius: '8px', border: '1px solid #f2e8dc', color: '#8c8882', fontSize: '12px', lineHeight: 1.5 }}>
            <strong>Memory optimization complete:</strong> the model has resolved contradictions and condensed the memories. You can fine-tune the text in the editor below, then click “Confirm & Write” to sync it back to the character’s “Key Events”.
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 500, color: '#8c8882', marginBottom: '6px' }}>Optimized key events</div>
            <Input.TextArea
              value={optimizedEvents}
              onChange={(e) => setOptimizedEvents(e.target.value)}
              autoSize={{ minRows: 10, maxRows: 16 }}
              className="custom-form-input custom-form-input-focused"
              placeholder="Enter the optimized key event memory content..."
              style={{ borderRadius: '6px', fontSize: '13px', lineHeight: 1.6 }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="Choose Export Format"
        open={Boolean(exportFormatModalItem)}
        onCancel={() => setUiField('exportFormatModalItem', null)}
        footer={[
          <Button key="cancel" onClick={() => setUiField('exportFormatModalItem', null)}>
            Cancel
          </Button>,
        ]}
        width={420}
        centered
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
          <div style={{ color: '#8c8882', fontSize: 13, marginBottom: 4 }}>
            Choose the export format for “{exportFormatModalItem?.name || 'Unnamed Character Card'}”:
          </div>
          <Button
            block
            size="large"
            onClick={handleChooseMuseAiFormat}
            style={{ textAlign: 'left', height: 'auto', padding: '12px 16px' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>MuseAI Format</span>
              <span style={{ fontSize: 12, color: '#b4afa7' }}>Export as MuseAI character card JSON, re-importable for editing</span>
            </div>
          </Button>
          <Button
            block
            size="large"
            onClick={() => exportFormatModalItem && handleStartSillyTavernConvert(exportFormatModalItem)}
            style={{ textAlign: 'left', height: 'auto', padding: '12px 16px' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>SillyTavern Format</span>
              <span style={{ fontSize: 12, color: '#b4afa7' }}>Convert to a SillyTavern V2 character card with the LLM, then preview and export</span>
            </div>
          </Button>
        </div>
      </Modal>

      <SillyTavernExportPreviewModal
        open={sillyTavernPreviewOpen}
        cardJson={sillyTavernPreviewJson}
        loading={sillyTavernConverting}
        error={sillyTavernConvertError}
        onConfirm={handleConfirmSillyTavernExport}
        onRetry={handleRetrySillyTavernConvert}
        onCancel={handleCancelSillyTavernPreview}
      />
    </div>
  );
};

export const BackgroundPage: React.FC = () => useBackgroundView();
