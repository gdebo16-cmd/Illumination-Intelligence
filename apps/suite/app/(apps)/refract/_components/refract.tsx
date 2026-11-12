"use client";

import Sidebar from "@/components/Sidebar";
import AppHeader from "@/components/AppHeader";
import { useState } from "react";
import SidebarToggle from "@/components/SidebarToggle";

type Font = {
    id: string;
    name: string;
};

const Refract = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [fonts, setFonts] = useState<Font[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const addFont = () => {
        const font: Font = {
            id: crypto.randomUUID(), // unique id for the font
            name: 'untitled', // default name for the font
        };
        setFonts([...fonts, font]); // add the font to the list
        setSelectedId(font.id); // set the selected id to the new font
        };

    const selected = fonts.find((font) => font.id === selectedId); // find the selected font
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''); // letters for the font

    return (
        <div className={`site-container ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Snapshots" className="refract-sidebar">
            <div className="astra-sidebar-content">

                <button type="button" className="new-chat-button" onClick={addFont}>
                + New snapshot
                </button>
                </div>
                <span className="sidebar-separator">Your snapshots</span>

                {fonts.map((font) => (
                <button
                    key={font.id}
                    type="button"
                    className={`chat-button ${font.id === selectedId ? 'is-current' : ''}`}
                    onClick={() => setSelectedId(font.id)}>
                    {font.name}
                </button>
                ))}
        </Sidebar>
        <div className="content-area">
            <AppHeader
            appId="refract"
            left={<SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} label="snapshot list" />}
            />
            <main className="refract">
            {selected ? (
                <>
                <h1>{selected.name}</h1>
                <div className="refract-grid">
                    {letters.map((letter) => (
                    <div key={letter} className="refract-tile">
                        {letter}
                    </div>
                    ))}
                </div>
                </>
            ) : (
                <p className="refract-empty">Awaiting your command...</p>
            )}
            </main>
        </div>
        </div>
    );
  };
  
  export default Refract;