
'use client';

import { useState } from 'react';

type User = {
  id: string;
  name: string;
};

const users: User[] = [
  { id: 'user-1', name: 'Gabe' },
  { id: 'user-2', name: 'Alice' },
];

export default function UserSelector() {
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  return (
    <div className="w-full max-w-xl mx-auto p-6">
      <h2 className="text-2xl font-semibold text-center mb-6">
        Who&apos;s using the assistant?
      </h2>

      <div className="grid grid-cols-2 gap-4">
        {users.map((user) => {
          const isSelected = selectedUser === user.id;

          return (
            <button
              key={user.id}
              onClick={() => setSelectedUser(user.id)}
              className={`
                flex flex-col items-center justify-center
                gap-3 p-6 rounded-xl border
                transition-all duration-200
                ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30'
                    : 'border-gray-300 dark:border-gray-700 hover:border-blue-400'
                }
              `}
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
                </svg>
              </div>

              <span className="font-medium text-base">
                {user.name}
              </span>

              <span className="text-xs text-gray-500 dark:text-gray-400">
                {isSelected ? 'Selected' : 'Personal profile'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
