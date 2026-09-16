declare module 'nodemailer' {
  const nodemailer: any;
  export default nodemailer;
}

declare module 'xlsx' {
  const XLSX: any;
  export default XLSX;
}

declare module 'docx' {
  export const Document: any;
  export const Packer: any;
  export const Paragraph: any;
  export const HeadingLevel: any;
}

declare module 'pdfjs-dist' {
  export const GlobalWorkerOptions: any;
  export function getDocument(data: any): any;
}

declare module 'mailparser' {
  export function simpleParser(source: any, options?: any): Promise<any>;
}

declare module 'imapflow' {
  export class ImapFlow {
    constructor(options: any);
    connect(): Promise<void>;
    logout(): Promise<void>;
    mailboxOpen(path: string): Promise<any>;
    fetch(query: any, options: any): Promise<any>;
    fetchOne(seq: any, options: any): Promise<any>;
    search(query: any): Promise<any[]>;
    messageFlagsSet(seq: any, flags: any): Promise<void>;
    messageDelete(seq: any): Promise<void>;
  }
}

// node:sqlite is a Node 22.5+ builtin; the installed @types/node is 20.x, which has
// no sqlite.d.ts, so the dynamic import in lib/ftsIndex.ts fails the type check with
// TS2307. Only the slice that file uses is modelled -- its local `Db` interface (and
// the try/catch around the import) stays the real contract.
declare module 'node:sqlite' {
  export interface StatementSync {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
    run(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
