export function canonicalIsbn(value: string): string | null {
  const cleaned = value.toUpperCase().replace(/[^0-9X]/g, "");
  if (cleaned.length === 10) {
    const valid = /^[0-9]{9}[0-9X]$/.test(cleaned)
      && [...cleaned].reduce((sum, char, index) => sum + (10 - index) * (char === "X" ? 10 : Number(char)), 0) % 11 === 0;
    if (!valid) return null;
    const body = "978" + cleaned.slice(0, 9);
    const check = (10 - [...body].reduce((sum, char, index) => sum + Number(char) * (index % 2 ? 3 : 1), 0) % 10) % 10;
    return body + check;
  }
  if (!/^97[89][0-9]{10}$/.test(cleaned)) return null;
  const checksum = [...cleaned.slice(0, 12)].reduce((sum, char, index) => sum + Number(char) * (index % 2 ? 3 : 1), 0) + Number(cleaned[12]);
  return checksum % 10 === 0 ? cleaned : null;
}

export function isbnCoverPath(isbn: string) {
  return `/api/covers/${isbn}`;
}
