import '@fontsource-variable/vazirmatn/wght.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './components/ui/tokens.css';
import { applyStoredTheme } from './features/workspace/ThemeControl';
import './styles.css';

applyStoredTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
