import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

// Pick a square photo and shrink it to what a profile image needs. The org
// stores bytes as sent and caps them at 1 MiB (Harbor core/images.ts), so the
// phone does the resizing: 512px JPEG is a few tens of kilobytes.
const EDGE = 512;

export async function pickProfileImage(): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const out = await manipulateAsync(asset.uri, [{ resize: { width: EDGE, height: EDGE } }], { compress: 0.8, format: SaveFormat.JPEG });
  const bytes = new Uint8Array(await (await fetch(out.uri)).arrayBuffer());
  return { bytes, mime: 'image/jpeg' };
}
