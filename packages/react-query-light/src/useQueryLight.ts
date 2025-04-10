import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryCache } from "./QueryLightProvider";
import { initRetryer } from "query-light-core/src";

type QueryOptions = {
  staleTime: number;
  retry: number;
  retryDelay: number;
  socketUrl: `ws://${string}`;
  isWebSocket: boolean;
  initialData: any;
  prefetch: boolean;
  enabled: boolean;
};

type ReturnOptions<T> = {
  data: T | null;
  error: any;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  invalidateCurrentQuery: () => void;
  prefetchProps: PrefetchProps
}
interface PrefetchProps {
  onMouseEnter: () => void;
}

export function useQueryLight<T>(
  queryKey: [string, any?],
  queryFn: () => Promise<T>,
  options?: Partial<QueryOptions & { prefetch?: boolean }>,
): ReturnOptions<T> {
  const {
    staleTime = 0,
    retry = 0,
    retryDelay = 2000,
    socketUrl = "",
    isWebSocket = false,
    initialData = null,
    prefetch = false,
    enabled = true,
  } = options ?? {};

  const cache = useQueryCache()

  const [data, setData] = useState<T | null>(() => {
    const cachedData = cache.get(queryKey.join("-"))?.result;
    return cachedData ?? initialData;
  });

  const [isLoading, setIsLoading] = useState<boolean>(
    !cache.get(queryKey.join("-")) && enabled && !prefetch,
  );
  const [error, setError] = useState<string | null>(null);
  const [retries, setRetries] = useState<number>(0);

  const queryHash = queryKey.join("-");
  const isFirstRender = useRef<boolean>(true);
  const retryIntervalId = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<WebSocket | null>(null);


  const handleStaleTime = useCallback(() => {
    if (staleTime === Infinity) return;
    if (staleTime > 0) {
      setTimeout(() => {
        cache.remove(queryHash);
      }, staleTime);
    }
  }, [staleTime, queryHash]);

  const queryFnHandler = useCallback(async () => {
    if (!enabled) return;
    if (cache.get(queryHash)?.result) {
      setData(cache.get(queryHash)?.result);
      return;
    }

    if (isFirstRender.current) {
      setIsLoading(true);
    }

    try {
      const result = await queryFn();
      cache.build(queryHash, { result, timestamp: Date.now() });
      setData(result);
      setError(null);
    } catch (err) {
      setError(err as string);
    } finally {
      setIsLoading(false);
    }
  }, [queryFn, queryHash]);

  useEffect(() => {
    if (prefetch) return;

    queryFnHandler();
    handleStaleTime();
    isFirstRender.current = false;

    return () => {
      if (retryIntervalId.current) {
        clearInterval(retryIntervalId.current);
      }
    };
  }, [queryFnHandler, handleStaleTime]);

  useEffect(() => {
    if (!isWebSocket || !socketUrl) return;

    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;

    socket.onopen = () => console.log("WebSocket connected");
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        const data = JSON.parse(event.data);

        setData((prev) => {
          const currentData = Array.isArray(prev) ? prev : prev ? [prev] : [];
          const newData = Array.isArray(data) ? data : [data];
          const updatedData = [...currentData, ...newData] as unknown as T;

          cache.build(queryHash, {
            result: updatedData,
            timestamp: Date.now(),
          });
          return updatedData;
        });
      }
    };

    socket.onerror = (error) => console.error("WebSocket error:", error);
    socket.onclose = () => console.log("WebSocket closed");

    return () => {
      socket.close();
    };
  }, [isWebSocket, socketUrl]);

  useEffect(() => {
    initRetryer({
      error,
      handler: queryFnHandler,
      retries,
      retry,
      set: setRetries,
      retryDelay,
      retryIntervalId: retryIntervalId.current,
    });
  }, [error, retries, retry, retryDelay, queryFnHandler]);

  const prefetchProps: PrefetchProps = {
    onMouseEnter: () => {
      if (cache.get(queryHash)) return;
      queryFnHandler();
    },
  };

  return {
    data,
    error,
    isLoading,
    refetch: queryFnHandler,
    invalidateCurrentQuery: () => cache.remove(queryHash),
    isError: !!error,
    prefetchProps
  };
}
