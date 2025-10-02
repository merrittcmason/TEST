import { useState } from 'react';
import { OpenAIService, type ParsedEvent } from '../services/openai';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase'; // ✅ for RPC call
import './EventInput.css';

interface EventInputProps {
  onEventsExtracted: (events: ParsedEvent[]) => void;
}

export function EventInput({ onEventsExtracted }: EventInputProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [textInput, setTextInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const checkQuotas = async (isFileUpload: boolean) => {
    if (!user) throw new Error('Not authenticated');
    const currentMonth = new Date().toISOString().slice(0, 7) + '-01';

    // ✅ Ensure profile + quotas exist
    const { error: rpcError } = await supabase.rpc('ensure_profile_and_current_quota');
    if (rpcError) throw new Error(`Quota provisioning failed: ${rpcError.message}`);

    // Read quotas (with a small retry in case of race)
    let tokenUsage = null;
    let uploadQuota = null;

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

    return { tokenUsage, uploadQuota };
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
      const result = await OpenAIService.parseNaturalLanguage(textInput);

      if (result.events.length === 0) {
        setError('No events found. Please try rephrasing your input.');
        setLoading(false);
        return;
      }

      // ✅ No client writes — quotas update server-side
      onEventsExtracted(result.events);
      setTextInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to process text');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSubmit = async () => {
    if (!selectedFile) {
      setError('Please select a file');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await checkQuotas(true);
      const result = await OpenAIService.parseFileContent(selectedFile);

      if (result.events.length === 0) {
        setError('No events found in the file.');
        setLoading(false);
        return;
      }

      // ✅ No client writes — quotas update server-side
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
        return;
      }
      setSelectedFile(file);
      setError('');
    }
  };

  return (
    <div className="event-input">
      <div className="input-mode-switcher">
        <button
          className={`mode-btn ${mode === 'text' ? 'active' : ''}`}
          onClick={() => setMode('text')}
        >
          Text Input
        </button>
        <button
          className={`mode-btn ${mode === 'file' ? 'active' : ''}`}
          onClick={() => setMode('file')}
        >
          File Upload
        </button>
      </div>

      {mode === 'text' ? (
        <div className="text-input-mode">
          <textarea
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Example: I have a meeting on October 3rd at 8:30 am"
            className="event-textarea"
            rows={4}
            disabled={loading}
          />
          <div className="input-footer">
            <span className="char-count">{textInput.length} characters</span>
            <button
              onClick={handleTextSubmit}
              className="btn btn-primary"
              disabled={loading || !textInput.trim()}
            >
              {loading ? 'Processing...' : 'Create Event(s)'}
            </button>
          </div>
        </div>
      ) : (
        <div className="file-input-mode">
          <div className="file-upload-area">
            <input
              type="file"
              id="file-input"
              accept="image/*,.pdf,.txt,.doc,.docx"
              onChange={handleFileChange}
              className="file-input-hidden"
              disabled={loading}
            />
            <label htmlFor="file-input" className="file-upload-label">
              {selectedFile ? (
                <div className="file-selected">
                  <span className="file-name">{selectedFile.name}</span>
                  <span className="file-size">
                    ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </span>
                </div>
              ) : (
                <div className="file-placeholder">
                  <svg
                    className="upload-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p>Click to upload or drag and drop</p>
                  <p className="file-hint">Images, PDFs, or text documents</p>
                </div>
              )}
            </label>
          </div>
          <button
            onClick={handleFileSubmit}
            className="btn btn-primary"
            disabled={loading || !selectedFile}
          >
            {loading ? 'Processing...' : 'Create Event(s) from File'}
          </button>
        </div>
      )}

      {error && <div className="input-error">{error}</div>}
    </div>
  );
}
