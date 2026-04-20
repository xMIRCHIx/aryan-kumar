/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAuth } from './hooks/useAuth';
import { Auth } from './components/Auth';
import { Chat } from './components/Chat';
import { Loader2 } from 'lucide-react';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-sm font-medium text-gray-500 tracking-wide uppercase">Connecting to Insforge Backend...</p>
        </div>
      </div>
    );
  }

  return user ? <Chat /> : <Auth />;
}

