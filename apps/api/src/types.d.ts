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
