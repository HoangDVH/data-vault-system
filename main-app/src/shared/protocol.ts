export type MessageType =
  | "INIT"
  | "GET_DATA"
  | "SEARCH"
  | "BULK_INSERT"
  | "ERROR"
  | "RESPONSE";

/** Domain row returned by the vault iframe for GET_DATA / SEARCH */
export interface User {
  id: number;
  name: string;
}

export interface BaseMessage<T = unknown> {
  id: string;
  type: MessageType;
  payload?: T;
}

export interface ResponseMessage<T = unknown> {
  id: string;
  success: boolean;
  payload?: T;
  error?: string;
}

/** Client-side filters applied in the vault worker (bounded result set). */
export interface SearchFilters {
  minId?: number;
  maxId?: number;
}

export interface SearchPayload {
  keyword: string;
  requestId: string;
  filters?: SearchFilters;
  /** 0-based page index (default 0) */
  page?: number;
  /** Rows per page (default 50, max enforced in vault) */
  pageSize?: number;
}

export interface SearchResponse {
  rows: User[];
  /** Total rows matching keyword + filters (full scan count) */
  totalMatches: number;
  page: number;
  pageSize: number;
  /** Legacy: kept for compatibility; vault returns false when using paged SEARCH */
  capped: boolean;
}

/** Result from worker after appending rows in the background (small payload). */
export interface BulkInsertResponse {
  inserted: number;
  totalRows: number;
}
