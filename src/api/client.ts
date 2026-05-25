import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { URL } from 'url';
import { ConfluenceSettings } from '../settings';
import { resolveAuthHeader } from './credentials';
import {
  ConfluencePage,
  ConfluencePageList,
  ConfluenceSpaceList,
  ConfluenceAttachment,
  ConfluenceAttachmentList,
  CreatePageRequest,
  UpdatePageRequest,
} from './types';

export class ConfluenceClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(settings: ConfluenceSettings) {
    this.baseUrl = settings.baseUrl.replace(/\/$/, '');
    this.authHeader = resolveAuthHeader(settings);
  }

  // Core method — accepts Buffer body, returns Buffer response
  private rawRequest(
    method: string,
    urlStr: string,
    body?: Buffer,
    contentType = 'application/json'
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(urlStr);
      } catch {
        return reject(new Error(`Invalid URL: ${urlStr}`));
      }

      const headers: Record<string, string | number> = {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      };
      if (body) {
        headers['Content-Type'] = contentType;
        headers['Content-Length'] = body.length;
      }

      const req = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method,
          headers,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const status = res.statusCode ?? 0;
            if (status >= 400) {
              if (status === 401 || status === 403) {
                return reject(new Error(`Authentication failed (${status}) — check credentials in Settings`));
              }
              return reject(
                new Error(`Confluence ${method} ${parsed.pathname} → ${status}: ${buf.toString('utf8').slice(0, 300)}`)
              );
            }
            resolve(buf);
          });
        }
      );

      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/rest/api${path}`;
    const bodyBuf = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
    const buf = await this.rawRequest(method, url, bodyBuf, 'application/json');
    try {
      return JSON.parse(buf.toString('utf8')) as T;
    } catch {
      throw new Error(`Non-JSON response: ${buf.toString('utf8').slice(0, 300)}`);
    }
  }

  async testConnection(): Promise<void> {
    await this.request<ConfluenceSpaceList>('GET', '/space?limit=1');
  }

  async getPage(pageId: string): Promise<ConfluencePage> {
    return this.request<ConfluencePage>(
      'GET',
      `/content/${pageId}?expand=body.storage,version,space,ancestors`
    );
  }

  async findPageByTitle(spaceKey: string, title: string): Promise<ConfluencePage | null> {
    const qs = new URLSearchParams({ type: 'page', spaceKey, title, expand: 'body.storage,version' });
    const result = await this.request<ConfluencePageList>('GET', `/content?${qs}`);
    return result.results[0] ?? null;
  }

  async getChildren(pageId: string): Promise<ConfluencePage[]> {
    const result = await this.request<ConfluencePageList>(
      'GET',
      `/content/${pageId}/child/page?expand=body.storage,version&limit=200`
    );
    return result.results;
  }

  async createPage(req: CreatePageRequest): Promise<ConfluencePage> {
    return this.request<ConfluencePage>(
      'POST',
      '/content?expand=body.storage,version,space,ancestors',
      req
    );
  }

  async updatePage(pageId: string, req: UpdatePageRequest): Promise<ConfluencePage> {
    return this.request<ConfluencePage>(
      'PUT',
      `/content/${pageId}?expand=body.storage,version,space,ancestors`,
      req
    );
  }

  // Upload or replace an attachment on a page
  async uploadAttachment(
    pageId: string,
    filename: string,
    data: Buffer,
    mimeType: string
  ): Promise<ConfluenceAttachment> {
    const boundary = `confluenceBoundary${Date.now()}`;
    const nl = '\r\n';
    const header = Buffer.from(
      `--${boundary}${nl}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${nl}` +
      `Content-Type: ${mimeType}${nl}${nl}`
    );
    const footer = Buffer.from(`${nl}--${boundary}--${nl}`);
    const body = Buffer.concat([header, data, footer]);

    const result = await this.rawRequest(
      'POST',
      `${this.baseUrl}/rest/api/content/${pageId}/child/attachment`,
      body,
      `multipart/form-data; boundary=${boundary}`
    );
    const parsed = JSON.parse(result.toString('utf8')) as ConfluenceAttachmentList;
    return parsed.results[0];
  }

  async getAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    const result = await this.request<ConfluenceAttachmentList>(
      'GET',
      `/content/${pageId}/child/attachment?expand=version,metadata&limit=200`
    );
    return result.results;
  }

  // Download attachment — URL is relative like /download/attachments/...
  async downloadAttachment(downloadPath: string): Promise<Buffer> {
    const url = downloadPath.startsWith('http')
      ? downloadPath
      : `${this.baseUrl}${downloadPath}`;
    return this.rawRequest('GET', url);
  }

  webUrl(page: ConfluencePage): string {
    const base = page._links?.base ?? this.baseUrl;
    const webui = page._links?.webui ?? '';
    return `${base}${webui}`;
  }
}
