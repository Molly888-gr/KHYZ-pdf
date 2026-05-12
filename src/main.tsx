import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import './styles.css'
import { AppHeader } from './components/AppHeader'
import { TemperaturePage } from './components/TemperaturePage'
import { CalibrationPage } from './components/CalibrationPage'

function App() {
  const [activeTab, setActiveTab] = useState<"temperature" | "calibration">("temperature");

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader activeTab={activeTab} onTabChange={setActiveTab} />
      {activeTab === "temperature" ? <TemperaturePage /> : <CalibrationPage />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
