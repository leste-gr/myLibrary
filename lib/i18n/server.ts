import { cookies } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, parseLocale, translator } from "./shared";

export const getLocale = cache(async () => parseLocale((await cookies()).get(LOCALE_COOKIE)?.value));
export async function getTranslations() { return translator(await getLocale()); }
