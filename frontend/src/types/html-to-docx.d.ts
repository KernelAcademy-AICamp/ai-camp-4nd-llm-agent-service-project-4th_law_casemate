declare module "html-to-docx" {
  interface HTMLToDocxOptions {
    table?: { row?: { cantSplit?: boolean } };
    font?: string;
    fontSize?: number;
  }

  export default function HTMLtoDOCX(
    html: string,
    headerHtml?: string,
    options?: HTMLToDocxOptions
  ): Promise<Blob | Buffer>;
}
