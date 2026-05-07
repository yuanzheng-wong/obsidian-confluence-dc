export interface ConfluenceVersion {
  number: number;
  when: string;
  by?: { displayName: string };
}

export interface ConfluenceSpace {
  key: string;
  name: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  type: string;
  status: string;
  version: ConfluenceVersion;
  body: {
    storage: {
      value: string;
      representation: 'storage';
    };
  };
  space: ConfluenceSpace;
  ancestors: Array<{ id: string; title: string }>;
  _links: { webui: string; base: string };
}

export interface ConfluencePageList {
  results: ConfluencePage[];
  start: number;
  limit: number;
  size: number;
}

export interface CreatePageRequest {
  type: 'page';
  title: string;
  space: { key: string };
  ancestors?: Array<{ id: string }>;
  body: {
    storage: {
      value: string;
      representation: 'storage';
    };
  };
}

export interface UpdatePageRequest {
  type: 'page';
  title: string;
  version: { number: number };
  body: {
    storage: {
      value: string;
      representation: 'storage';
    };
  };
}

export interface ConfluenceSpace {
  key: string;
  name: string;
  _links: { webui: string };
}

export interface ConfluenceSpaceList {
  results: ConfluenceSpace[];
  size: number;
}

export interface ConfluenceAttachment {
  id: string;
  title: string;
  metadata: { mediaType: string };
  version: { number: number };
  _links: { download: string };
}

export interface ConfluenceAttachmentList {
  results: ConfluenceAttachment[];
  size: number;
}
