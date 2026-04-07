declare module 'html-to-docx' {
  export default function htmlToDocx(
    htmlString: string,
    headerHTMLString?: string,
    options?: Record<string, unknown>,
  ): Promise<ArrayBuffer>;
}
