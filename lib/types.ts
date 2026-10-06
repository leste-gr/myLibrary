export type CatalogueBook = {
  id: string;
  title: string;
  author: string;
  contributors: string | null;
  series: string;
  subseries: string | null;
  volume: string | null;
  language: string;
  category: string;
  publisher: string | null;
  notes: string | null;
  cover: string | null;
  coverSource: string | null;
  isbn13: string | null;
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
