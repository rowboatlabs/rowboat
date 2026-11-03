import { NativeModule, requireOptionalNativeModule } from 'expo';

// Image paste into a text field (ios/ImagePasteModule.swift). iOS only: on
// Android and web the module is absent and nothing is ever pasted.

export interface PastedImage {
  uri: string;
  mime: string;
  name: string;
}

declare class ImagePasteModule extends NativeModule<{ onPaste: (event: { images: PastedImage[] }) => void }> {}

const native = requireOptionalNativeModule<ImagePasteModule>('ImagePaste');

/** Give a multiline TextInput this nativeID and it offers Paste for a copied image. */
export const IMAGE_PASTE_TARGET = 'image-paste-target';

/** Images pasted into any IMAGE_PASTE_TARGET field; check focus to tell which. */
export function addImagePasteListener(listener: (images: PastedImage[]) => void): () => void {
  const subscription = native?.addListener('onPaste', (event) => listener(event.images));
  return () => subscription?.remove();
}
