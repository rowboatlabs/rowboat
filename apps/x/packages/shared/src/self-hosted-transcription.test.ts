import { describe, expect, it } from 'vitest';
import {
  normalizeSelfHostedTranscriptionUrl,
  validateSelfHostedTranscriptionLanguage,
  validateSelfHostedTranscriptionToken,
} from './self-hosted-transcription.js';

describe('self-hosted transcription configuration', () => {
  it.each([
    ['http://127.0.0.1:18091/', 'http://127.0.0.1:18091'],
    ['http://localhost:8091', 'http://localhost:8091'],
    ['http://[::1]:8091', 'http://[::1]:8091'],
    ['https://speech.example.com/api///', 'https://speech.example.com/api'],
    ['https://speech.example.com/api', 'https://speech.example.com/api'],
  ])('accepts qualified local and remote URLs', (input, expected) => {
    expect(normalizeSelfHostedTranscriptionUrl(input)).toBe(expected);
  });

  it.each([
    'http://speech.example.com',
    'ws://127.0.0.1:8091',
    'https://user:secret@speech.example.com',
    'https://speech.example.com?token=secret',
    'https://speech.example.com/#fragment',
  ])('rejects insecure or credential-bearing URLs', (input) => {
    expect(() => normalizeSelfHostedTranscriptionUrl(input)).toThrow();
  });

  it('requires a bounded whitespace-free bearer token', () => {
    expect(validateSelfHostedTranscriptionToken('x'.repeat(32))).toBe('x'.repeat(32));
    expect(() => validateSelfHostedTranscriptionToken('short')).toThrow();
    expect(() => validateSelfHostedTranscriptionToken(`${'x'.repeat(32)} space`)).toThrow();
  });

  it('accepts bounded language tags and defaults to English', () => {
    expect(validateSelfHostedTranscriptionLanguage(undefined)).toBe('en');
    expect(validateSelfHostedTranscriptionLanguage('auto')).toBe('auto');
    expect(validateSelfHostedTranscriptionLanguage('en-IN')).toBe('en-IN');
    expect(() => validateSelfHostedTranscriptionLanguage('../../en')).toThrow();
  });
});
