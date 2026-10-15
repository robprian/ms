import React from 'react';
import ReactDOM from 'react-dom/client';
import 'antd/dist/reset.css';
import './museai.app.css';
import { MuseAIView } from './client/MuseAIView';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<MuseAIView />);
