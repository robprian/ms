import React from 'react';
import { Modal, Form, Select, Input, Collapse, Button, message } from 'antd';
import { usePartnerStore } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { BookOutlined, UserOutlined, SettingOutlined } from '@ant-design/icons';

const { Panel } = Collapse;
const { TextArea } = Input;

interface PartnerChatSettingsModalProps {
  open: boolean;
  onCancel: () => void;
}

export const PartnerChatSettingsModal: React.FC<PartnerChatSettingsModalProps> = ({ open, onCancel }) => {
  const [form] = Form.useForm();
  
  const { worldBooks, characterCards } = usePartnerStore();
  const {
    selectedWorldBookId,
    selectedCharacterCardId,
    userInfo,
    setSelectedWorldBookId,
    setSelectedCharacterCardId,
    setUserInfo
  } = usePartnerChatStore();

  const syncFormValues = () => {
    const validWorldBookId = worldBooks.some(wb => wb.id === selectedWorldBookId) ? selectedWorldBookId : null;
    const validCharacterCardId = characterCards.some(cc => cc.id === selectedCharacterCardId) ? selectedCharacterCardId : null;

    if (validWorldBookId !== selectedWorldBookId) setSelectedWorldBookId(validWorldBookId);
    if (validCharacterCardId !== selectedCharacterCardId) setSelectedCharacterCardId(validCharacterCardId);

    form.setFieldsValue({
      worldBookId: validWorldBookId,
      characterCardId: validCharacterCardId,
      ...userInfo
    });
  };

  const handleSave = () => {
    const values = form.getFieldsValue();
    const { worldBookId, characterCardId, ...profileFields } = values;

    setSelectedWorldBookId(worldBookId || null);
    setSelectedCharacterCardId(characterCardId || null);
    setUserInfo(profileFields);

    message.success('Partner chat settings saved');
    onCancel();
  };

  const handleClearProfile = () => {
    const clearedFields = {
      name: '',
      age: '',
      gender: '',
      race: '',
      birthplace: '',
      occupation: '',
      socialClass: '',
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
      typicalReactions: ''
    };

    form.setFieldsValue(clearedFields);
    message.info('Profile fields have been reset');
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '18px', fontWeight: 600 }}>
          <SettingOutlined style={{ color: '#d97757' }} />
          <span>Partner Chat Settings</span>
        </div>
      }
      open={open}
      width={680}
      afterOpenChange={(visible) => {
        if (visible) syncFormValues();
      }}
      onCancel={onCancel}
      onOk={handleSave}
      okText="Save"
      cancelText="Cancel"
      styles={{
        body: { padding: '12px 0' }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
      >
        <div style={{ padding: '0 24px', marginBottom: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <Form.Item
            label={
              <span style={{ fontWeight: 500, color: '#33312e' }}>
                <BookOutlined style={{ marginRight: 6, color: '#d97757' }} />World Book (Setting)
              </span>
            }
            name="worldBookId"
            help="Choose the world book for this conversation to constrain the world-building framework"
          >
            <Select
              allowClear
              placeholder="Click to select a world book (optional)"
              options={worldBooks.map(item => ({ label: item.name, value: item.id }))}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            label={
              <span style={{ fontWeight: 500, color: '#33312e' }}>
                <UserOutlined style={{ marginRight: 6, color: '#d97757' }} />Character Card (Partner)
              </span>
            }
            name="characterCardId"
            help="Choose the partner character card for this chat to constrain the AI's personality and speaking style"
          >
            <Select
              allowClear
              placeholder="Click to select a character card (optional)"
              options={characterCards.map(item => ({ label: item.name, value: item.id }))}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </div>

        <div style={{ padding: '0 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontWeight: 600, color: '#33312e', fontSize: '14px' }}>My (User) Profile</span>
            <Button size="small" onClick={handleClearProfile} style={{ fontSize: '12px', color: '#8c8882', borderColor: '#eae6df' }}>
              Clear Profile
            </Button>
          </div>

          <Collapse defaultActiveKey={['base']} expandIconPosition="end" style={{ background: '#faf9f5', border: '1px solid #eae6df', borderRadius: '8px' }}>
            <Panel header="1. Basic Info" key="base">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item label="Name" name="name">
                  <Input placeholder="E.g. Aria" />
                </Form.Item>
                <Form.Item label="Age" name="age">
                  <Input placeholder="E.g. 18" />
                </Form.Item>
                <Form.Item label="Gender" name="gender">
                  <Input placeholder="E.g. Male" />
                </Form.Item>
                <Form.Item label="Race" name="race">
                  <Input placeholder="E.g. Human" />
                </Form.Item>
                <Form.Item label="Birthplace" name="birthplace">
                  <Input placeholder="E.g. Border of the Orlan Kingdom" />
                </Form.Item>
                <Form.Item label="Occupation" name="occupation">
                  <Input placeholder="E.g. Apprentice mage" />
                </Form.Item>
                <Form.Item label="Social Class" name="socialClass">
                  <Input placeholder="E.g. Commoner" />
                </Form.Item>
              </div>
            </Panel>

            <Panel header="2. Appearance & Vibe" key="appearance">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item label="Height & Build" name="heightBuild">
                  <Input placeholder="E.g. 180cm, well-proportioned" />
                </Form.Item>
                <Form.Item label="Iconic Features" name="iconicFeatures">
                  <Input placeholder="E.g. Wears black-rimmed glasses" />
                </Form.Item>
                <Form.Item label="Clothing Style" name="clothingStyle">
                  <Input placeholder="E.g. Simple fitted casual wear" />
                </Form.Item>
                <Form.Item label="Overall Vibe" name="overallVibe">
                  <Input placeholder="E.g. Calm and composed, sharp gaze" />
                </Form.Item>
              </div>
            </Panel>

            <Panel header="3. Personality" key="personality">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <Form.Item label="Outward Personality" name="externalPersonality">
                  <Input placeholder="E.g. Polite and courteous, a man of few words" />
                </Form.Item>
                <Form.Item label="Inner Personality" name="internalPersonality">
                  <Input placeholder="E.g. Full of curiosity, fiercely protective" />
                </Form.Item>
                <Form.Item label="Core Desire" name="coreDesire">
                  <Input placeholder="E.g. Explore the unknown, protect those around me" />
                </Form.Item>
                <Form.Item label="Fears & Weaknesses" name="fearWeakness">
                  <Input placeholder="E.g. Afraid of losing important companions" />
                </Form.Item>
                <Form.Item label="Moral Values" name="moralValues">
                  <Input placeholder="E.g. Holds fast to conscience, clearly repays kindness and grudge" />
                </Form.Item>
                <Form.Item label="Quirk" name="quirk">
                  <Input placeholder="E.g. Twirls a pen when thinking" />
                </Form.Item>
              </div>
            </Panel>

            <Panel header="4. Story & Skills" key="skillsStory">
              <Form.Item label="Skills & Expertise" name="skills">
                <TextArea rows={2} placeholder="E.g. Skilled at analytical reasoning, deeply versed in magical theory" />
              </Form.Item>
              <Form.Item label="Background Story" name="backgroundStory">
                <TextArea rows={3} placeholder="Enter your origins or past experiences..." />
              </Form.Item>
              <Form.Item label="Relationships" name="relationships">
                <TextArea rows={2} placeholder="Describe your relationship with your chat partner or other characters..." />
              </Form.Item>
              <Form.Item label="Speaking Style" name="speakingStyle">
                <Input placeholder="E.g. Steady tone, prefers to sort out the logic before speaking" />
              </Form.Item>
              <Form.Item label="Typical Reactions" name="typicalReactions">
                <TextArea rows={2} placeholder="E.g. Laughs off provocations, very reliable in a crisis" />
              </Form.Item>
            </Panel>
          </Collapse>
        </div>
      </Form>
    </Modal>
  );
};
