import React, { useState } from 'react';
import BinaryStreamBackground from './components/BinaryStreamBackground';
import ChatInterface from './components/ChatInterface';
import CollabWorkspace from './components/collab/CollabWorkspace';
import { ThemeProvider } from './context/ThemeContext';

const App: React.FC = () => {
  const [view, setView] = useState<'chat' | 'missions'>('chat');

  return (
    <ThemeProvider>
      <main className="relative h-[100dvh] w-screen overflow-hidden bg-black font-mono">
        <BinaryStreamBackground />
        {/* Top-level view switch: existing chat UI vs. new mission-centered workspace. */}
        <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2">
          <div className="flex overflow-hidden rounded-full border border-white/15 bg-black/70 backdrop-blur">
            <button
              onClick={() => setView('chat')}
              className={`px-4 py-1.5 text-xs tracking-widest uppercase transition-colors ${
                view === 'chat' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setView('missions')}
              className={`px-4 py-1.5 text-xs tracking-widest uppercase transition-colors ${
                view === 'missions' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
              }`}
            >
              Missions
            </button>
          </div>
        </div>
        <div className="relative z-10 flex h-full w-full flex-col">
          {view === 'chat' ? <ChatInterface /> : <CollabWorkspace />}
        </div>
      </main>
    </ThemeProvider>
  );
};

export default App;
