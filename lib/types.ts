import type { ReadingStatus } from "./reading-status";

export type CatalogueBook = {
  readingStatus: ReadingStatus;
  id: string;
  title: string;
  author: string;
  series: string;
  language: string;
  category: string;
  publisher: string | null;
  cover: string | null;
  isbn13: string | null;
};

export type PublicCollection = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  bookCount: number;
  authorCount: number;
};

export type EditionCandidate = {
  id: string;
  isbn13: string;
  title: string | null;
  publishers: string[];
  publishedDate: string | null;
  coverUrl: string | null;
  provider: string;
  providerId: string;
  score: number;
  suggested: boolean;
  rank: number;
};
