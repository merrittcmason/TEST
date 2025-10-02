import { useState, useEffect, useRef } from 'react';
import type { ParsedEvent } from '../services/openaiStandard';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import './EventInput.css';

type Mode = 'standard' | 'education' | 'work' | 'enterprise';

interface EventInputProps {
  onEventsExtracted: (events: ParsedEvent[]) => void;
  mode?: Mode;
}

type ServiceModule = {
  OpenAITextService: { parseNaturalLanguage: (text: string) => Promise<{ events: ParsedEvent[]; tokensUsed: number }> };
  OpenAIFilesService: { parseFile: (file: File) => Promise<{ events: ParsedEvent[]; tokensUsed: number }> };
};

const serviceLoaders: Record<Mode, () => Promise<ServiceModule>> = {
  standard: () => import('../services/openaiStandard') as unknown as Promise<ServiceModule>,
  education: () => import('../services/openaiEducation') as unknown as Promise<ServiceModule>,
  work: () => import('../services/openaiWork') as unknown as Promise<ServiceModule>,
  enterprise: () => import('../services/openaiEnterprise') as unknown as Promise<ServiceModule>,
};

export function EventInput({ onEventsExtracted, mode = 'standard' }: EventInputProps) {
  const { user } = useAuth();
  const [textInput, setTextInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [captureMode, setCaptureMode] = useState<'document' | 'picture' | 'camera' | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const getServices = () => {
    const loader = serviceLoaders[mode as Mode] || serviceLoaders.standard;
    if (typeof loader !== 'function') return serviceLoaders.standard();
    return loader();
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowPopup(false);
      }
    }
    if (showPopup) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside, { passive: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showPopup]);

  const checkQuotas = async (isFileUpload: boolean) => {
    if (!user) throw new Error('Not authenticated');
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
    const { error: rpcError } = await supabase.rpc('ensure_profile_and_current_quota');
    if (rpcError) throw new Error(`Quota provisioning failed: ${rpcError.message}`);
    let tokenUsage = null as Awaited<ReturnType<typeof DatabaseService.getTokenUsage>>;
    let uploadQuota = null as Awaited<ReturnType<typeof DatabaseService.getUploadQuota>>;
    for (let attempt = 0; attempt < 2; attempt++) {
      [tokenUsage, uploadQuota] = await Promise.all([
        DatabaseService.getTokenUsage(user.id, currentMonth),
        DatabaseService.getUploadQuota(user.id, currentMonth),
      ]);
      if (tokenUsage && uploadQuota) break;
      await sleep(150);
    }
    if (!tokenUsage) throw new Error('Missing token usage record. Please try again.');
    if (!uploadQuota) throw new Error('Missing upload quota record. Please try again.');
    if (isFileUpload && uploadQuota.uploads_used >= uploadQuota.uploads_limit) {
      throw new Error('Upload quota exceeded. Please upgrade or wait until next month.');
    }
    if (tokenUsage.tokens_used >= tokenUsage.tokens_limit) {
      throw new Error('Token quota exceeded. Please upgrade or wait until next month.');
    }
  };

  const handleTextSubmit = async () => {
    if (!textInput.trim()) {
      setError('Please enter some text');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await checkQuotas(false);
      const { OpenAITextService } = await getServices();
      const result = await OpenAITextService.parseNaturalLanguage(textInput);
      if (result.events.length === 0) {
        setError('No events found. Please try rephrasing your input.');
        setLoading(false);
        return;
      }
      onEventsExtracted(result.events);
      setTextInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to process text');
    } finally {
      setLoading(false);
    }
  };

const handleFileSubmit = async (fileArg?: File) => {
  const file = fileArg ?? selectedFile;
  if (!file) {
    setError('Please select a file');
    return;
  }

  setError('');
  setLoading(true);

  try {
    await checkQuotas(true);
    const { OpenAIFilesService } = await getServices();
    const result = await OpenAIFilesService.parseFile(file);

    if (result.events.length === 0) {
      setError('No events found in the file.');
      setLoading(false);
      return;
    }

    onEventsExtracted(result.events);
    setSelectedFile(null);
  } catch (err: any) {
    setError(err.message || 'Failed to process file');
  } finally {
    setLoading(false);
  }
};

const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (file) {
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File size must be less than 10MB');
      e.currentTarget.value = '';
      return;
    }
    setSelectedFile(file);
    setError('');
    setShowPopup(false);
    handleFileSubmit(file);
    e.currentTarget.value = '';
  }
};



const handlePopupOption = (option: 'document' | 'picture' | 'camera') => {
  setCaptureMode(option);
  setShowPopup(false);
  setTimeout(() => {
    if (option === 'document' || option === 'picture') {
      document.getElementById('file-input-hidden')?.click();
    } else if (option === 'camera') {
      document.getElementById('camera-input-hidden')?.click();
    }
  }, 0);
};


  return (
    <div className="event-input">
      <div className="pill-input-container">
        <input
          type="text"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && textInput.trim()) {
              e.preventDefault();
              handleTextSubmit();
            }
          }}
          placeholder="Start Typing"
          className="pill-input"
          disabled={loading}
        />
        <button
          className="pill-plus-btn"
          onClick={() => setShowPopup(!showPopup)}
          disabled={loading}
          title="Add from file or camera"
        >
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          className="pill-submit-btn"
          onClick={handleTextSubmit}
          disabled={loading || !textInput.trim()}
          title="Create event"
        >
          {loading ? (
            <div className="loading-spinner-small" />
          ) : (
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          )}
        </button>
        {showPopup && (
          <div className="input-popup" ref={popupRef}>
            <button className="popup-option" onClick={() => handlePopupOption('document')}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Upload Document
            </button>
            <button className="popup-option" onClick={() => handlePopupOption('picture')}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Upload Picture
            </button>
            <button className="popup-option" onClick={() => handlePopupOption('camera')}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Open Camera
            </button>
          </div>
        )}
      </div>
      <input
        type="file"
        id="file-input-hidden"
        accept={captureMode === 'document' ? '.pdf,.txt,.doc,.docx,.xlsx,.xls,.csv' : 'image/*'}
        onChange={handleFileChange}
        className="file-input-hidden"
        style={{ display: 'none' }}
      />
      <input
        type="file"
        id="camera-input-hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="file-input-hidden"
        style={{ display: 'none' }}
      />
      {error && <div className="input-error">{error}</div>}
    </div>
  );
}
