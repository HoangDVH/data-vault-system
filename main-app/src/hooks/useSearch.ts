import {
  useCallback,
  useRef,
  useState,
  startTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import { messageBus } from "../messaging/messageBus";
import type {
  SearchFilters,
  SearchResponse,
  User,
} from "../shared/protocol";

const DEFAULT_PAGE_SIZE = 50;

export type SearchPagination = { page: number; pageSize: number };

export function useSearch(
  setData: Dispatch<SetStateAction<User[]>>,
  setSearchMeta: Dispatch<
    SetStateAction<{
      totalMatches: number;
      page: number;
      pageSize: number;
      capped: boolean;
    }>
  >,
) {
  const latestRequestId = useRef("");
  const [pending, setPending] = useState(false);

  const search = useCallback(
    async (
      keyword: string,
      filters?: SearchFilters,
      pagination?: SearchPagination,
    ) => {
      const requestId = crypto.randomUUID();
      latestRequestId.current = requestId;
      setPending(true);

      const page = pagination?.page ?? 0;
      const pageSize = pagination?.pageSize ?? DEFAULT_PAGE_SIZE;

      try {
        const res = await messageBus.send<SearchResponse>(
          "SEARCH",
          {
            keyword,
            requestId,
            filters,
            page,
            pageSize,
          },
          { timeout: 60_000 },
        );

        if (requestId !== latestRequestId.current) return;

        startTransition(() => {
          setData(res.rows);
          setSearchMeta({
            totalMatches: res.totalMatches,
            page: res.page,
            pageSize: res.pageSize,
            capped: res.capped,
          });
        });
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        if (requestId === latestRequestId.current) {
          setPending(false);
        }
      }
    },
    [setData, setSearchMeta],
  );

  return { search, pending };
}
