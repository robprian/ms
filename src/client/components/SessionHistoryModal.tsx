import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { Button, Empty, Input, message, Modal, Select, Tag } from 'antd';
import type { InputRef } from 'antd';
import type { AgentSessionSummary } from '../stores/useAgentStore';
import type { PartnerItem } from '../stores/usePartnerStore';
import {
  resolveSessionHistoryMeta,
  sessionMatchesHistoryFilters,
} from '../utils/sessionHistory';
import { useStateGroup } from '../utils/reducerState';
import React, { useMemo, useRef } from 'react';

interface SessionHistoryModalProps {
  open: boolean;
  title: string;
  emptyText: string;
  sessions: AgentSessionSummary[];
  worldBooks: PartnerItem[];
  characterCards: PartnerItem[];
  onClose: () => void;
  onOpenSession: (id: string) => void | Promise<void>;
  onDeleteSession: (id: string) => void | Promise<void>;
  onRenameSession: (id: string, title: string) => void | Promise<void>;
}

interface SessionHistoryModalState {
  worldBookFilter: string | null;
  characterCardFilter: string | null;
  editingSessionId: string | null;
  editingTitle: string;
  isSavingTitle: boolean;
}

const savedAtFormatter = new Intl.DateTimeFormat('en-US', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const filterSelectStyle: React.CSSProperties = { minWidth: 180, flex: '1 1 180px' };
const sessionHistoryItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 8,
  border: '1px solid #eee8df',
  borderRadius: 8,
  background: '#fffdfa',
};
const sessionHistoryOpenButtonStyle: React.CSSProperties = {
  flex: 1,
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  padding: '12px 14px',
  cursor: 'pointer',
  font: 'inherit',
  minWidth: 0,
};

export function SessionHistoryModal({
  open,
  title,
  emptyText,
  sessions,
  worldBooks,
  characterCards,
  onClose,
  onOpenSession,
  onDeleteSession,
  onRenameSession,
}: SessionHistoryModalProps) {
  const [uiState, patchUiState, setUiField] = useStateGroup<SessionHistoryModalState>({
    worldBookFilter: null,
    characterCardFilter: null,
    editingSessionId: null,
    editingTitle: '',
    isSavingTitle: false,
  });
  const {
    worldBookFilter,
    characterCardFilter,
    editingSessionId,
    editingTitle,
    isSavingTitle,
  } = uiState;
  const titleInputRef = useRef<InputRef>(null);

  const filteredSessions = useMemo(
    () => sessions.filter((session) => sessionMatchesHistoryFilters(
      session,
      worldBooks,
      characterCards,
      { worldBookId: worldBookFilter, characterCardId: characterCardFilter },
    )),
    [characterCardFilter, characterCards, sessions, worldBookFilter, worldBooks],
  );

  const handleOpenSession = (id: string) => {
    void Promise.resolve(onOpenSession(id)).then(onClose);
  };

  const startEditing = (session: AgentSessionSummary) => {
    patchUiState({
      editingSessionId: session.id,
      editingTitle: session.title,
    });
    window.setTimeout(() => titleInputRef.current?.focus({ cursor: 'all' }), 0);
  };

  const cancelEditing = () => {
    patchUiState({
      editingSessionId: null,
      editingTitle: '',
    });
  };

  const handleClose = () => {
    cancelEditing();
    onClose();
  };

  const saveTitle = async () => {
    if (!editingSessionId || isSavingTitle) return;
    const title = editingTitle.trim();
    if (!title) {
      message.warning('Session name cannot be empty');
      return;
    }

    setUiField('isSavingTitle', true);
    try {
      await onRenameSession(editingSessionId, title);
      message.success('Session name updated');
      cancelEditing();
    } catch (error) {
      console.error('Failed to rename session:', error);
      message.error('Failed to rename session');
    } finally {
      setUiField('isSavingTitle', false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      footer={null}
      onCancel={handleClose}
      width={720}
      centered
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Select
          aria-label="Filter by world book"
          allowClear
          placeholder="Filter by world book"
          value={worldBookFilter}
          onChange={(value) => setUiField('worldBookFilter', value ?? null)}
          options={worldBooks.map((worldBook) => ({ value: worldBook.id, label: worldBook.name }))}
          style={filterSelectStyle}
        />
        <Select
          aria-label="Filter by character card"
          allowClear
          placeholder="Filter by character card"
          value={characterCardFilter}
          onChange={(value) => setUiField('characterCardFilter', value ?? null)}
          options={characterCards.map((card) => ({ value: card.id, label: card.name }))}
          style={filterSelectStyle}
        />
      </div>

      {filteredSessions.length === 0 ? (
        <Empty description={worldBookFilter || characterCardFilter ? 'No history matches the filters' : emptyText} />
      ) : (
        <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredSessions.map((session) => {
            const meta = resolveSessionHistoryMeta(session, worldBooks, characterCards);
            const visibleCards = meta.characterCards.slice(0, 3);
            const isEditing = editingSessionId === session.id;
            const sessionContent = (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                  {isEditing ? (
                    <Input
                      ref={titleInputRef}
                      aria-label="Session name"
                      value={editingTitle}
                      onChange={(event) => setUiField('editingTitle', event.target.value)}
                      onPressEnter={() => void saveTitle()}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') cancelEditing();
                      }}
                      onClick={(event) => event.stopPropagation()}
                      disabled={isSavingTitle}
                      style={{ maxWidth: 360 }}
                    />
                  ) : (
                    <strong style={{ color: '#33312e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title}
                    </strong>
                  )}
                  <span style={{ color: '#9a948c', fontSize: 12, flexShrink: 0 }}>
                    {session.savedAt ? savedAtFormatter.format(new Date(session.savedAt)) : 'Not saved'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {meta.worldBookName ? <Tag color="orange">World book: {meta.worldBookName}</Tag> : <Tag>Not bound to a world book</Tag>}
                  {visibleCards.length > 0 ? (
                    visibleCards.map((card) => (
                      <Tag key={card.id} color="default">Character card: {card.name}</Tag>
                    ))
                  ) : (
                    <Tag>Not bound to a character card</Tag>
                  )}
                </div>
              </>
            );
            return (
              <div
                key={session.id}
                style={sessionHistoryItemStyle}
              >
                {isEditing ? (
                  <div style={{ ...sessionHistoryOpenButtonStyle, cursor: 'default' }}>
                    {sessionContent}
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`Open ${session.title}`}
                    onClick={() => handleOpenSession(session.id)}
                    style={sessionHistoryOpenButtonStyle}
                  >
                    {sessionContent}
                  </button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', paddingRight: 8 }}>
                  {isEditing ? (
                    <>
                      <Button
                        type="text"
                        aria-label="Confirm rename"
                        icon={<CheckOutlined />}
                        loading={isSavingTitle}
                        onClick={() => void saveTitle()}
                      />
                      <Button
                        type="text"
                        aria-label="Cancel rename"
                        icon={<CloseOutlined />}
                        disabled={isSavingTitle}
                        onClick={cancelEditing}
                      />
                    </>
                  ) : (
                    <>
                      <Button
                        type="text"
                        aria-label={`Rename ${session.title}`}
                        icon={<EditOutlined />}
                        onClick={() => startEditing(session)}
                      />
                      <Button
                        type="text"
                        danger
                        aria-label={`Delete ${session.title}`}
                        icon={<DeleteOutlined />}
                        onClick={() => void onDeleteSession(session.id)}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
