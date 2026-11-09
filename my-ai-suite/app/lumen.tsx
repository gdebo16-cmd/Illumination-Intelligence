'use client';

import Sidebar from './Sidebar';
import Chat from './ChatContent';
import Header from './Header';

const Lumen = () => (
    <div className="app-body">
      <Header />
      <Sidebar />
      <main>
        <Chat />
      </main>
    </div>
  );


export default Lumen;