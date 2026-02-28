declare module "imap-simple" {
  interface ImapSimpleOptions {
    imap: {
      user: string;
      password: string;
      host: string;
      port: number;
      tls: boolean;
      authTimeout?: number;
      tlsOptions?: Record<string, unknown>;
    };
  }

  interface MessagePart {
    which: string;
    body: unknown;
  }

  interface Message {
    parts: MessagePart[];
    attributes: Record<string, unknown>;
  }

  interface ImapSimple {
    openBox(boxName: string): Promise<void>;
    search(criteria: unknown[], fetchOptions: unknown): Promise<Message[]>;
    end(): void;
  }

  function connect(options: ImapSimpleOptions): Promise<ImapSimple>;
}

declare module "mailparser" {
  interface AddressObject {
    text: string;
    value: Array<{ address: string; name: string }>;
  }

  interface ParsedMail {
    messageId?: string;
    from?: AddressObject;
    to?: AddressObject;
    subject?: string;
    date?: Date;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string | string[];
  }

  function simpleParser(source: unknown): Promise<ParsedMail>;
}
