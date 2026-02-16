export interface ISttService {
    transcribe(audioBase64: string, mimeType: string): Promise<string | null>;
}
