'use client';

import { useEffect } from 'react';

export default function OAuthCallback() {
  useEffect(() => {
    // Simply close the window - parent will refresh server status
    if (window.opener) {
      window.close();
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-semibold mb-4">Completing Authentication</h1>
        <p className="text-gray-600">Please wait while we complete the authentication process...</p>
      </div>
    </div>
  );
} 