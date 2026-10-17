"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { DEFAULT_BOOK_COVER } from "@/lib/book-cover";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  src?: string | null;
  fallbackAlt: string;
};

export function BookCoverImage({ src, alt, fallbackAlt, ...props }: Props) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const source = src?.trim() || DEFAULT_BOOK_COVER;
  const fallback = source === DEFAULT_BOOK_COVER || failedSource === source;
  useEffect(() => {
    // The browser may finish a failed SSR image request before React hydrates.
    if (!fallback && imageRef.current?.complete && imageRef.current.naturalWidth === 0) setFailedSource(source);
  }, [source, fallback]);
  return <img {...props} ref={imageRef} src={fallback ? DEFAULT_BOOK_COVER : source}
    alt={fallback ? fallbackAlt : alt}
    onError={() => { if (!fallback) setFailedSource(source); }} />;
}
