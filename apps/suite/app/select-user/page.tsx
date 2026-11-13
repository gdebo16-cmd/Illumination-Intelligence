
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { USERS } from '@/lib/profiles';

const users = Object.entries(USERS).map(([id, name]) => ({
  id,
  name,
}));

export default function SelectUserPage() {
  const router = useRouter();

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function selectUser(userId: string) {
    setLoading(userId);
    setError('');

    try {
      const response = await fetch('/api/users/select', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        throw new Error('Unable to select profile.');
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(null);
    }
  }

  return (
    <main>
      <div className="signin-container">

        <h1 className='title-signin'>
          Who&apos;s using the assistant?
        </h1>

        <p className='sub-signin'>
          Select your personal profile to continue.
        </p>

        <div className='user-container'>
          {users.map((user) => (
            <button className='user-buttons' key={user.id} onClick={() => selectUser(user.id)} disabled={loading !== null}>
              <div className='user-icon'>
                <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
                </svg>
              </div>

              <span className="user-name">
                {loading === user.id ? 'Selecting...' : user.name}
              </span>

              <span className="user-description">
                Personal profile
              </span>
            </button>
          ))}
        </div>

        {error && (
          <p className="error-message">
            {error}
          </p>
        )}

      </div>
    </main>
  );
}
