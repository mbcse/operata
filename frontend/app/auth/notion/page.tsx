'use client';

import config from '@/app/config';
import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';

function NotionCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'error' | 'success'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const error = searchParams.get('error');
    const code = searchParams.get('code');

    if (error) {
      // Handle error case
      setStatus('error');
      setErrorMessage(searchParams.get('error_description') || 'Authentication failed');
      return;
    }

    if (code) {
      // Handle successful authentication
      handleNotionCode(code);
    } else {
      setStatus('error');
      setErrorMessage('No authentication code received');
    }
  }, [searchParams]);

  const handleNotionCode = async (code: string) => {
    try {
      // Send the code to your backend to exchange it for access token
      const response = await fetch(config.BACKEND_URL+'/notion/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        throw new Error('Failed to exchange code for access token');
      }

      setStatus('success');
      // Redirect to dashboard or home page after successful authentication
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (error) {
      setStatus('error');
      setErrorMessage('Failed to complete authentication');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      {status === 'loading' && (
        <div>
          <h2 className="text-xl font-semibold mb-2">Authenticating with Notion...</h2>
          {/* Add a loading spinner here if desired */}
        </div>
      )}

      {status === 'error' && (
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Authentication Error</h2>
          <p className="text-gray-600">{errorMessage}</p>
        </div>
      )}

      {status === 'success' && (
        <div className="text-center">
          <h2 className="text-xl font-semibold text-green-600 mb-2">Successfully Connected!</h2>
          <p className="text-gray-600">Redirecting to dashboard...</p>
        </div>
      )}
    </div>
  );
}

export default function NotionCallback() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <h2 className="text-xl font-semibold mb-2">Loading...</h2>
      </div>
    }>
      <NotionCallbackContent />
    </Suspense>
  );
}
