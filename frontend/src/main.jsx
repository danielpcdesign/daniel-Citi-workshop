import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// self-hosted: no third-party font request, and the app still looks right offline (AD-10)
import '@fontsource/overpass/700.css'
import '@fontsource/overpass/800.css'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import App from './App.jsx'
import AuthProvider from './components/AuthProvider.jsx'
import SettingsProvider from './components/SettingsProvider.jsx'

createRoot(document.getElementById('root')).render(
    <StrictMode>
        {/* appearance, colours, and motion; applies to every page, signed in or not */}
        <SettingsProvider>
            <BrowserRouter>
                <AuthProvider>
                    <App />
                </AuthProvider>
            </BrowserRouter>
        </SettingsProvider>
    </StrictMode>,
)
